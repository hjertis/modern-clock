pub mod config;
pub mod health;
pub mod notify;
pub mod ws;

use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws::handle_ws_upgrade))
        .route("/api/notify", post(notify::handle_notify))
        .route("/api/config", post(config::handle_update_config).get(config::handle_get_config))
        .route("/api/health", get(health::handle_health))
        .with_state(state)
}

