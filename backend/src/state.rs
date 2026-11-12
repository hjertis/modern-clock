use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

use crate::models::{BroadcastEvent, CurrentConfig};

pub const DEFAULT_AVAILABLE_THEMES: &[&str] = &[
    "vienna_classic",
    "pcb_2049",
    "pcb_2049_emerald",
];

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<String>,
    pub start_time: Instant,
    pub active_ws_clients: Arc<AtomicUsize>,
    pub mqtt_connected: Arc<AtomicBool>,
    pub config: Arc<RwLock<CurrentConfig>>,
    pub available_themes: Arc<RwLock<Vec<String>>>,
    pub mqtt_client: Arc<RwLock<Option<rumqttc::AsyncClient>>>,
    pub mqtt_prefix: Arc<RwLock<String>>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel::<String>(100);
        let default_themes = DEFAULT_AVAILABLE_THEMES
            .iter()
            .map(|s| s.to_string())
            .collect();

        Self {
            tx,
            start_time: Instant::now(),
            active_ws_clients: Arc::new(AtomicUsize::new(0)),
            mqtt_connected: Arc::new(AtomicBool::new(false)),
            config: Arc::new(RwLock::new(CurrentConfig::default())),
            available_themes: Arc::new(RwLock::new(default_themes)),
            mqtt_client: Arc::new(RwLock::new(None)),
            mqtt_prefix: Arc::new(RwLock::new("grandfather_clock".to_string())),
        }
    }

    pub fn broadcast_event(&self, event: &BroadcastEvent) -> Result<usize, String> {
        match serde_json::to_string(event) {
            Ok(json_str) => match self.tx.send(json_str) {
                Ok(recipients) => {
                    info!(recipients, "Broadcast event delivered to subscribers");
                    Ok(recipients)
                }
                Err(_) => {
                    // No active receivers is normal if no UI client is connected yet
                    Ok(0)
                }
            },
            Err(e) => {
                let err_msg = format!("Failed to serialize broadcast event: {}", e);
                error!("{}", err_msg);
                Err(err_msg)
            }
        }
    }

    pub fn broadcast_raw(&self, json_str: &str) -> Result<usize, String> {
        match self.tx.send(json_str.to_string()) {
            Ok(recipients) => {
                info!(recipients, "Raw broadcast delivered to subscribers");
                Ok(recipients)
            }
            Err(_) => Ok(0),
        }
    }

    pub async fn update_available_themes(&self, new_themes: Vec<String>) -> bool {
        let mut clean_themes: Vec<String> = Vec::new();
        for t in new_themes {
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() && !clean_themes.contains(&trimmed) {
                clean_themes.push(trimmed);
            }
        }

        if clean_themes.is_empty() {
            return false;
        }

        let changed = {
            let current = self.available_themes.read().await;
            *current != clean_themes
        };

        if changed {
            {
                let mut current = self.available_themes.write().await;
                *current = clean_themes.clone();
            }
            info!(themes = ?clean_themes, "Updated available themes list in state");

            let maybe_client = {
                let guard = self.mqtt_client.read().await;
                guard.clone()
            };

            if let Some(client) = maybe_client {
                let prefix = self.mqtt_prefix.read().await.clone();
                let _ = crate::mqtt::publish_ha_theme_select(&client, &prefix, &clean_themes).await;
            }
            true
        } else {
            false
        }
    }

    pub fn active_ws_count(&self) -> usize {
        self.active_ws_clients.load(Ordering::Relaxed)
    }

    pub fn is_mqtt_connected(&self) -> bool {
        self.mqtt_connected.load(Ordering::Relaxed)
    }
}
