use std::{env, net::SocketAddr};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use grandfather_clock_backend::{mqtt, routes, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize structured logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "grandfather_clock_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Digital Grandfather Clock Backend Daemon v{}", env!("CARGO_PKG_VERSION"));

    // Initialize application state with tokio broadcast channel
    let state = AppState::new();

    // Spawn MQTT background task
    let mqtt_state = state.clone();
    tokio::spawn(async move {
        mqtt::run_mqtt_bridge(mqtt_state).await;
    });

    // Configure CORS for web frontend / kiosk integration
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build Axum router
    let app = routes::create_router(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    // Resolve port from environment or default to 8080
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8088);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("🚀 Listening on http://{} (REST API) & ws://{}/ws (WebSocket)", addr, addr);

    // Run axum with graceful shutdown on Ctrl+C / SIGINT
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Grandfather clock backend daemon terminated cleanly");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C signal handler");
    info!("Shutdown signal received, draining connections...");
}
