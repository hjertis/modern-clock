use std::collections::VecDeque;
use std::env;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

use crate::models::{BroadcastEvent, CurrentConfig, MAX_THEME_CHARS};

pub const DEFAULT_AVAILABLE_THEMES: &[&str] = &[
    "vienna_classic",
    "pcb_2049",
    "pcb_2049_emerald",
];

pub const MAX_THEMES_COUNT: usize = 32;
pub const RATE_LIMIT_MAX_REQUESTS: usize = 10;
pub const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(1);

#[derive(Debug)]
pub struct RateLimiter {
    timestamps: VecDeque<Instant>,
    max_requests: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            timestamps: VecDeque::with_capacity(max_requests),
            max_requests,
            window,
        }
    }

    pub fn check_and_record(&mut self, now: Instant) -> bool {
        while let Some(&front) = self.timestamps.front() {
            if now.duration_since(front) >= self.window {
                self.timestamps.pop_front();
            } else {
                break;
            }
        }
        if self.timestamps.len() >= self.max_requests {
            return false;
        }
        self.timestamps.push_back(now);
        true
    }
}

pub fn is_valid_theme_id(theme: &str) -> bool {
    !theme.is_empty()
        && theme.chars().count() <= MAX_THEME_CHARS
        && theme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn parse_allowed_origins_env() -> Vec<String> {
    env::var("ALLOWED_ORIGINS")
        .ok()
        .map(|raw| {
            raw.split(',')
                .map(|s| s.trim().trim_end_matches('/').to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

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
    pub api_token: Option<String>,
    pub allowed_origins: Vec<String>,
    pub rate_limiter: Arc<Mutex<RateLimiter>>,
}

impl AppState {
    pub fn new() -> Self {
        let api_token = env::var("API_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let allowed_origins = parse_allowed_origins_env();
        Self::with_security(api_token, allowed_origins)
    }

    pub fn with_security(api_token: Option<String>, allowed_origins: Vec<String>) -> Self {
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
            api_token,
            allowed_origins,
            rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                RATE_LIMIT_MAX_REQUESTS,
                RATE_LIMIT_WINDOW,
            ))),
        }
    }

    pub fn check_rate_limit(&self) -> bool {
        match self.rate_limiter.lock() {
            Ok(mut limiter) => limiter.check_and_record(Instant::now()),
            Err(_) => false,
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
            if is_valid_theme_id(&trimmed) && !clean_themes.contains(&trimmed) {
                clean_themes.push(trimmed);
                if clean_themes.len() >= MAX_THEMES_COUNT {
                    break;
                }
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
