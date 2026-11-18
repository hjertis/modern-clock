use axum::{
    extract::{
        ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
use tokio::{sync::broadcast::error::RecvError, time::interval};
use tracing::{debug, error, info, warn};

use crate::state::{is_valid_theme_id, AppState, MAX_THEMES_COUNT};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const MAX_WS_CLIENTS: usize = 16;
const MAX_WS_PAYLOAD_BYTES: usize = 16 * 1024;

#[derive(Debug, Default, Deserialize)]
pub struct WsAuthQuery {
    pub token: Option<String>,
}

fn is_origin_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    let Some(origin_val) = headers.get(header::ORIGIN) else {
        // Non-browser clients (e.g. CLI tools / internal health probes) may omit Origin
        return true;
    };
    let Ok(origin_str) = origin_val.to_str() else {
        return false;
    };
    let normalized_origin = origin_str.trim().trim_end_matches('/');

    if allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(normalized_origin))
    {
        return true;
    }

    // Allow same-origin upgrades where Origin's host:port matches the HTTP Host header
    if let Some(host_val) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) {
        let host = host_val.trim();
        let http_origin = format!("http://{}", host);
        let https_origin = format!("https://{}", host);
        if normalized_origin.eq_ignore_ascii_case(&http_origin)
            || normalized_origin.eq_ignore_ascii_case(&https_origin)
        {
            return true;
        }
    }

    false
}

fn is_ws_authenticated(headers: &HeaderMap, query: &WsAuthQuery, state: &AppState) -> bool {
    let Some(ref expected) = state.api_token else {
        return false;
    };

    if let Some(auth_header) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(bearer) = auth_header.strip_prefix("Bearer ") {
            if bearer.trim() == expected {
                return true;
            }
        }
    }

    if let Some(ref q_token) = query.token {
        if q_token.trim() == expected {
            return true;
        }
    }

    false
}

pub async fn handle_ws_upgrade(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    headers: HeaderMap,
    Query(query): Query<WsAuthQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !is_origin_allowed(&headers, &state.allowed_origins) {
        warn!("Rejected WebSocket upgrade with disallowed Origin header");
        return (StatusCode::FORBIDDEN, "Forbidden: Origin not allowed").into_response();
    }

    if state.active_ws_count() >= MAX_WS_CLIENTS {
        warn!(max = MAX_WS_CLIENTS, "Rejected WebSocket upgrade: max concurrent clients reached");
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Service Unavailable: Maximum WebSocket connections reached",
        )
            .into_response();
    }

    let ws = match ws {
        Ok(ws) => ws,
        Err(rejection) => return rejection.into_response(),
    };

    let authenticated = is_ws_authenticated(&headers, &query, &state);

    ws.max_message_size(MAX_WS_PAYLOAD_BYTES)
        .max_frame_size(MAX_WS_PAYLOAD_BYTES)
        .on_upgrade(move |socket| handle_ws_client(socket, state, authenticated))
        .into_response()
}

async fn handle_ws_client(socket: WebSocket, state: AppState, authenticated: bool) {
    // Track connection count
    let client_count = state.active_ws_clients.fetch_add(1, Ordering::Relaxed) + 1;
    info!(total_clients = client_count, authenticated, "New WebSocket client connected");

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut rx = state.tx.subscribe();
    let mut themes_registered_by_client = false;

    // Send initial connection welcome with current clock config
    {
        let cfg = state.config.read().await.clone();
        let themes = state.available_themes.read().await.clone();
        let init_msg = json!({
            "type": "init",
            "connected": true,
            "version": env!("CARGO_PKG_VERSION"),
            "config": cfg,
            "availableThemes": themes
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
                        handle_client_text_message(
                            &state,
                            &text,
                            authenticated,
                            &mut themes_registered_by_client,
                        )
                        .await;
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

async fn handle_client_text_message(
    state: &AppState,
    text: &str,
    authenticated: bool,
    themes_registered: &mut bool,
) {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
        let msg_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if msg_type == "register_themes" {
            if state.api_token.is_some() && !authenticated {
                warn!("Rejected unauthenticated 'register_themes' WebSocket message");
                return;
            }
            if *themes_registered {
                warn!("Ignoring duplicate 'register_themes' on same WebSocket connection");
                return;
            }
            *themes_registered = true;

            let mut extracted_themes = Vec::new();
            if let Some(themes_array) = val.get("themes").and_then(|t| t.as_array()) {
                for item in themes_array.iter().take(MAX_THEMES_COUNT) {
                    if let Some(s) = item.as_str() {
                        let trimmed = s.trim();
                        if is_valid_theme_id(trimmed) {
                            extracted_themes.push(trimmed.to_string());
                        }
                    } else if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                        let trimmed = id.trim();
                        if is_valid_theme_id(trimmed) {
                            extracted_themes.push(trimmed.to_string());
                        }
                    }
                }
            }

            if !extracted_themes.is_empty() {
                info!(count = extracted_themes.len(), themes = ?extracted_themes, "Registering themes from client");
                state.update_available_themes(extracted_themes).await;
            }

            if authenticated {
                if let Some(active) = val.get("activeTheme").and_then(|a| a.as_str()) {
                    let trimmed = active.trim();
                    if is_valid_theme_id(trimmed) {
                        let mut c = state.config.write().await;
                        c.theme = trimmed.to_string();
                    }
                }
            }
        }
    }
}
