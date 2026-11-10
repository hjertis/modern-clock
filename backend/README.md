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
  - Subscribes to `grandfather_clock/notify` and `grandfather_clock/config`.
  - Automatic reconnection with exponential backoff.
- **Hot-Reload Docker Setup**:
  - Sub-2-second rebuilds using `cargo-watch` with volume-cached Cargo registry and build artifacts.

---

## 🚀 Quick Start with Docker Compose

Run the backend daemon and an isolated Mosquitto broker:

```bash
docker compose -f docker-compose.dev.yml up
```

The daemon will start on port `8080` (HTTP & WebSocket) and Mosquitto on `1883`.

---

## 🧪 Testing with cURL

### 1. Push an Alert / Notification
```bash
curl -X POST http://localhost:8080/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Front Door",
    "message": "Package delivered",
    "priority": "normal",
    "durationMs": 8000
  }'
```

### 2. Push an Urgent Alert
```bash
curl -X POST http://localhost:8080/api/notify \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Security Alert",
    "message": "Motion detected in backyard",
    "priority": "urgent",
    "durationMs": 10000
  }'
```

### 3. Switch Clock Theme & Hand Mode Remotely
```bash
curl -X POST http://localhost:8080/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "pcb-2049",
    "mode": "tick",
    "sleepOverride": false
  }'
```

### 4. Health Check
```bash
curl http://localhost:8080/api/health
```

---

## 📡 Testing via MQTT

Publish directly to the local broker:

```bash
# Push notification over MQTT
mosquitto_pub -h localhost -p 1883 -t grandfather_clock/notify -m '{
  "title": "Garage Door",
  "message": "Door left open for 10 minutes",
  "priority": "urgent",
  "durationMs": 8000
}'

# Push theme/config update over MQTT
mosquitto_pub -h localhost -p 1883 -t grandfather_clock/config -m '{
  "theme": "default",
  "mode": "sweep"
}'
```

---

## 🔌 WebSocket Connection

Connect your frontend kiosk to:
```
ws://localhost:8080/ws
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

