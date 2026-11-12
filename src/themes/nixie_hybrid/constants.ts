import { ThemeManifest } from '../../types/theme';
import {
  DigitalCellSlotGeometry,
  HYBRID_BASE_GEOMETRY,
  HYBRID_DIGITAL_CELL_SLOTS
} from '../hybrid_base/constants';

export const NIXIE_HYBRID_VERSION = 'v0.2.0-nixie';

/** Duration of top-of-hour cathode anti-poisoning slot-machine sweep in milliseconds */
export const CATHODE_ANTI_POISONING_DURATION_MS = 1800;

export const NIXIE_HYBRID_COLORS = {
  // Oiled Walnut & Chassis
  CHASSIS_DARK: '#090605',
  WALNUT_DEEP: '#160c07',
  WALNUT_MID: '#26150d',
  WALNUT_WARM: '#361e12',
  WALNUT_GRAIN: 'rgba(12, 6, 3, 0.38)',

  // Brushed Antique Brass
  BRASS_LIGHT: '#e7c275',
  BRASS_MID: '#c2923c',
  BRASS_DARK: '#785419',
  BRASS_SHADOW: '#3d290a',
  BRASS_GEAR_BODY: '#9e7329',
  BRASS_GEAR_HIGHLIGHT: '#dfb663',

  // Amber Backlit Indices & Copper Second Hand
  INDEX_AMBER_GLOW: '#FF7A1A',
  INDEX_AMBER_CORE: '#FFD199',
  COPPER_ORANGE: '#FF6B2B',

  // IN-18 & IN-13 Borosilicate Glass & Ceramic Sockets
  GLASS_TINT: 'rgba(22, 16, 14, 0.72)',
  GLASS_BORDER: 'rgba(215, 195, 175, 0.34)',
  GLASS_SPECULAR: 'rgba(255, 248, 238, 0.24)',
  GLASS_WALL_REFLECTION: 'rgba(255, 95, 15, 0.22)',
  ANODE_MESH_LINE: 'rgba(18, 12, 10, 0.45)',
  CATHODE_UNLIT: 'rgba(120, 98, 86, 0.16)',
  CERAMIC_SOCKET_TOP: '#ede8de',
  CERAMIC_SOCKET_SHADOW: '#b8b0a2',
  CERAMIC_PIN_GOLD: '#d8a648',

  // Neon Plasma Glow (#FF5500 core + #FF9A2E bloom)
  PLASMA_CORE: '#FF5500',
  PLASMA_BLOOM: '#FF9A2E',
  PLASMA_HOT_FILAMENT: '#FFE6C2',
  PLASMA_STANDBY: 'rgba(255, 85, 0, 0.12)',

  // Telemetry Sub-Dial
  GAUGE_FACE: '#100a07',
  GAUGE_TEXT: '#f3d19c',
  GAUGE_MUTED: '#8c6d46',
  STATUS_ONLINE: '#FF7A1A',
  STATUS_OFFLINE: '#6e5236',
  ALERT_URGENT: '#ff3b1f'
} as const;

export const NIXIE_HYBRID_GEOMETRY = {
  ...HYBRID_BASE_GEOMETRY,
  TELEMETRY_GAUGE_CENTER: { x: 246, y: 1668 },
  TELEMETRY_GAUGE_RADIUS: 88,
  IN13_CYLINDER_WIDTH: 44,
  IN13_CYLINDER_HEIGHT: 196
} as const;

export const NIXIE_CELL_SLOTS: DigitalCellSlotGeometry[] = HYBRID_DIGITAL_CELL_SLOTS;

export const NIXIE_HYBRID_MANIFEST: ThemeManifest = {
  name: 'Nixie Chronograph',
  version: '0.2.0-nixie',
  author: 'Chronometry Structural Lab',
  background: '',
  dial: {
    image: '',
    center: { x: NIXIE_HYBRID_GEOMETRY.DIAL_CENTER.x, y: NIXIE_HYBRID_GEOMETRY.DIAL_CENTER.y }
  },
  hands: {
    hour: {
      image: '',
      pivot: { x: 18, y: 215 }
    },
    minute: {
      image: '',
      pivot: { x: 14, y: 305 }
    },
    second: {
      image: '',
      pivot: { x: 8, y: 318 },
      mode: 'tick'
    },
    cap: {
      image: '',
      center: { x: 20, y: 20 }
    }
  },
  pendulum: {
    image: '',
    pivot: { x: NIXIE_HYBRID_GEOMETRY.PENDULUM_PIVOT.x, y: NIXIE_HYBRID_GEOMETRY.PENDULUM_PIVOT.y },
    anchor: { x: 50, y: 0 },
    periodSeconds: 2.0,
    maxAngleDeg: 6.0
  },
  notificationZone: {
    x: 140,
    y: 1240,
    width: 800,
    height: 460
  }
};

