use rumqttc::{AsyncClient, Event, Incoming, LastWill, MqttOptions, QoS};
use serde_json::json;
use std::{
    env,
    sync::atomic::Ordering,
    time::Duration,
};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

use crate::{
    models::{BroadcastEvent, ConfigRequest, NotificationPriority, NotificationRequest},
    state::AppState,
};

#[derive(Clone, Debug)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub prefix: String,
}

impl MqttConfig {
    pub fn from_env() -> Self {
        let prefix = env::var("MQTT_PREFIX")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "grandfather_clock".to_string());

        let raw_host = env::var("MQTT_HOST")
            .or_else(|_| env::var("MQTT_BROKER_HOST"))
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string());

        let port_env = env::var("MQTT_PORT")
            .or_else(|_| env::var("MQTT_BROKER_PORT"))
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(1883);

        let (host, port) = if let Some((h, p)) = raw_host.split_once(':') {
            let parsed_p = p.parse::<u16>().unwrap_or(port_env);
            (h.to_string(), parsed_p)
        } else {
            (raw_host, port_env)
        };

        let client_id = env::var("MQTT_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("{}_backend_{}", prefix, std::process::id()));

        let username = env::var("MQTT_USER")
            .or_else(|_| env::var("MQTT_USERNAME"))
            .ok()
            .filter(|s| !s.trim().is_empty());

        let password = env::var("MQTT_PASS")
            .or_else(|_| env::var("MQTT_PASSWORD"))
            .ok()
            .filter(|s| !s.trim().is_empty());

        Self {
            host,
            port,
            client_id,
            username,
            password,
            prefix,
        }
    }
}

pub async fn run_mqtt_bridge(state: AppState) {
    let cfg = MqttConfig::from_env();
    info!(
        broker = %format!("{}:{}", cfg.host, cfg.port),
        client_id = %cfg.client_id,
        prefix = %cfg.prefix,
        "Starting MQTT bridge background task"
    );

    loop {
        let mut mqttoptions = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
        mqttoptions.set_keep_alive(Duration::from_secs(15));
        mqttoptions.set_clean_session(true);

        // Set Last Will & Testament so Home Assistant marks device offline on unexpected disconnect
        let status_topic = format!("{}/status", cfg.prefix);
        mqttoptions.set_last_will(LastWill::new(
            status_topic.clone(),
            "offline",
            QoS::AtLeastOnce,
            true,
        ));

        if let (Some(ref u), Some(ref p)) = (&cfg.username, &cfg.password) {
            mqttoptions.set_credentials(u, p);
        }

        let (client, mut eventloop) = AsyncClient::new(mqttoptions, 50);

        info!(host = %cfg.host, port = cfg.port, "Connecting to MQTT broker...");

        // Continually poll eventloop
        loop {
            match eventloop.poll().await {
                Ok(notification) => {
                    match notification {
                        Event::Incoming(Incoming::ConnAck(_)) => {
                            info!("Successfully connected to MQTT broker");
                            state.mqtt_connected.store(true, Ordering::Relaxed);
                            *state.mqtt_prefix.write().await = cfg.prefix.clone();
                            *state.mqtt_client.write().await = Some(client.clone());

                            // Publish device status as online (retained)
                            if let Err(e) = client.publish(&status_topic, QoS::AtLeastOnce, true, "online").await {
                                warn!("Failed to publish online status: {}", e);
                            }

                            // Publish Home Assistant auto-discovery payloads using current available_themes
                            publish_ha_discovery(&client, &cfg, &state).await;

                            // Subscribe to wildcards under prefix
                            let sub_topic = format!("{}/#", cfg.prefix);
                            if let Err(e) = client.subscribe(&sub_topic, QoS::AtLeastOnce).await {
                                error!(topic = %sub_topic, "Failed to subscribe to MQTT prefix topic: {}", e);
                            } else {
                                info!(topic = %sub_topic, "Subscribed to MQTT topics");
                            }

                            // Subscribe to Home Assistant status to handle HA reboots
                            if let Err(e) = client.subscribe("homeassistant/status", QoS::AtLeastOnce).await {
                                error!("Failed to subscribe to homeassistant/status: {}", e);
                            } else {
                                info!("Subscribed to homeassistant/status");
                            }
                        }
                        Event::Incoming(Incoming::Publish(publish)) => {
                            handle_incoming_publish(&client, &state, &cfg, &publish.topic, &publish.payload).await;
                        }
                        Event::Incoming(Incoming::Disconnect) => {
                            warn!("Received disconnect from MQTT broker");
                            state.mqtt_connected.store(false, Ordering::Relaxed);
                            *state.mqtt_client.write().await = None;
                            break;
                        }
                        _ => {}
                    }
                }
                Err(err) => {
                    warn!(error = %err, "MQTT event loop error/disconnection");
                    state.mqtt_connected.store(false, Ordering::Relaxed);
                    *state.mqtt_client.write().await = None;
                    break;
                }
            }
        }

        // Backoff delay before reconnecting
        state.mqtt_connected.store(false, Ordering::Relaxed);
        *state.mqtt_client.write().await = None;
        let backoff = Duration::from_secs(5);
        warn!("MQTT connection lost. Retrying in {} seconds...", backoff.as_secs());
        sleep(backoff).await;
    }
}

pub fn build_ha_theme_select_payload(prefix: &str, themes: &[String]) -> serde_json::Value {
    let device = json!({
        "identifiers": [format!("{}_device", prefix)],
        "name": "Digital Grandfather Clock",
        "manufacturer": "Cirqit Labs",
        "model": "Modern Grandfather Clock",
        "sw_version": env!("CARGO_PKG_VERSION")
    });

    let status_topic = format!("{}/status", prefix);

    json!({
        "name": "Theme",
        "unique_id": format!("{}_theme", prefix),
        "command_topic": format!("{}/theme/set", prefix),
        "state_topic": format!("{}/theme/state", prefix),
        "options": themes,
        "availability_topic": status_topic,
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": "mdi:palette",
        "device": device
    })
}

pub async fn publish_ha_theme_select(
    client: &AsyncClient,
    prefix: &str,
    themes: &[String],
) -> Result<(), rumqttc::ClientError> {
    let payload = build_ha_theme_select_payload(prefix, themes);
    let topic = format!("homeassistant/select/{}_theme/config", prefix);
    info!(topic = %topic, count = themes.len(), "Publishing dynamic HA theme select discovery");
    client
        .publish(topic, QoS::AtLeastOnce, true, payload.to_string())
        .await
}

pub async fn publish_ha_discovery(client: &AsyncClient, cfg: &MqttConfig, state: &AppState) {
    let device = json!({
        "identifiers": [format!("{}_device", cfg.prefix)],
        "name": "Digital Grandfather Clock",
        "manufacturer": "Cirqit Labs",
        "model": "Modern Grandfather Clock",
        "sw_version": env!("CARGO_PKG_VERSION")
    });

    let status_topic = format!("{}/status", cfg.prefix);

    // 1. Dynamic Select: Theme options populated from state.available_themes
    let themes = state.available_themes.read().await.clone();
    let _ = publish_ha_theme_select(client, &cfg.prefix, &themes).await;

    // 2. Button: Test Chime
    let chime_button_config = json!({
        "name": "Test Chime",
        "unique_id": format!("{}_test_chime", cfg.prefix),
        "command_topic": format!("{}/chime/test", cfg.prefix),
        "availability_topic": status_topic,
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": "mdi:bell-ring",
        "device": device
    });
    let _ = client.publish(
        format!("homeassistant/button/{}_test_chime/config", cfg.prefix),
        QoS::AtLeastOnce,
        true,
        chime_button_config.to_string(),
    ).await;

    // 3. Switch: Sleep Mode
    let sleep_switch_config = json!({
        "name": "Sleep Mode",
        "unique_id": format!("{}_sleep_mode", cfg.prefix),
        "command_topic": format!("{}/sleep/set", cfg.prefix),
        "state_topic": format!("{}/sleep/state", cfg.prefix),
        "payload_on": "ON",
        "payload_off": "OFF",
        "state_on": "ON",
        "state_off": "OFF",
        "availability_topic": status_topic,
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": "mdi:power-sleep",
        "device": device
    });
    let _ = client.publish(
        format!("homeassistant/switch/{}_sleep_mode/config", cfg.prefix),
        QoS::AtLeastOnce,
        true,
        sleep_switch_config.to_string(),
    ).await;

    // 4. Number: Chime Volume
    let volume_config = json!({
        "name": "Chime Volume",
        "unique_id": format!("{}_volume", cfg.prefix),
        "command_topic": format!("{}/volume/set", cfg.prefix),
        "state_topic": format!("{}/volume/state", cfg.prefix),
        "min": 0,
        "max": 100,
        "availability_topic": status_topic,
        "payload_available": "online",
        "payload_not_available": "offline",
        "icon": "mdi:volume-high",
        "device": device
    });
    let _ = client.publish(
        format!("homeassistant/number/{}_volume/config", cfg.prefix),
        QoS::AtLeastOnce,
        true,
        volume_config.to_string(),
    ).await;

    // Publish initial states
    let initial_theme = {
        let c = state.config.read().await;
        if c.theme.is_empty() || c.theme == "default" {
            themes.first().cloned().unwrap_or_else(|| "pcb_2049".to_string())
        } else {
            c.theme.clone()
        }
    };
    let _ = client.publish(format!("{}/theme/state", cfg.prefix), QoS::AtLeastOnce, true, initial_theme).await;
    let _ = client.publish(format!("{}/sleep/state", cfg.prefix), QoS::AtLeastOnce, true, "OFF").await;
    let _ = client.publish(format!("{}/volume/state", cfg.prefix), QoS::AtLeastOnce, true, "100").await;

    info!("Home Assistant MQTT discovery configurations published with themes: {:?}", themes);
}

async fn handle_incoming_publish(
    client: &AsyncClient,
    state: &AppState,
    cfg: &MqttConfig,
    topic: &str,
    payload: &[u8],
) {
    let payload_str = match std::str::from_utf8(payload) {
        Ok(s) => s.trim(),
        Err(e) => {
            warn!("Received non-UTF-8 MQTT payload on {}: {}", topic, e);
            return;
        }
    };

    // Re-publish discovery configs when Home Assistant status comes online
    if topic == "homeassistant/status" {
        if payload_str.eq_ignore_ascii_case("online") {
            info!("Home Assistant came online; re-publishing discovery configs with current themes");
            let status_topic = format!("{}/status", cfg.prefix);
            let _ = client.publish(&status_topic, QoS::AtLeastOnce, true, "online").await;
            publish_ha_discovery(client, cfg, state).await;
        }
        return;
    }

    // Ignore internal state updates or discovery config echoes
    if topic.ends_with("/state") || topic.ends_with("/status") || topic.starts_with("homeassistant/") {
        return;
    }

    info!(topic, payload = payload_str, "Received MQTT message");

    let notify_topic = format!("{}/notify", cfg.prefix);
    let config_topic = format!("{}/config", cfg.prefix);
    let theme_set_topic = format!("{}/theme/set", cfg.prefix);
    let theme_topic = format!("{}/theme", cfg.prefix);
    let set_theme_topic = format!("{}/set_theme", cfg.prefix);
    let chime_test_topic = format!("{}/chime/test", cfg.prefix);
    let chime_topic = format!("{}/chime", cfg.prefix);
    let test_chime_topic = format!("{}/test_chime", cfg.prefix);
    let sleep_set_topic = format!("{}/sleep/set", cfg.prefix);
    let sleep_topic = format!("{}/sleep", cfg.prefix);
    let volume_set_topic = format!("{}/volume/set", cfg.prefix);

    if topic == chime_test_topic || topic == chime_topic || topic == test_chime_topic {
        info!("Triggering Test Chime via MQTT");
        let _ = state.broadcast_raw(r#"{"action":"test_chime"}"#);
        return;
    }

    if topic == theme_set_topic || topic == theme_topic || topic == set_theme_topic {
        let theme_str = if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_str) {
            val.get("theme")
                .or_else(|| val.get("theme_id"))
                .and_then(|t| t.as_str())
                .unwrap_or(payload_str)
                .to_string()
        } else {
            payload_str.trim_matches('"').to_string()
        };

        info!(theme = %theme_str, "Switching theme via MQTT");
        {
            let mut c = state.config.write().await;
            c.theme = theme_str.clone();
        }
        let action_msg = json!({
            "action": "set_theme",
            "theme_id": theme_str,
            "theme": theme_str
        });
        let _ = state.broadcast_raw(&action_msg.to_string());
        let _ = client.publish(format!("{}/theme/state", cfg.prefix), QoS::AtLeastOnce, true, theme_str).await;
        return;
    }

    if topic == sleep_set_topic || topic == sleep_topic {
        let upper = payload_str.to_uppercase();
        if upper == "ON" || upper == "TRUE" || upper == "1" {
            {
                let mut c = state.config.write().await;
                c.sleep_override = true;
            }
            let _ = state.broadcast_raw(r#"{"action":"set_mode","mode":"sleep"}"#);
            let _ = client.publish(format!("{}/sleep/state", cfg.prefix), QoS::AtLeastOnce, true, "ON").await;
        } else {
            {
                let mut c = state.config.write().await;
                c.sleep_override = false;
            }
            let _ = state.broadcast_raw(r#"{"action":"wake"}"#);
            let _ = client.publish(format!("{}/sleep/state", cfg.prefix), QoS::AtLeastOnce, true, "OFF").await;
        }
        return;
    }

    if topic == volume_set_topic {
        if let Ok(vol_num) = payload_str.parse::<f64>() {
            let normalized = (vol_num / 100.0).clamp(0.0, 1.0);
            let action_msg = json!({
                "action": "set_audio",
                "volume": normalized
            });
            let _ = state.broadcast_raw(&action_msg.to_string());
            let _ = client.publish(format!("{}/volume/state", cfg.prefix), QoS::AtLeastOnce, true, payload_str).await;
        }
        return;
    }

    if topic == notify_topic {
        // First attempt: typed NotificationRequest JSON
        if let Ok(req) = serde_json::from_str::<NotificationRequest>(payload_str) {
            let event = BroadcastEvent::new_notify(req);
            let _ = state.broadcast_event(&event);
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_str) {
            // Second attempt: flexible JSON with message / text
            let title = val.get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("MQTT Notification")
                .to_string();

            let message = val.get("message")
                .or_else(|| val.get("text"))
                .or_else(|| val.get("body"))
                .and_then(|m| m.as_str())
                .unwrap_or(payload_str)
                .to_string();

            let priority = match val.get("priority").and_then(|p| p.as_str()) {
                Some("urgent") | Some("alert") | Some("high") => NotificationPriority::Urgent,
                _ => NotificationPriority::Normal,
            };

            let duration_ms = val.get("durationMs")
                .or_else(|| val.get("timeoutMs"))
                .and_then(|d| d.as_u64())
                .unwrap_or(8000);

            let req = NotificationRequest {
                title,
                message,
                priority,
                duration_ms,
            };
            let event = BroadcastEvent::new_notify(req);
            let _ = state.broadcast_event(&event);
        } else {
            // Third attempt: Plain text payload
            let req = NotificationRequest {
                title: "MQTT Alert".to_string(),
                message: payload_str.to_string(),
                priority: NotificationPriority::Normal,
                duration_ms: 8000,
            };
            let event = BroadcastEvent::new_notify(req);
            let _ = state.broadcast_event(&event);
        }
        return;
    }

    if topic == config_topic {
        if let Ok(req) = serde_json::from_str::<ConfigRequest>(payload_str) {
            {
                let mut cfg_lock = state.config.write().await;
                if let Some(ref theme) = req.theme {
                    cfg_lock.theme = theme.clone();
                }
                if let Some(sleep) = req.sleep_override {
                    cfg_lock.sleep_override = sleep;
                }
                if let Some(ref mode) = req.mode {
                    let m = mode.to_lowercase();
                    if m == "tick" || m == "sweep" {
                        cfg_lock.mode = m;
                    }
                }
            }
            let event = BroadcastEvent::new_config(req);
            let _ = state.broadcast_event(&event);
        } else {
            warn!("Received invalid JSON on config topic: {}", payload_str);
        }
        return;
    }

    debug!(topic, "Ignored message on unhandled MQTT topic");
}
