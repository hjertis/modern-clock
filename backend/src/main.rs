use std::{env, net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use grandfather_clock_backend::{mqtt, routes, state::AppState};

fn resolve_port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8088)
}

async fn run_healthcheck(port: u16) -> i32 {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let check = async {
        let mut stream = tokio::net::TcpStream::connect(addr).await.ok()?;
        let req = format!(
            "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            port
        );
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = [0u8; 256];
        let n = stream.read(&mut buf).await.ok()?;
        let head = std::str::from_utf8(&buf[..n]).ok()?;
        if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
            Some(())
        } else {
            None
        }
    };

    match tokio::time::timeout(Duration::from_secs(3), check).await {
        Ok(Some(())) => 0,
        _ => 1,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = resolve_port();

    if env::args().any(|a| a == "--healthcheck") {
        std::process::exit(run_healthcheck(port).await);
    }

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

    // Shutdown coordinator for HTTP server and MQTT bridge
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Spawn MQTT background task
    let mqtt_state = state.clone();
    let mqtt_handle = tokio::spawn(async move {
        mqtt::run_mqtt_bridge(mqtt_state, shutdown_rx).await;
    });

    // Build Axum router (includes CORS allowlist, body limits, auth & rate limiting)
    let app = routes::create_router(state).layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("🚀 Listening on http://{} (REST API) & ws://{}/ws (WebSocket)", addr, addr);

    // Run axum with graceful shutdown on SIGINT / SIGTERM
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shutdown_tx))
        .await?;

    let _ = tokio::time::timeout(Duration::from_secs(3), mqtt_handle).await;

    info!("Grandfather clock backend daemon terminated cleanly");
    Ok(())
}

async fn shutdown_signal(shutdown_tx: watch::Sender<bool>) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C signal handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("Shutdown signal received, draining connections and notifying MQTT...");
    let _ = shutdown_tx.send(true);
}
