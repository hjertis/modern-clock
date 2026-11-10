use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
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

const DEFAULT_BROKER_HOST: &str = "localhost";
const DEFAULT_BROKER_PORT: u16 = 1883;
const TOPIC_NOTIFY: &str = "grandfather_clock/notify";
const TOPIC_CONFIG: &str = "grandfather_clock/config";

pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl MqttConfig {
    pub fn from_env() -> Self {
        let raw_host = env::var("MQTT_BROKER_HOST").unwrap_or_else(|_| DEFAULT_BROKER_HOST.to_string());
        let (host, port) = parse_host_port(&raw_host);

        let client_id = env::var("MQTT_CLIENT_ID")
            .unwrap_or_else(|_| format!("grandfather_clock_backend_{}", std::process::id()));

        let username = env::var("MQTT_USERNAME").ok().filter(|s| !s.is_empty());
        let password = env::var("MQTT_PASSWORD").ok().filter(|s| !s.is_empty());

        Self {
            host,
            port,
            client_id,
            username,
            password,
        }
    }
}

fn parse_host_port(input: &str) -> (String, u16) {
    if let Some((h, p)) = input.split_once(':') {
        let port = p.parse::<u16>().unwrap_or_else(|_| {
            env::var("MQTT_BROKER_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(DEFAULT_BROKER_PORT)
        });
        (h.to_string(), port)
    } else {
        let port = env::var("MQTT_BROKER_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_BROKER_PORT);
        (input.to_string(), port)
    }
}

pub async fn run_mqtt_bridge(state: AppState) {
    let cfg = MqttConfig::from_env();
    info!(
        broker = %format!("{}:{}", cfg.host, cfg.port),
        client_id = %cfg.client_id,
        "Starting MQTT bridge background task"
    );

    loop {
        let mut mqttoptions = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
        mqttoptions.set_keep_alive(Duration::from_secs(15));
        mqttoptions.set_clean_session(true);

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

                            // Subscribe to configured topics
                            if let Err(e) = client.subscribe(TOPIC_NOTIFY, QoS::AtLeastOnce).await {
                                error!(topic = TOPIC_NOTIFY, "Failed to subscribe: {}", e);
                            } else {
                                info!(topic = TOPIC_NOTIFY, "Subscribed to MQTT notifications");
                            }

                            if let Err(e) = client.subscribe(TOPIC_CONFIG, QoS::AtLeastOnce).await {
                                error!(topic = TOPIC_CONFIG, "Failed to subscribe: {}", e);
                            } else {
                                info!(topic = TOPIC_CONFIG, "Subscribed to MQTT config updates");
                            }
                        }
                        Event::Incoming(Incoming::Publish(publish)) => {
                            handle_incoming_publish(&state, &publish.topic, &publish.payload).await;
                        }
                        Event::Incoming(Incoming::Disconnect) => {
                            warn!("Received disconnect from MQTT broker");
                            state.mqtt_connected.store(false, Ordering::Relaxed);
                            break;
                        }
                        _ => {}
                    }
                }
                Err(err) => {
                    warn!(error = %err, "MQTT event loop error/disconnection");
                    state.mqtt_connected.store(false, Ordering::Relaxed);
                    break;
                }
            }
        }

        // Backoff delay before reconnecting
        state.mqtt_connected.store(false, Ordering::Relaxed);
        let backoff = Duration::from_secs(5);
        warn!("MQTT connection lost. Retrying in {} seconds...", backoff.as_secs());
        sleep(backoff).await;
    }
}

async fn handle_incoming_publish(state: &AppState, topic: &str, payload: &[u8]) {
    let payload_str = match std::str::from_utf8(payload) {
        Ok(s) => s,
        Err(e) => {
            warn!("Received non-UTF-8 MQTT payload on {}: {}", topic, e);
            return;
        }
    };

    info!(topic, payload = payload_str, "Received MQTT message");

    match topic {
        TOPIC_NOTIFY => {
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
        }
        TOPIC_CONFIG => {
            if let Ok(req) = serde_json::from_str::<ConfigRequest>(payload_str) {
                {
                    let mut cfg = state.config.write().await;
                    if let Some(ref theme) = req.theme {
                        cfg.theme = theme.clone();
                    }
                    if let Some(sleep) = req.sleep_override {
                        cfg.sleep_override = sleep;
                    }
                    if let Some(ref mode) = req.mode {
                        let m = mode.to_lowercase();
                        if m == "tick" || m == "sweep" {
                            cfg.mode = m;
                        }
                    }
                }
                let event = BroadcastEvent::new_config(req);
                let _ = state.broadcast_event(&event);
            } else {
                warn!("Received invalid JSON on config topic: {}", payload_str);
            }
        }
        _ => {
            debug!(topic, "Ignored message on unhandled MQTT topic");
        }
    }
}
