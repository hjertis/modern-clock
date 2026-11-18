import { ThemeManifest } from '../../types/theme';
import {
  DigitalCellSlotGeometry,
  HYBRID_BASE_GEOMETRY,
  HYBRID_DIGITAL_CELL_SLOTS
} from '../hybrid_base/constants';

export const MARIANA_ABYSS_VERSION = '1.0.0';

/** Crossfade duration (~100 ms) when switching digits inside each pressure tube */
export const MARIANA_TUBE_CROSSFADE_MS = 100;

/** Sleep (Cat mode) cathode filament emissive intensity (~12–15% of active 1.0 baseline) */
export const MARIANA_SLEEP_FILAMENT_INTENSITY = 0.135;

export const MARIANA_COLORS = {
  // Abyssal Void & Water
  ABYSS_BG: 0x02060a,
  ABYSS_FOG: 0x030c14,
  WATER_DEEP: 0x04131e,
  SLEEP_BLACK: 0x000000,

  // Cast Iron & Oxidized Naval Bronze
  CAST_IRON: 0x1c222a,
  BRONZE_NAVAL: 0x7d603a,
  BRONZE_DARK: 0x42331f,
  STEEL_BRIDGE: 0x8d9aa6,
  CERAMIC_BASE: 0xd6d0c4,
  GOLD_PIN: 0xd4a64a,

  // Glass & Jewels
  GLASS_TINT: 0x9ed8e8,
  RUBY_JEWEL: 0xd11044,

  // Bioluminescent Cyan & Tritium
  BIOLUM_CYAN: 0x00e5ff,
  BIOLUM_CYAN_HEX: '#00E5FF',
  TRITIUM_GREEN: 0x18ffb0,
  SONAR_PHOSPHOR: 0x00f0ff,
  JELLY_GLOW: 0x22d3ee,
  KEY_LIGHT: 0xa4d4f8,
  ALERT_CORAL: 0xff4757
} as const;

export const MARIANA_GEOMETRY = {
  ...HYBRID_BASE_GEOMETRY,
  PORTHOLE_CENTER_WORLD: { x: 0, y: 5.1 },
  PORTHOLE_INNER_R: 3.18,
  PORTHOLE_OUTER_R: 3.74,
  TUBE_ZONE_CENTER_WORLD: { x: 0, y: -0.05 },
  TUBE_RADIUS: 0.42,
  TUBE_HEIGHT: 1.38,
  AQUARIUM_CENTER_WORLD: { x: 0, y: -4.97 },
  AQUARIUM_WIDTH: 8.1,
  AQUARIUM_HEIGHT: 6.55,
  AQUARIUM_DEPTH: 3.6,
  PENDULUM_PIVOT_WORLD: { x: 0, y: -1.76 },
  PENDULUM_LENGTH_WORLD: 4.75,
  SONAR_CENTER_WORLD: { x: -2.94, y: -7.08 },
  SONAR_RADIUS_WORLD: 0.86
} as const;

export const MARIANA_CELL_SLOTS: DigitalCellSlotGeometry[] = HYBRID_DIGITAL_CELL_SLOTS;

export const MARIANA_ABYSS_MANIFEST: ThemeManifest = {
  name: 'Mariana Abyss',
  version: MARIANA_ABYSS_VERSION,
  author: 'Chrono Artisan',
  background: '',
  dial: {
    image: '',
    center: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y }
  },
  hands: {
    hour: {
      image: '',
      pivot: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y }
    },
    minute: {
      image: '',
      pivot: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y }
    },
    second: {
      image: '',
      pivot: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y },
      mode: 'sweep'
    },
    cap: {
      image: '',
      center: { x: HYBRID_BASE_GEOMETRY.DIAL_CENTER.x, y: HYBRID_BASE_GEOMETRY.DIAL_CENTER.y }
    }
  },
  pendulum: {
    image: '',
    pivot: { x: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.x, y: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.y },
    anchor: { x: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.x, y: HYBRID_BASE_GEOMETRY.PENDULUM_PIVOT.y },
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
