use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde_json::json;
use tracing::{info, warn};

use crate::{
    models::{BroadcastEvent, NotificationRequest},
    state::AppState,
};

pub async fn handle_notify(
    State(state): State<AppState>,
    Json(payload): Json<NotificationRequest>,
) -> impl IntoResponse {
    // Validate payload
    let title = payload.title.trim();
    let message = payload.message.trim();

    if title.is_empty() || message.is_empty() {
        warn!("Rejected notification with empty title or message");
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": "error",
                "message": "Both 'title' and 'message' fields are required and must not be empty"
            })),
        );
    }

    if payload.duration_ms == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": "error",
                "message": "'durationMs' must be greater than 0"
            })),
        );
    }

    info!(
        title = title,
        priority = ?payload.priority,
        duration_ms = payload.duration_ms,
        "Processing incoming notification"
    );

    let event = BroadcastEvent::new_notify(payload);

    match state.broadcast_event(&event) {
        Ok(subscribers) => {
            info!(subscribers, "Notification broadcasted successfully");
            (
                StatusCode::OK,
                Json(json!({
                    "status": "ok",
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

