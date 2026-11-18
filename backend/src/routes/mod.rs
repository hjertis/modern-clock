pub mod config;
pub mod health;
pub mod notify;
pub mod ws;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde_json::json;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
};
use tracing::warn;

use crate::state::AppState;

const MAX_HTTP_BODY_BYTES: usize = 16 * 1024;

async fn require_auth_and_rate_limit(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if let Some(ref expected_token) = state.api_token {
        let provided = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.trim());

        if provided != Some(expected_token.as_str()) {
            warn!(uri = %req.uri(), "Rejected unauthorized API request");
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "status": "error",
                    "message": "Unauthorized: invalid or missing Bearer token"
                })),
            )
                .into_response();
        }
    }

    if !state.check_rate_limit() {
        warn!(uri = %req.uri(), "Rate limit exceeded on protected API endpoint");
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "status": "error",
                "message": "Too Many Requests: rate limit exceeded"
            })),
        )
            .into_response();
    }

    next.run(req).await
}

pub fn build_cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let parsed: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();

    if parsed.is_empty() {
        // Same-origin only (no Access-Control-Allow-Origin wildcard)
        base
    } else {
        base.allow_origin(AllowOrigin::list(parsed))
    }
}

pub fn create_router(state: AppState) -> Router {
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "./static".to_string());
    let index_file = format!("{}/index.html", static_dir);
    let serve_dir = ServeDir::new(&static_dir).fallback(ServeFile::new(&index_file));

    let cors = build_cors_layer(&state.allowed_origins);

    let protected_post_routes = Router::new()
        .route("/api/notify", post(notify::handle_notify))
        .route("/api/config", post(config::handle_update_config))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_auth_and_rate_limit,
        ));

    Router::new()
        .merge(protected_post_routes)
        .route("/ws", get(ws::handle_ws_upgrade))
        .route("/api/config", get(config::handle_get_config))
        .route("/api/health", get(health::handle_health))
        .fallback_service(serve_dir)
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .layer(cors)
        .with_state(state)
}

