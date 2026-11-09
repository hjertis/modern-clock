# 🕰️ Digital Grandfather Clock Engine

An open-source, local-first **Digital Grandfather Clock** web engine designed to run on a portrait **1080 × 1920** display (e.g. wall-mounted kiosk screens, smart home dashboards, Raspberry Pi, or embedded displays).

Built with **Vanilla ES6+ TypeScript** and **Vite** with **zero runtime dependencies** for minimal CPU/memory footprint on low-power hardware.

---

## 🏛️ Architecture: Host vs. Skin Pattern

The system strictly decouples the clock engine from visual themes:

```
┌────────────────────────────────────────────────────────┐
│                      HOST ENGINE                       │
│  - Synchronized Master Clock Loop (requestAnimationFrame)│
│  - Simple Harmonic Motion Physics θ(t) = θ_max cos(ωt)  │
│  - Epoch-locked drift-free synchronization              │
│  - Dynamic Placement Engine (left/top/transform-origin)│
│  - Dynamic Notification & Glance Chamber Queue         │
│  - Developer Debug & Calibration HUD (Press H)         │
└──────────────────────────┬─────────────────────────────┘
                           │ Loads theme.json & SVG assets
┌──────────────────────────▼─────────────────────────────┐
│                      SKIN / THEME                      │
│  - themes/<theme-name>/theme.json                      │
│  - Case background (assets/case_back.svg)              │
│  - Dial face with chapter rings (assets/dial.svg)      │
│  - Hour, minute, second hands (assets/hand_*.svg)      │
│  - Pinion cap (assets/cap.svg)                         │
│  - Pendulum assembly & rating bob (assets/pendulum.svg)│
└────────────────────────────────────────────────────────┘
```

---

## 📐 Fixed 1080 × 1920 Canvas Reference

The internal coordinate space is strictly fixed at **1080 × 1920 (portrait)**:
- During development on desktop monitors, CSS containment auto-scales the canvas using hardware-accelerated transforms to fit any viewport while preserving the native 1080 × 1920 internal coordinate system.
- On a native 1080 × 1920 kiosk display or in fullscreen (`F11`), the canvas renders 1:1 pixel-perfect.

### Layered DOM Hierarchy
```
Layer 7: Debug Overlay & Calibration Crosshairs (#debug-crosshairs)
Layer 6: Pinion / Center Cap (#hand-cap)
Layer 5: Clock Hands (#hand-hour, #hand-minute, #hand-second)
Layer 4: Dial Face (#clock-dial)
Layer 3: Dynamic Notification / Glance Chamber (#notification-zone)
Layer 2: Pendulum Assembly (#clock-pendulum) [DIMS when Layer 3 active]
Layer 1: Background Wood Case (#clock-bg)
```

---

## 📜 Theme Manifest Specification (`theme.json`)

Every theme resides in `themes/<theme-name>/` (and mirrored in `public/themes/<theme-name>/`):

```json
{
  "name": "Vienna Classic",
  "version": "1.0.0",
  "author": "Maker",
  "background": "assets/case_back.svg",
  "dial": {
    "image": "assets/dial.svg",
    "center": { "x": 540, "y": 540 }
  },
  "hands": {
    "hour": {
      "image": "assets/hand_hour.svg",
      "pivot": { "x": 20, "y": 280 }
    },
    "minute": {
      "image": "assets/hand_minute.svg",
      "pivot": { "x": 16, "y": 420 }
    },
    "second": {
      "image": "assets/hand_second.svg",
      "pivot": { "x": 8, "y": 420 },
      "mode": "tick"
    },
    "cap": {
      "image": "assets/cap.svg",
      "center": { "x": 25, "y": 25 }
    }
  },
  "pendulum": {
    "image": "assets/pendulum.svg",
    "pivot": { "x": 540, "y": 820 },
    "anchor": { "x": 50, "y": 20 },
    "periodSeconds": 2.0,
    "maxAngleDeg": 6.0
  },
  "notificationZone": {
    "x": 140,
    "y": 1250,
    "width": 800,
    "height": 450
  }
}
```

### Dynamic Placement Engine Math
1. **Dial Alignment**: Centered directly over `dial.center` in canvas coordinates.
2. **Hand Rotation**: Positioned at `left = dial.center.x - pivot.x`, `top = dial.center.y - pivot.y` with `transform-origin: ${pivot.x}px ${pivot.y}px`. The hand rotates precisely around the dial center without drifting.
3. **Pendulum Hinge**: Positioned at `left = pendulum.pivot.x - anchor.x`, `top = pendulum.pivot.y - anchor.y` with `transform-origin: ${anchor.x}px ${anchor.y}px`.
4. **Pendulum Simple Harmonic Motion**:
   $$\theta(t) = \theta_{\max} \cdot \cos\left(\frac{2\pi}{T} \cdot t\right)$$
   where $t$ is locked to true epoch time in seconds, guaranteeing natural, non-drifting harmonic oscillation.

---

## 🔔 Dynamic Notification Chamber & Public API

The engine exposes a public API at `window.clock`:

```javascript
// Trigger a notification (e.g. from Home Assistant, Webhook, or MQTT script)
window.clock.notify({
  title: 'Front Doorbell',
  message: 'Motion detected at front entrance — package arrived.',
  category: 'doorbell', // 'doorbell' | 'alert' | 'calendar' | 'weather' | 'info'
  timeoutMs: 6500
});

// Toggle between discrete ticking and continuous sweep
window.clock.toggleMode(); // 'tick' or 'sweep'

// Fast forward time by 10x for inspection
window.clock.setTimeMultiplier(10.0);
```

While notifications are displayed in the glance chamber, the pendulum behind it is smoothly dimmed and softly blurred via CSS transitions (`transition: opacity 0.65s, filter 0.65s`).

---

## 🛠️ Developer Debug & Calibration HUD

Press **`H`** on your keyboard (or click the floating pill button) to open the HUD:
- **Live Dial Calibration**: Sliders and numeric inputs to live-tweak `dial.center.x` and `dial.center.y`.
- **Live Pivot Calibration**: Tweak `pivot.x` and `pivot.y` for hour, minute, and second hands.
- **Pendulum Tuning**: Adjust hinge pivot, anchor, oscillation period $T$, and max amplitude $\theta_{\max}$.
- **Alignment Crosshairs**: Toggle red visual crosshairs on dial center, hand pivots, pendulum hinge, and notification boundaries.
- **Interactive Triggers**: "Simulate Doorbell", "Toggle Tick / Sweep", "10x Fast-Forward", and "Copy theme.json" (copies calibrated configuration directly to your clipboard).

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Build for Production
```bash
npm run build
npm run preview
```
Output is bundled cleanly into `dist/`.

