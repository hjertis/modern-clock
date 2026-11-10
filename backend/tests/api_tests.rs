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

