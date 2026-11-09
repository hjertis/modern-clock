# 📋 Architecture Punch List (Updated with #4 & #5)

Here is the revised, hardened list of deliverables ready for implementation:

---

## 1. 🌉 Backend daemon: WebSocket + REST ingestion bridge

Local lightweight daemon (Express / Fastify / Node) running alongside Vite.

- `POST /api/notify`: Ingests alerts over LAN and relays to the clock UI via WebSockets.
- `POST /api/config`: Live-updates active theme or settings remotely.

---

## 2. 🔊 Mechanical & Escapement Audio Synthesis

Procedural or sample-based audio engine for authentic acoustics:

- **Tick-Tock Escapement**: Subtle sample / procedural playback mapped to pendulum beat or second step.
- **Chime System**: Hourly chime strike with volume slider and audio mute hook.

---

## 3. 📡 Home Assistant MQTT Auto-Discovery

Seamless smart-home ecosystem integration:

- Clock daemon connects to the local MQTT broker and registers as standard Home Assistant `notify` and `media_player` entities.
- Immediate plug-and-play with existing door, motion, and sensor automations.

---

## 4. 🖲️ The Torture-Test Theme: _"PCB-2049 / Industrial Silicon"_

High-complexity technical skin to rigorously validate Host vs. Skin decoupling:

- **Case**: Matte dark green or matte black soldermask PCB substrate with copper trace routing and silkscreen legends (`C1206`, `R0805`, `TP14`).
- **Dial**: Gold immersion circular calibration ring with crisp technical ticks and crosshairs.
- **Hands**: Bright fluor-orange and yellow high-precision machine needles.
- **Pendulum**: Exposed immersion-gold test bob hanging from a flexible polyimide ribbon trace.
- **Notifications**: High-contrast retro industrial data terminal cards with amber monospace typography.

---

## 5. 🐱 Cat-Safe Night Silence & Sleep Mode

Intelligent nighttime safety and power/distraction-saving window:

- **Scheduled Quiet Window**: Configurable schedule (e.g., `23:00` to `07:00`).
- **Audio Mute**: Zero chimes or tick sounds during quiet hours.
- **Pendulum Damping**: Gradual exponential amplitude decay ($\theta \to 0^\circ$) over 6 seconds to a dead-center park.
- **Display Dimming**: Deep black level drop on the chamber, faint amber glow on the dial.
- **Urgent Override**: Bypasses sleep state for critical alert payloads.

---

> [!TIP]
> **Next Step**: Choose whether to tackle **#1 (Ingestion Bridge)** and **#5 (Sleep Mode)** first, or unleash **#4 (PCB-2049 Theme)** directly.
