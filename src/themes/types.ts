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
  type: 'notification' | 'mqtt_pulse' | 'priority_alert' | 'config_change' | 'chime' | 'mode_change';
  priority?: 'normal' | 'urgent';
  category?: 'alert' | 'info' | 'doorbell' | 'calendar' | 'weather';
  payload?: NotificationPayload | Record<string, unknown>;
  timestamp?: number;
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

