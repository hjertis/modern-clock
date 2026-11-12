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

