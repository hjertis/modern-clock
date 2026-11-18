use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use grandfather_clock_backend::{routes::create_router, state::AppState};

#[tokio::test]
async fn test_health_endpoint() {
    let state = AppState::new();
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["status"], "ok");
    assert!(json["uptimeSeconds"].is_number());
    assert_eq!(json["activeWsClients"], 0);
}

#[tokio::test]
async fn test_notify_endpoint_success() {
    let state = AppState::new();
    let mut rx = state.tx.subscribe();
    let app = create_router(state);

    let payload = serde_json::json!({
        "title": "Front Door",
        "message": "Package delivered",
        "priority": "normal",
        "durationMs": 8000
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");

    // Verify broadcast event was pushed to channel
    let broadcast_raw = rx.recv().await.expect("Expected broadcast event");
    let broadcast_json: Value = serde_json::from_str(&broadcast_raw).unwrap();
    assert_eq!(broadcast_json["type"], "notify");
    assert_eq!(broadcast_json["title"], "Front Door");
    assert_eq!(broadcast_json["message"], "Package delivered");
    assert_eq!(broadcast_json["priority"], "normal");
    assert_eq!(broadcast_json["durationMs"], 8000);
}

#[tokio::test]
async fn test_notify_endpoint_validation_failure() {
    let state = AppState::new();
    let app = create_router(state);

    let invalid_payload = serde_json::json!({
        "title": "   ",
        "message": "Package delivered"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(invalid_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_config_endpoint() {
    let state = AppState::new();
    let mut rx = state.tx.subscribe();
    let app = create_router(state.clone());

    let payload = serde_json::json!({
        "theme": "pcb-2049",
        "sleepOverride": true,
        "mode": "tick"
    });

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/config")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify state was updated
    {
        let current = state.config.read().await;
        assert_eq!(current.theme, "pcb-2049");
        assert_eq!(current.sleep_override, true);
        assert_eq!(current.mode, "tick");
    }

    // Verify broadcast event was pushed
    let broadcast_raw = rx.recv().await.expect("Expected broadcast event");
    let broadcast_json: Value = serde_json::from_str(&broadcast_raw).unwrap();
    assert_eq!(broadcast_json["type"], "config");
    assert_eq!(broadcast_json["theme"], "pcb-2049");
    assert_eq!(broadcast_json["sleepOverride"], true);
    assert_eq!(broadcast_json["mode"], "tick");

    // Verify GET /api/config
    let get_resp = app
        .oneshot(
            Request::builder()
                .uri("/api/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(get_resp.status(), StatusCode::OK);
    let body = get_resp.into_body().collect().await.unwrap().to_bytes();
    let current_json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(current_json["theme"], "pcb-2049");
}

#[tokio::test]
async fn test_static_files_and_fallback() {
    let temp_dir = std::env::temp_dir().join(format!("clock_test_{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let index_file = temp_dir.join("index.html");
    std::fs::write(&index_file, "<html><body>Grandfather Clock</body></html>").unwrap();
    let asset_file = temp_dir.join("test.js");
    std::fs::write(&asset_file, "console.log('test');").unwrap();

    std::env::set_var("STATIC_DIR", temp_dir.to_str().unwrap());

    let state = AppState::new();
    let app = create_router(state);

    // Test GET /
    let res_root = app
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res_root.status(), StatusCode::OK);
    let body = res_root.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&body).contains("Grandfather Clock"));

    // Test GET /test.js
    let res_asset = app
        .clone()
        .oneshot(Request::builder().uri("/test.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res_asset.status(), StatusCode::OK);
    let body = res_asset.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&body).contains("console.log('test')"));

    // Test fallback for unknown route /some/spa/route
    let res_fallback = app
        .oneshot(Request::builder().uri("/some/spa/route").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res_fallback.status(), StatusCode::OK);
    let body = res_fallback.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&body).contains("Grandfather Clock"));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_dynamic_ha_discovery_theme_options() {
    use grandfather_clock_backend::mqtt::build_ha_theme_select_payload;

    let state = AppState::new();

    // 1. Verify default themes in state
    {
        let themes = state.available_themes.read().await;
        assert_eq!(*themes, vec!["vienna_classic", "pcb_2049", "pcb_2049_emerald"]);
    }

    // 2. Verify initial discovery payload options
    let prefix = "test_clock";
    let initial_payload = {
        let themes = state.available_themes.read().await;
        build_ha_theme_select_payload(prefix, &themes)
    };

    assert_eq!(
        initial_payload["options"],
        serde_json::json!(["vienna_classic", "pcb_2049", "pcb_2049_emerald"])
    );
    assert_eq!(initial_payload["command_topic"], "test_clock/theme/set");
    assert_eq!(initial_payload["state_topic"], "test_clock/theme/state");
    assert_eq!(initial_payload["unique_id"], "test_clock_theme");

    // 3. Receive dynamic theme list registration (e.g. from frontend client)
    let new_themes = vec![
        "vienna_classic".to_string(),
        "pcb_2049".to_string(),
        "pcb_2049_emerald".to_string(),
        "steampunk_brass".to_string(),
        "cyberpunk_neon".to_string(),
    ];

    let changed = state.update_available_themes(new_themes.clone()).await;
    assert!(changed);

    // Verify state was updated
    {
        let themes = state.available_themes.read().await;
        assert_eq!(*themes, new_themes);
    }

    // 4. Verify updated discovery payload has new options
    let updated_payload = {
        let themes = state.available_themes.read().await;
        build_ha_theme_select_payload(prefix, &themes)
    };

    assert_eq!(
        updated_payload["options"],
        serde_json::json!([
            "vienna_classic",
            "pcb_2049",
            "pcb_2049_emerald",
            "steampunk_brass",
            "cyberpunk_neon"
        ])
    );

    // 5. Duplicate call should return false (no-op when list unchanged)
    let unchanged = state.update_available_themes(new_themes).await;
    assert!(!unchanged);
}

#[tokio::test]
async fn test_bearer_token_auth_when_configured() {
    let state = AppState::with_security(Some("super-secret-token".to_string()), vec![]);
    let app = create_router(state);

    let payload = serde_json::json!({
        "title": "Doorbell",
        "message": "Someone is at the door",
        "category": "doorbell"
    });

    // 1. Missing token -> 401
    let unauth_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauth_resp.status(), StatusCode::UNAUTHORIZED);

    // 2. Wrong token -> 401
    let wrong_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/config")
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer wrong-token")
                .body(Body::from(r#"{"mode":"tick"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_resp.status(), StatusCode::UNAUTHORIZED);

    // 3. Valid token -> 200
    let ok_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer super-secret-token")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_resp.status(), StatusCode::OK);

    // 4. Health remains open without token -> 200
    let health_resp = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_payload_bounds_and_category_passthrough() {
    let state = AppState::with_security(None, vec![]);
    let mut rx = state.tx.subscribe();
    let app = create_router(state);

    // 1. Category passthrough
    let doorbell_payload = serde_json::json!({
        "title": "Front Door",
        "message": "Ring",
        "category": "doorbell",
        "priority": "normal"
    });
    let ok_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(doorbell_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_resp.status(), StatusCode::OK);

    let broadcast_raw = rx.recv().await.unwrap();
    let broadcast_json: Value = serde_json::from_str(&broadcast_raw).unwrap();
    assert_eq!(broadcast_json["category"], "doorbell");

    // 2. Oversized title (> 120 chars) -> 400
    let long_title = serde_json::json!({
        "title": "a".repeat(121),
        "message": "ok"
    });
    let resp_title = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(long_title.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_title.status(), StatusCode::BAD_REQUEST);

    // 3. Oversized message (> 500 chars) -> 400
    let long_msg = serde_json::json!({
        "title": "ok",
        "message": "b".repeat(501)
    });
    let resp_msg = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(long_msg.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_msg.status(), StatusCode::BAD_REQUEST);

    // 4. Oversized theme (> 64 chars) -> 400
    let long_theme = serde_json::json!({
        "theme": "c".repeat(65)
    });
    let resp_theme = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/config")
                .header("Content-Type", "application/json")
                .body(Body::from(long_theme.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_theme.status(), StatusCode::BAD_REQUEST);

    // 5. Body > 16 KB -> 413 Payload Too Large
    let huge_body = format!(r#"{{"title":"t","message":"{}"}}"#, "x".repeat(17 * 1024));
    let resp_huge = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/notify")
                .header("Content-Type", "application/json")
                .body(Body::from(huge_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp_huge.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_rate_limiting_and_cors_allowlist() {
    let state = AppState::with_security(None, vec!["https://clock.example.com".to_string()]);
    let app = create_router(state);

    // 1. CORS allows configured origin, not arbitrary origin
    let cors_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("Origin", "https://clock.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        cors_ok.headers().get("access-control-allow-origin").unwrap(),
        "https://clock.example.com"
    );

    let cors_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("Origin", "https://evil.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(cors_denied.headers().get("access-control-allow-origin").is_none());

    // 2. Rate limit: 10 requests/sec allowed, 11th rejected with 429
    for i in 0..10 {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/config")
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"mode":"sweep"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "request {} should succeed", i);
    }

    let rate_limited = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/config")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"mode":"sweep"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rate_limited.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_ws_origin_rejection_and_connection_cap() {
    let state = AppState::with_security(None, vec![]);
    let app = create_router(state.clone());

    // Mismatched Origin on WS upgrade -> 403 Forbidden
    let bad_origin_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/ws")
                .header("Host", "localhost:8088")
                .header("Origin", "https://evil.example.com")
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_origin_resp.status(), StatusCode::FORBIDDEN);

    // At max concurrent WS clients (16) -> 503 Service Unavailable
    state
        .active_ws_clients
        .store(16, std::sync::atomic::Ordering::Relaxed);
    let capped_resp = app
        .oneshot(
            Request::builder()
                .uri("/ws")
                .header("Host", "localhost:8088")
                .header("Origin", "http://localhost:8088")
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(capped_resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn test_mqtt_exponential_backoff_bounds() {
    use grandfather_clock_backend::mqtt::compute_reconnect_backoff;
    use std::time::Duration;

    let b0 = compute_reconnect_backoff(0);
    assert!(b0 >= Duration::from_secs(1) && b0 < Duration::from_secs(2));

    let b3 = compute_reconnect_backoff(3);
    assert!(b3 >= Duration::from_secs(8) && b3 < Duration::from_secs(9));

    let b10 = compute_reconnect_backoff(10);
    assert!(b10 >= Duration::from_secs(60) && b10 < Duration::from_secs(61));
}

