pub mod config;
pub mod health;
pub mod notify;
pub mod ws;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "./static".to_string());
    let index_file = format!("{}/index.html", static_dir);
    let serve_dir = ServeDir::new(&static_dir).fallback(ServeFile::new(&index_file));

    Router::new()
        .route("/ws", get(ws::handle_ws_upgrade))
        .route("/api/notify", post(notify::handle_notify))
        .route("/api/config", post(config::handle_update_config).get(config::handle_get_config))
        .route("/api/health", get(health::handle_health))
        .fallback_service(serve_dir)
        .with_state(state)
}

