use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde_json::json;
use tracing::{info, warn};

use crate::{
    models::{
        normalize_category, BroadcastEvent, NotificationRequest, MAX_MESSAGE_CHARS, MAX_TITLE_CHARS,
    },
    state::AppState,
};

pub async fn handle_notify(
    State(state): State<AppState>,
    Json(mut payload): Json<NotificationRequest>,
) -> impl IntoResponse {
    // Validate payload
    let title = payload.title.trim().to_string();
    let message = payload.message.trim().to_string();

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

    if title.chars().count() > MAX_TITLE_CHARS {
        warn!(len = title.chars().count(), "Rejected notification with oversized title");
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": "error",
                "message": format!("'title' must not exceed {} characters", MAX_TITLE_CHARS)
            })),
        );
    }

    if message.chars().count() > MAX_MESSAGE_CHARS {
        warn!(len = message.chars().count(), "Rejected notification with oversized message");
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": "error",
                "message": format!("'message' must not exceed {} characters", MAX_MESSAGE_CHARS)
            })),
        );
    }

    let normalized_category = match normalize_category(payload.category.as_deref(), payload.priority) {
        Some(cat) => cat,
        None => {
            warn!("Rejected notification with invalid category");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "status": "error",
                    "message": "Invalid 'category'. Allowed values: info, doorbell, securityAlert, alert, calendar, weather"
                })),
            );
        }
    };

    if payload.duration_ms == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "status": "error",
                "message": "'durationMs' must be greater than 0"
            })),
        );
    }

    payload.title = title;
    payload.message = message;
    payload.category = Some(normalized_category);

    info!(
        title = %payload.title,
        priority = ?payload.priority,
        category = ?payload.category,
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

