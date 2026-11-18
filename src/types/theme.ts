import type { ThemeNotificationStyle } from '../themes/types';

export type HandMode = 'tick' | 'sweep';
export type ClockMode = 'active' | 'silent' | 'night' | 'sleep';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';

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
  notificationStyle?: Partial<ThemeNotificationStyle>;
}

export interface NotificationPayload {
  id?: string;
  title: string;
  message: string;
  timeoutMs?: number;
  priority?: NotificationPriority;
  category?: 'alert' | 'info' | 'doorbell' | 'calendar' | 'weather' | 'securityAlert';
  timestamp?: Date;
}

export type {
  Theme,
  ClockTheme,
  ThemeId,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent,
  ThemeNotificationStyle,
  ThemeNotificationCornerStyle
} from '../themes/types';
