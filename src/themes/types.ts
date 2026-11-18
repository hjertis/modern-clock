import { HandMode, NotificationPayload, Point2D, ThemeManifest, ClockMode } from '../types/theme';
import { HandAngles } from '../utils/math';
import { WSStatus } from '../core/wsClient';
import { DisplayOptions, SynchronizedTimeTick } from '../core/timeFormatter';

export type { ClockMode };

export type ThemeId =
  | 'vienna_classic'
  | 'pcb_2049'
  | 'pcb_2049_emerald'
  | 'hybrid_base'
  | 'nixie_hybrid'
  | 'tourbillon_3d'
  | 'reactor_3d'
  | 'orrery_3d'
  | 'mariana_abyss'
  | 'vector_oscilloscope'
  | string;

export interface ThemeConfig {
  width: number;
  height: number;
  manifest?: ThemeManifest;
  stageElement?: HTMLElement;
  wsUrl?: string;
}

export interface TimeData {
  date: Date;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  angles: HandAngles;
  secondMode: HandMode;
  timestampMs: number;
  realTimeMs: number;
  deltaTimeSec: number;
  displayOptions?: DisplayOptions;
  digitalTick?: SynchronizedTimeTick;
}

export interface PhysicsData {
  /** Current harmonic swing angle θ(t) in degrees */
  angleDeg: number;
  /** Current harmonic swing angle θ(t) in radians */
  angleRad: number;
  /** Normalized angular velocity dθ/dt in [-1, 1] */
  angularVelocityNorm: number;
  /** Angular velocity in rad/s */
  angularVelocityRad: number;
  /** Normalized harmonic phase in [0, 1) */
  phase: number;
  /** Harmonic phase in radians [0, 2π) */
  phaseRad: number;
  /** Oscillation period T in seconds */
  periodSeconds: number;
  /** Maximum swing amplitude θ_max in degrees */
  maxAngleDeg: number;
  /** Sleep damping factor in [0, 1] */
  dampingFactor: number;
  /** True when the notification chamber is active and dimming the pendulum */
  dimmed: boolean;
  /** Pendulum hinge pivot on the 1080x1920 canvas */
  pivot: Point2D;
  /** Continuous simulated time in seconds */
  timeSec: number;
}

export interface TelemetryData {
  fps: number;
  frameTimeMs: number;
  wsStatus: WSStatus;
  wsUrl: string;
  pendulumAngleDeg: number;
  pendulumPhaseDeg: number;
  pendulumAngularVelocity: number;
  pendulumPeriodSec: number;
  secondMode: HandMode;
  timeMultiplier: number;
  isSleeping: boolean;
  mode?: ClockMode;
  showDebugGrid: boolean;
  activeNotificationsCount: number;
  currentDate: Date;
}

export interface ThemeEvent {
  type:
    | 'notification'
    | 'mqtt_pulse'
    | 'priority_alert'
    | 'config_change'
    | 'chime'
    | 'mode_change'
    | 'doorbell'
    | 'securityAlert';
  priority?: 'normal' | 'urgent';
  category?: 'alert' | 'info' | 'doorbell' | 'calendar' | 'weather' | 'securityAlert';
  payload?: NotificationPayload | Record<string, unknown>;
  timestamp?: number;
}

export type ThemeRendererType = '2d' | 'three';

/**
 * Standardized ClockTheme interface for new 2D Canvas and Three.js themes.
 * Reduces boilerplate by unifying lifecycle, presence modes, dial calibration,
 * and reactive telemetry events.
 */
export interface ClockTheme {
  /** Unique snake_case identifier (e.g., 'vienna_classic', 'my_theme') */
  readonly id: string;
  /** Human-readable display name shown in the theme switcher */
  readonly name: string;
  /** Rendering backend used by this theme */
  readonly renderer: ThemeRendererType;

  /** Initialize canvas/WebGL resources, scene graph, and manifest */
  init(config?: ThemeConfig, canvasContext?: CanvasRenderingContext2D): void | Promise<void>;

  /** Advance animations and render a frame */
  update(timeState: TimeData, delta: number, physicsState?: PhysicsData): void;

  /** Handle viewport/stage dimension updates */
  resize(width?: number, height?: number): void;

  /** Apply one of the 4 presence states ('active' | 'silent' | 'night' | 'sleep') */
  setPresenceMode(mode: ClockMode): void;

  /** Move the dial assembly relative to the 540, 540 baseline on a 1080×1920 canvas */
  setDialCenter(x: number, y: number): void;

  /** Handle reactive telemetry events (e.g., doorbell, securityAlert, mode_change) */
  onEvent(event: ThemeEvent): void;

  /** Dispose all WebGL/canvas resources and event listeners */
  dispose(): void;

  /** Optional theme geometry manifest for HUD calibration compatibility */
  getManifest?(): ThemeManifest;
}

/**
 * Pluggable Theme Interface decoupling the rendering loop, physics clock,
 * and WebSocket event bus from specific visual assets.
 */
export interface Theme {
  /** Unique identifier (e.g., 'vienna_classic', 'pcb_2049') */
  readonly id: string;
  /** Display name */
  readonly name: string;

  /** Lifecycle hook to initialize shaders, textures, and canvas resources */
  mount(canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): void | Promise<void>;

  /** Draw chapter ring, indices, brand markings, and hands (hours, minutes, seconds) */
  renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void;

  /** Draw suspension rod and bob using harmonic swing angle θ(t) */
  renderPendulum(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void;

  /** Draw HUD panels, debug grids, or technical readouts */
  renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void;

  /** Handle reactive visual effects (e.g., MQTT message pulse, priority alerts) */
  onEvent(event: ThemeEvent): void;

  /** Clean up WebGL programs, buffers, and event listeners */
  destroy(): void;

  /** Optional theme geometry manifest for calibration HUD compatibility */
  getManifest?(): ThemeManifest;
}

