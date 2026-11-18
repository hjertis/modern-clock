# 🕰️ Digital Grandfather Clock — Backend Daemon

Lightweight, high-performance local ingestion pipeline, MQTT bridge, and WebSocket broadcaster built with **Rust** (`axum` + `tokio` + `rumqttc`).

---

## ⚡ Features

- **Internal Broadcast Engine**: Zero-copy event fan-out with `tokio::sync::broadcast::channel(100)` to all active WebSocket clients.
- **REST Endpoints (`/api/`)**:
  - `POST /api/notify`: Ingests alerts/notifications and broadcasts them to connected portrait UI displays.
  - `POST /api/config`: Remotely updates clock theme, sleep mode override, or hand movement mode (`tick` / `sweep`).
  - `GET /api/config`: Reads active runtime configuration.
  - `GET /api/health`: Uptime, connected WebSocket client count, and MQTT connectivity status.
- **WebSocket Gateway (`/ws`)**:
  - Upgrades client connections, pushes initial clock state, streams real-time broadcast events, and manages ping/pong keep-alives.
- **MQTT Bridge**:
  - Persistent background worker connecting to local MQTT brokers (e.g. Mosquitto, Home Assistant).
  - Subscribes to `{prefix}/#` and `homeassistant/status` for Home Assistant auto-discovery and control.
  - Automatic reconnection with capped exponential backoff and jitter (1s up to 60s), plus clean `offline` status on `SIGINT`/`SIGTERM`.

---

## 🚀 Quick Start with Docker Compose

Run the hardened production container:

```bash
MQTT_HOST=192.168.1.50 docker compose -f compose.yaml up -d --build
```

The daemon listens on port `8088` (HTTP, static frontend, & WebSocket).

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8088` | HTTP & WebSocket listen port |
| `STATIC_DIR` | `./static` | Static frontend assets directory |
| `RUST_LOG` | `grandfather_clock_backend=info,tower_http=info` | `tracing_subscriber` log filter |
| `API_TOKEN` | *(unset)* | Optional Bearer token required for `POST /api/notify`, `POST /api/config`, and WS `register_themes` |
| `ALLOWED_ORIGINS` | *(unset / same-origin)* | Comma-separated CORS & WebSocket `Origin` allowlist |
| `MQTT_HOST` / `MQTT_BROKER_HOST` | `127.0.0.1` (`mosquitto` in `compose.yaml`) | MQTT broker host |
| `MQTT_PORT` / `MQTT_BROKER_PORT` | `1883` | MQTT broker port |
| `MQTT_CLIENT_ID` | `<prefix>_backend_<pid>` | MQTT client ID |
| `MQTT_USER` / `MQTT_USERNAME` | *(unset)* | Optional MQTT username |
| `MQTT_PASS` / `MQTT_PASSWORD` | *(unset)* | Optional MQTT password |
| `MQTT_PREFIX` | `grandfather_clock` | Base MQTT topic prefix |

---

## 🧪 Testing with cURL

### 1. Push an Alert / Notification
```bash
curl -X POST http://localhost:8088/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Front Door",
    "message": "Package delivered",
    "category": "doorbell",
    "priority": "normal",
    "durationMs": 8000
  }'
```

### 2. Push an Urgent Alert
```bash
curl -X POST http://localhost:8088/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Security Alert",
    "message": "Motion detected in backyard",
    "category": "securityAlert",
    "priority": "urgent",
    "durationMs": 10000
  }'
```

### 3. Switch Clock Theme & Hand Mode Remotely
```bash
curl -X POST http://localhost:8088/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "pcb_2049",
    "mode": "tick",
    "sleepOverride": false
  }'
```

### 4. Health Check
```bash
curl http://localhost:8088/api/health
```

---

## 📡 MQTT Topics (default prefix: `grandfather_clock`)

### Inbound Command Topics
- `grandfather_clock/notify`: JSON (`NotificationRequest` or `{title, message, category, priority, durationMs}`) or plain text
- `grandfather_clock/config`: JSON (`{theme, sleepOverride, mode}`)
- `grandfather_clock/theme/set`, `grandfather_clock/theme`, `grandfather_clock/set_theme`: Switch active theme
- `grandfather_clock/chime/test`, `grandfather_clock/chime`, `grandfather_clock/test_chime`: Trigger test chime
- `grandfather_clock/sleep/set`, `grandfather_clock/sleep`: Toggle sleep mode (`ON`/`OFF`)
- `grandfather_clock/volume/set`: Set chime volume (`0`–`100`)
- `homeassistant/status`: Re-publishes HA discovery when `online`

### Outbound State & Home Assistant Discovery Topics
- `grandfather_clock/status`: Availability (`online` / `offline`, retained + LWT)
- `grandfather_clock/theme/state`, `grandfather_clock/sleep/state`, `grandfather_clock/volume/state`
- `homeassistant/select/<prefix>_theme/config`
- `homeassistant/button/<prefix>_test_chime/config`
- `homeassistant/switch/<prefix>_sleep_mode/config`
- `homeassistant/number/<prefix>_volume/config`

```bash
# Push notification over MQTT
mosquitto_pub -h localhost -p 1883 -t grandfather_clock/notify -m '{
  "title": "Garage Door",
  "message": "Door left open for 10 minutes",
  "category": "securityAlert",
  "priority": "urgent",
  "durationMs": 8000
}'

# Push theme/config update over MQTT
mosquitto_pub -h localhost -p 1883 -t grandfather_clock/config -m '{
  "theme": "vienna_classic",
  "mode": "sweep"
}'
```

---

## 🔌 WebSocket Connection

Connect your frontend kiosk to:
```
ws://localhost:8088/ws
```

Upon connection, the daemon delivers an initial handshake:
```json
{
  "type": "init",
  "connected": true,
  "version": "0.1.0",
  "config": {
    "theme": "default",
    "sleepOverride": false,
    "mode": "sweep"
  }
}
```

And subsequent events stream in real time:
```json
{
  "type": "notify",
  "id": "notif_1731216000000_a1b2c3d4",
  "title": "Front Door",
  "message": "Package delivered",
  "priority": "normal",
  "durationMs": 8000,
  "timeoutMs": 8000,
  "category": "info",
  "timestamp": "2026-11-10T05:30:00Z"
}
```

