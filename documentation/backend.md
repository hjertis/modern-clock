# 🖥️ Backend Architecture & Daemon Specification

---

## 🏗️ Architecture Breakdown

```
[ Home Assistant / Mosquitto ]
             │ (MQTT over TCP)
             ▼
┌───────────────────────────────────────────────┐
│              LOCAL BACKEND DAEMON             │
│  - MQTT Client & HA Discovery Publisher       │
│  - REST API (/api/notify, /api/theme, etc.)   │
│  - Audio Player (system ALSA/Pulse chime out) │
│  - Internal WebSocket Server (ws://localhost) │
└──────────────────────┬────────────────────────┘
                       │ (JSON Event Stream)
                       ▼
┌───────────────────────────────────────────────┐
│               FRONTEND (KIOSK)                │
│  - High-precision 60 fps render loop          │
│  - Pure display consumer (DOM/SVG transforms) │
│  - No direct network or protocol dependencies │
└───────────────────────────────────────────────┘
```

---

## ⚙️ What the Backend Handles

### 1. 📡 Home Assistant MQTT Discovery
On startup, the backend connects to your local MQTT broker and publishes discovery payloads to topics such as:
* `homeassistant/notify/grandfather_clock/config`
* `homeassistant/select/grandfather_clock_theme/config`

Home Assistant immediately discovers and registers the clock as a native device with the following entities:

| Entity ID | Component | Description |
| :--- | :--- | :--- |
| `notify.grandfather_clock` | `notify` | Ingests alert messages, titles, and optional priority. |
| `select.grandfather_clock_theme` | `select` | Dropdown in HA listing all available themes found in `/themes`. |
| `switch.grandfather_clock_sleep_mode` | `switch` | Manual override to force sleep or wake. |
| `number.grandfather_clock_chime_volume` | `number` | Audio level slider (0–100%). |

---

### 2. 🔀 The Ingestion Pipeline
* **Multi-Source Ingestion**: Ingests alerts via MQTT topics or HTTP `POST /api/notify`.
* **Sanitization & Relay**: Sanitizes incoming payloads and pushes clean JSON events across the local WebSocket directly into the frontend.
* **Resilience**: If the kiosk display reloads or crashes, the backend daemon stays alive, preserves the MQTT session, and queues any unacknowledged critical state.

---

### 3. 🔌 True Local Hardware Control
When mounted in a physical cabinet with a single-board computer (e.g., Raspberry Pi):
* **Ambient Light Sensing**: Reads hardware I2C ambient light sensors to automatically modulate screen backlight via `ddcutil` or PWM.
* **Security & Isolation**: The browser runs unprivileged as a pure presentation layer while the backend manages system-level hardware interfaces.

---

## 🛠️ Implementation Tech Stack Options

Depending on your maintenance and deployment preferences:

### Option A: Node.js / Bun (TypeScript)
* **Single Language**: Keeps the entire codebase (frontend and backend) unified in TypeScript.
* **Rapid Iteration**: Runs side-by-side with Vite using standard libraries: `mqtt`, `ws`, and `fastify` or `express`.

### Option B: Rust
* **Zero Overhead**: Single, statically compiled binary with near-zero RAM footprint and instant startup.
* **Embedded-Ready**: Ideal for low-spec single-board computers (SBCs) or long-term appliance reliability.

---

> [!NOTE]
> The backend acts as an abstraction barrier: the frontend kiosk remains completely isolated from MQTT/network protocols, consuming only unified WebSocket JSON events.
