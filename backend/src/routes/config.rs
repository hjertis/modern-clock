use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde_json::json;
use tracing::{info, warn};

use crate::{
    models::{BroadcastEvent, ConfigRequest},
    state::AppState,
};

pub async fn handle_update_config(
    State(state): State<AppState>,
    Json(payload): Json<ConfigRequest>,
) -> impl IntoResponse {
    // Validate mode if provided
    if let Some(ref mode) = payload.mode {
        let m = mode.to_lowercase();
        if m != "tick" && m != "sweep" {
            warn!(mode = %mode, "Invalid hand mode supplied");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "status": "error",
                    "message": "Invalid mode. Allowed values are 'tick' or 'sweep'"
                })),
            );
        }
    }

    // Update active config in state
    {
        let mut cfg = state.config.write().await;
        if let Some(ref theme) = payload.theme {
            cfg.theme = theme.clone();
        }
        if let Some(sleep) = payload.sleep_override {
            cfg.sleep_override = sleep;
        }
        if let Some(ref mode) = payload.mode {
            cfg.mode = mode.to_lowercase();
        }
    }

    let event = BroadcastEvent::new_config(payload);

    match state.broadcast_event(&event) {
        Ok(subscribers) => {
            let current = state.config.read().await.clone();
            info!(subscribers, "Configuration update broadcasted successfully");
            (
                StatusCode::OK,
                Json(json!({
                    "status": "ok",
                    "config": current,
                    "subscribers": subscribers
                })),
            )
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "status": "error",
                "message": err
            })),
        ),
    }
}

pub async fn handle_get_config(State(state): State<AppState>) -> impl IntoResponse {
    let current = state.config.read().await.clone();
    (StatusCode::OK, Json(current))
}

