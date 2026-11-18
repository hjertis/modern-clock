# Creating Custom Themes

This guide explains how to build and register new 2D Canvas and Three.js themes using the standardized `ClockTheme` interface, shared helpers (`src/themes/helpers.ts`), and copy-paste starter templates (`src/themes/_template-2d/` and `src/themes/_template-3d/`).

---

## 3-Step Workflow

### Step 1: Copy a Starter Template

Choose the template that matches your rendering backend and copy it into `src/themes/<your_theme_id>/`:

- **2D Canvas theme:** Copy `src/themes/_template-2d/index.ts` to `src/themes/<your_theme_id>/index.ts`
- **Three.js 3D theme:** Copy `src/themes/_template-3d/index.ts` to `src/themes/<your_theme_id>/index.ts`

Because the templates already live under `src/themes/`, all relative imports (`../../types/theme`, `../types`, `../helpers`, `../three/ThreeStage`) work immediately with zero import path edits. Set a unique `id` (snake_case), `name`, and `renderer` (`'2d' | 'three'`):

```ts
export class MyCustomTheme implements ClockTheme {
  public readonly id = 'my_custom_theme';
  public readonly name = 'My Custom Theme';
  public readonly renderer = 'three' as const;
  // ...
}
```

### Step 2: Customize Visuals

Each template already implements the full `ClockTheme` lifecycle:

- `init(config?, canvasContext?)` — Initializes canvas or `ThreeStage`, builds the background (`1080×1920` with `±500 px` bleed margins), `dialGroup`, and hand pivots.
- `update(timeState, delta)` — Rotates hour, minute, and second hands (`tick` or `sweep` via `timeState.angles`) and renders telemetry pulses.
- `resize(width?, height?)` — Updates viewport/camera dimensions.
- `setPresenceMode(mode)` — Handles `'active'`, `'silent'`, `'night'` (30 FPS), and `'sleep'` (Cat-Safe 1 FPS).
- `setDialCenter(x, y)` — Translates `dialGroup` relative to `(540, 540)` without moving the camera or full-screen background.
- `onEvent(event)` — Responds to `doorbell`, `securityAlert`, and `mode_change` events (normalized via `classifyThemeEvent(event)`).
- `dispose()` — Cleans up WebGL geometries, materials, textures, and stage resources.

Use the shared utilities in `src/themes/helpers.ts`:

| Helper | Purpose |
| :--- | :--- |
| `dialCenterToPixelOffset(x, y)` | Converts Dial Center `(x, y)` relative to `(540, 540)` into 2D canvas pixel deltas. |
| `dialCenterToWorldOffset(x, y)` | Converts Dial Center `(x, y)` into Three.js world-unit XY offsets (`100 px = 1.0` unit, Y-up). |
| `applyDialCenterToGroup(dialGroup, x, y, basePos?)` | Applies XY offsets strictly to `dialGroup` (never the camera or background). |
| `setStandardZLayer(obj, layer, offset?)` | Assigns standard back-to-front Z coordinates from `STANDARD_Z_LAYERS`. |
| `applySleepModeIsolation(mode, targets)` | Hides non-emissive groups while keeping `dialGroup`, `handsGroup`, and `emissiveIndicatorMeshes` visible above black-crush in Sleep mode. |
| `drawStandard2DBackground(ctx, fillStyle)` | Fills `1080×1920` plus `±500 px` bleed margins (`-500, -500, 2080, 2920`). |
| `classifyThemeEvent(event)` | Normalizes events into `'doorbell' \| 'securityAlert' \| 'mode_change' \| 'other'`. |

### Step 3: Register in the Theme Registry

Import your theme class in `src/themes/themeManager.ts` and register it in the `ThemeManager` constructor:

```ts
import { MyCustomTheme } from './my_custom_theme';

// Inside ThemeManager constructor:
this.registerTheme(() => new MyCustomTheme());
```

`ThemeManager.registerTheme()` accepts both `ClockTheme` and legacy `Theme` implementations (wrapping `ClockTheme` automatically via `adaptClockThemeToTheme()`).

*(Optional)* Add aliases in `ThemeManager.resolveThemeId()` if you want URL `?theme=` shortcuts, and add a pill label in `src/main.ts` (`updateThemePillLabel`).

> **Note:** Directories prefixed with `_` (`src/themes/_template-2d/` and `src/themes/_template-3d/`) are intentionally **not** registered in `ThemeManager`, keeping them excluded from the active theme switcher.

---

## Quick-Reference Table

| Category | Rule / Value | Notes |
| :--- | :--- | :--- |
| **Canvas Resolution** | `1080 × 1920` (portrait) | Fixed stage coordinate space (`STAGE_WIDTH × STAGE_HEIGHT`). |
| **Background Bleed Margins** | `±500 px` (`-500` to `1580` X, `-500` to `2420` Y) | Total coverage `2080 × 2920 px` (`20.8 × 29.2` world units) so parallax/camera drift never exposes edges. |
| **Dial Center Baseline** | `(540, 540)` | Default center in `1080×1920` pixel space (`DIAL_CENTER_BASELINE`). |
| **Three.js World Scale** | `100 px = 1.0` world unit | Origin `(0, 0)` maps to `(540, 960)` on canvas; Y-axis is inverted (`+Y` up in Three.js, `+Y` down on 2D canvas). |
| **Dial Offset Target** | `dialGroup` only | `setDialCenter(x, y)` must move `dialGroup` only — **never** shift the camera or background plane. |
| **Z-Layer: Background** | `-1.6` (`STANDARD_Z_LAYERS.BACKGROUND`) | Full-bleed backdrop plane. |
| **Z-Layer: Cabinet / Frame** | `-0.9` (`STANDARD_Z_LAYERS.CABINET_FRAME`) | Outer chassis, bezel, or housing. |
| **Z-Layer: Dial Plate & Gears** | `-0.3` (`STANDARD_Z_LAYERS.DIAL_PLATE_AND_GEARS`) | Chapter ring, indices, and mechanical gear train. |
| **Z-Layer: Porthole Glass** | `0.12` (`STANDARD_Z_LAYERS.PORTHOLE_GLASS`) | Translucent cover lens (must sit behind hands or remain non-occluding). |
| **Z-Layer: Hands & Hub Cap** | `0.24` (Hour), `0.32` (Minute), `0.40` (Second), `0.46` (Hub Cap) | Strictly frontmost layers (`HOUR_HAND < MINUTE_HAND < SECOND_HAND < HUB_CAP`). |
| **Presence Modes** | `'active'`, `'silent'`, `'night'` (30 FPS), `'sleep'` (1 FPS) | `ClockEngine` throttles FPS in `night` (30 FPS) and `sleep` (1 FPS) and locks/hides pendulum motion in `sleep`. |
| **Sleep (Cat-Safe) Isolation** | `dialGroup.visible = true`, `handsGroup.visible = true` | Never set `visible = false` on a parent of `handsGroup`. Keep `emissiveIndicatorMeshes` visible with `depthTest = false` over `#000000` black-crush. |
| **Telemetry Events** | `doorbell`, `securityAlert`, `mode_change` | Handle via `classifyThemeEvent(event)` inside `onEvent(event)`. |
| **HUD Calibration Controls** | `#input-dial-x`, `#input-dial-y`, `#btn-reset-dial-center` | Debug HUD (`H` key) updates `manifest.dial.center.x/y` in real time; `adaptClockThemeToTheme` forwards changes to `setDialCenter(x, y)`. |
