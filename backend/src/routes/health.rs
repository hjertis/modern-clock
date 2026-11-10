use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};

use crate::{models::HealthResponse, state::AppState};

pub async fn handle_health(State(state): State<AppState>) -> impl IntoResponse {
    let uptime_seconds = state.start_time.elapsed().as_secs();
    let active_ws_clients = state.active_ws_count();
    let mqtt_connected = state.is_mqtt_connected();

    let health = HealthResponse {
        status: "ok",
        uptime_seconds,
        active_ws_clients,
        mqtt_connected,
        version: env!("CARGO_PKG_VERSION"),
    };

    (StatusCode::OK, Json(health))
}

