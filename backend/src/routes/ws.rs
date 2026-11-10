use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
use tokio::{sync::broadcast::error::RecvError, time::interval};
use tracing::{debug, error, info, warn};

use crate::state::AppState;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_client(socket, state))
}

async fn handle_ws_client(socket: WebSocket, state: AppState) {
    // Track connection count
    let client_count = state.active_ws_clients.fetch_add(1, Ordering::Relaxed) + 1;
    info!(total_clients = client_count, "New WebSocket client connected");

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Send initial connection welcome with current clock config
    {
        let cfg = state.config.read().await.clone();
        let init_msg = json!({
            "type": "init",
            "connected": true,
            "version": env!("CARGO_PKG_VERSION"),
            "config": cfg
        });
        if let Ok(json_str) = serde_json::to_string(&init_msg) {
            let _ = ws_sender.send(Message::Text(json_str)).await;
        }
    }

    let mut heartbeat_timer = interval(HEARTBEAT_INTERVAL);

    loop {
        tokio::select! {
            // Heartbeat tick to keep NAT / proxies alive
            _ = heartbeat_timer.tick() => {
                if let Err(e) = ws_sender.send(Message::Ping(Vec::new())).await {
                    debug!("Failed to send ping heartbeat to client: {}", e);
                    break;
                }
            }

            // Incoming broadcast message from internal channel
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(text) => {
                        if let Err(e) = ws_sender.send(Message::Text(text)).await {
                            warn!("Failed to deliver broadcast payload to WebSocket: {}", e);
                            break;
                        }
                    }
                    Err(RecvError::Lagged(skipped)) => {
                        warn!(skipped, "WebSocket client lagged behind; skipped backlog events");
                    }
                    Err(RecvError::Closed) => {
                        info!("Internal broadcast channel closed; terminating client session");
                        break;
                    }
                }
            }

            // Incoming messages / heartbeats from the client
            client_msg = ws_receiver.next() => {
                match client_msg {
                    Some(Ok(Message::Ping(payload))) => {
                        debug!("Received client ping; replying with pong");
                        if let Err(e) = ws_sender.send(Message::Pong(payload)).await {
                            debug!("Failed to send pong to client: {}", e);
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        debug!("Received client pong heartbeat acknowledgment");
                    }
                    Some(Ok(Message::Text(text))) => {
                        debug!(text = %text, "Received message from WebSocket client");
                    }
                    Some(Ok(Message::Close(close_frame))) => {
                        debug!(frame = ?close_frame, "Client cleanly closed WebSocket connection");
                        break;
                    }
                    Some(Ok(Message::Binary(_))) => {
                        debug!("Ignoring binary payload from client");
                    }
                    Some(Err(e)) => {
                        error!("WebSocket receiver error: {}", e);
                        break;
                    }
                    None => {
                        debug!("WebSocket stream ended");
                        break;
                    }
                }
            }
        }
    }

    let remaining = state.active_ws_clients.fetch_sub(1, Ordering::Relaxed) - 1;
    info!(total_clients = remaining, "WebSocket client disconnected");
}
