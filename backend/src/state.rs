use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

use crate::models::{BroadcastEvent, CurrentConfig};

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<String>,
    pub start_time: Instant,
    pub active_ws_clients: Arc<AtomicUsize>,
    pub mqtt_connected: Arc<AtomicBool>,
    pub config: Arc<RwLock<CurrentConfig>>,
}

impl AppState {
    pub fn new() -> Self {
        // Requirement 1: tokio::sync::broadcast::channel::<String>(100)
        let (tx, _rx) = broadcast::channel::<String>(100);
        Self {
            tx,
            start_time: Instant::now(),
            active_ws_clients: Arc::new(AtomicUsize::new(0)),
            mqtt_connected: Arc::new(AtomicBool::new(false)),
            config: Arc::new(RwLock::new(CurrentConfig::default())),
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

    pub fn active_ws_count(&self) -> usize {
        self.active_ws_clients.load(Ordering::Relaxed)
    }

    pub fn is_mqtt_connected(&self) -> bool {
        self.mqtt_connected.load(Ordering::Relaxed)
    }
}

