export type HandMode = 'tick' | 'sweep';

export interface Point2D {
  x: number;
  y: number;
}

export interface DialConfig {
  image: string;
  center: Point2D;
}

export interface HandConfig {
  image: string;
  pivot: Point2D;
  mode?: HandMode;
}

export interface CapConfig {
  image: string;
  center: Point2D;
}

export interface HandsConfig {
  hour: HandConfig;
  minute: HandConfig;
  second: HandConfig & { mode: HandMode };
  cap: CapConfig;
}

export interface PendulumConfig {
  image: string;
  pivot: Point2D;
  anchor: Point2D;
  periodSeconds: number;
  maxAngleDeg: number;
}

export interface NotificationZoneConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThemeManifest {
  name: string;
  version: string;
  author: string;
  background: string;
  dial: DialConfig;
  hands: HandsConfig;
  pendulum: PendulumConfig;
  notificationZone: NotificationZoneConfig;
}

export interface NotificationPayload {
  id?: string;
  title: string;
  message: string;
  timeoutMs?: number;
  priority?: 'normal' | 'urgent';
  category?: 'alert' | 'info' | 'doorbell' | 'calendar' | 'weather';
  timestamp?: Date;
}

export type {
  Theme,
  ThemeId,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent
} from '../themes/types';
