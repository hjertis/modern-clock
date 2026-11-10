use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationPriority {
    Normal,
    Urgent,
}

impl Default for NotificationPriority {
    fn default() -> Self {
        Self::Normal
    }
}

fn default_duration_ms() -> u64 {
    8000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRequest {
    pub title: String,
    pub message: String,
    #[serde(default)]
    pub priority: NotificationPriority,
    #[serde(default = "default_duration_ms")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigRequest {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub sleep_override: Option<bool>,
    #[serde(default)]
    pub mode: Option<String>, // "tick" | "sweep"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentConfig {
    pub theme: String,
    pub sleep_override: bool,
    pub mode: String,
}

impl Default for CurrentConfig {
    fn default() -> Self {
        Self {
            theme: "default".to_string(),
            sleep_override: false,
            mode: "sweep".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BroadcastEvent {
    #[serde(rename = "notify")]
    Notify {
        id: String,
        title: String,
        message: String,
        priority: NotificationPriority,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
        category: String,
        timestamp: String,
    },
    #[serde(rename = "config")]
    Config {
        #[serde(skip_serializing_if = "Option::is_none")]
        theme: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sleepOverride")]
        sleep_override: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        timestamp: String,
    },
}

impl BroadcastEvent {
    pub fn new_notify(req: NotificationRequest) -> Self {
        let id = format!("notif_{}_{}", Utc::now().timestamp_millis(), &Uuid::new_v4().to_string()[..8]);
        let category = match req.priority {
            NotificationPriority::Urgent => "alert".to_string(),
            NotificationPriority::Normal => "info".to_string(),
        };

        BroadcastEvent::Notify {
            id,
            title: req.title,
            message: req.message,
            priority: req.priority,
            duration_ms: req.duration_ms,
            timeout_ms: req.duration_ms,
            category,
            timestamp: Utc::now().to_rfc3339(),
        }
    }

    pub fn new_config(req: ConfigRequest) -> Self {
        BroadcastEvent::Config {
            theme: req.theme,
            sleep_override: req.sleep_override,
            mode: req.mode,
            timestamp: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_seconds: u64,
    pub active_ws_clients: usize,
    pub mqtt_connected: bool,
    pub version: &'static str,
}

