import { Point2D, ThemeManifest } from '../../types/theme';
import { DigitalCellRole } from '../../core/timeFormatter';

export const HYBRID_BASE_VERSION = 'v0.2.0-base';

export interface DigitalCellSlotGeometry {
  index: number;
  role: DigitalCellRole;
  x: number;
  y: number;
  width: number;
  height: number;
  isSeparator: boolean;
}

export const HYBRID_BASE_COLORS = {
  CHASSIS_BG: '#0b0e13',
  ZONE_PANEL_BG: '#11161f',
  ZONE_RECESSED_BG: '#090c11',
  GRID_HAIRLINE: 'rgba(148, 163, 184, 0.10)',
  BORDER_STRUCTURAL: '#263142',
  BORDER_HIGHLIGHT: '#3b4c66',

  DIAL_FACE: '#0e131b',
  DIAL_RING: '#1e2736',
  INDEX_PRIMARY: '#f8fafc',
  INDEX_SECONDARY: '#94a3b8',
  INDEX_MINUTE: '#475569',

  HAND_HOUSING: '#e2e8f0',
  HAND_STROKE: '#f8fafc',
  HAND_SECOND: '#f59e0b',
  HAND_CAP_OUTER: '#334155',
  HAND_CAP_INNER: '#f59e0b',

  CELL_HOUSING_BG: '#070a0f',
  CELL_BORDER_ACTIVE: '#2d3b4f',
  CELL_BORDER_STANDBY: '#18202c',
  CELL_GLYPH_ACTIVE: '#f8fafc',
  CELL_GLYPH_ACCENT: '#38bdf8',
  CELL_GLYPH_GHOST: 'rgba(148, 163, 184, 0.08)',

  SUBSTRIP_BG: '#0a0d13',
  TEXT_PRIMARY: '#f1f5f9',
  TEXT_SECONDARY: '#94a3b8',
  TEXT_MUTED: '#475569',
  BADGE_ACTIVE_BG: 'rgba(56, 189, 248, 0.16)',
  BADGE_ACTIVE_BORDER: '#38bdf8',
  BADGE_ACTIVE_TEXT: '#e0f2fe',

  PENDULUM_ROD: '#cbd5e1',
  PENDULUM_BOB_OUTER: '#1e293b',
  PENDULUM_BOB_RING: '#e2e8f0',
  PENDULUM_BOB_CORE: '#38bdf8',
  ALERT_URGENT: '#ef4444'
} as const;

export const HYBRID_BASE_GEOMETRY = {
  WIDTH: 1080,
  HEIGHT: 1920,

  // Zone 1: Upper Analog Dial
  UPPER_ZONE_RECT: { x: 110, y: 64, width: 860, height: 772 },
  DIAL_CENTER: { x: 540, y: 450 } as Point2D,
  DIAL_OUTER_RADIUS: 356,
  DIAL_INNER_RADIUS: 332,

  // Zone 2: Center Digital Module
  DIGITAL_ZONE_RECT: { x: 110, y: 856, width: 860, height: 228 },
  CELL_ROW_Y: 880,
  CELL_HEIGHT: 122,
  SUBSTRIP_RECT: { x: 142, y: 1018, width: 796, height: 48 },

  // Zone 3: Lower Pendulum Assembly
  LOWER_ZONE_RECT: { x: 110, y: 1104, width: 860, height: 706 },
  PENDULUM_PIVOT: { x: 540, y: 1136 } as Point2D,
  PENDULUM_LENGTH: 485,
  PENDULUM_BOB_RADIUS: 62
} as const;

/**
 * Computes the 8 discrete character cell slots (`H`, `H`, `:`, `M`, `M`, `:`, `S`, `S`)
 * inside the Center Digital Module so future variants (e.g. Nixie tubes) can bind
 * individual glass tube shaders per cell slot.
 */
export function buildHybridDigitalCellSlots(): DigitalCellSlotGeometry[] {
  const roles: DigitalCellRole[] = ['h1', 'h2', 'sep1', 'm1', 'm2', 'sep2', 's1', 's2'];
  const digitWidth = 98;
  const sepWidth = 46;
  const gap = 12;

  const totalWidth = digitWidth * 6 + sepWidth * 2 + gap * 7;
  let cursorX = Math.round((HYBRID_BASE_GEOMETRY.WIDTH - totalWidth) / 2);
  const y = HYBRID_BASE_GEOMETRY.CELL_ROW_Y;
  const height = HYBRID_BASE_GEOMETRY.CELL_HEIGHT;

  return roles.map((role, index) => {
    const isSeparator = role === 'sep1' || role === 'sep2';
    const width = isSeparator ? sepWidth : digitWidth;
    const slot: DigitalCellSlotGeometry = {
      index,
      role,
      x: cursorX,
      y,
      width,
      height,
      isSeparator
    };
    cursorX += width + gap;
    return slot;
  });
}

export const HYBRID_DIGITAL_CELL_SLOTS: DigitalCellSlotGeometry[] = buildHybridDigitalCellSlots();

export const HYBRID_BASE_MANIFEST: ThemeManifest = {
  name: 'Hybrid Analog/Digital',
  version: '0.2.0-base',
  author: 'Chronometry Structural Lab',
  background: '',
  dial: {
    image: '',
    center: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y }
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
    pivot: { x: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.x, y: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.y },
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

