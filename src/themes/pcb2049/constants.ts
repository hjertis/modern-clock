import { Point2D, ThemeManifest } from '../../types/theme';

export type PcbThemeVariant = 'standard' | 'emerald';

export const PCB_COLORS = {
  /** Deep matte FR-4 black substrate */
  SUBSTRATE_BG: '#0c0e12',
  SUBSTRATE_DARK: '#08090c',
  SUBSTRATE_CHAMBER: '#090b0f',
  SOLDER_MASK_LINE: '#141820',

  /** Immersion Gold (ENIG) */
  ENIG_GOLD: '#f4c462',
  ENIG_BRIGHT: '#ffe599',
  ENIG_DIM: 'rgba(244, 196, 98, 0.35)',

  /** Aged Copper */
  AGED_COPPER: '#c8963e',
  COPPER_DARK: '#7d5a1e',
  COPPER_MID: '#a6792c',
  COPPER_DIM: 'rgba(200, 150, 62, 0.22)',

  /** Silkscreen Typography */
  SILKSCREEN_BONE: '#e8e2d0',
  SILKSCREEN_AMBER: '#f4c462',
  SILKSCREEN_MUTED: 'rgba(232, 226, 208, 0.55)',

  /** Oscilloscope & Reactive Accents */
  VECTOR_AMBER: '#ffb838',
  VECTOR_CORE: '#fff3c4',
  CRIMSON_ALERT: '#ff3b30',
  CRIMSON_GLOW: 'rgba(255, 59, 48, 0.65)',
  STATUS_OK: '#30d158',
  STATUS_WARN: '#ffd60a',

  /** Polyimide (Kapton) Ribbon Cable */
  POLYIMIDE_BASE: '#6e3a0c',
  POLYIMIDE_EDGE: '#b8681b',
  POLYIMIDE_DARK: '#3d1f05'
} as const;

export const PCB_EMERALD_COLORS = {
  /** Deep translucent emerald-green FR-4 soldermask */
  MASK_DEEP: '#091e15',
  MASK_RICH: '#0d2b1e',
  MASK_HIGHLIGHT: '#133d2b',
  MASK_DARK_CAVITY: '#05120c',
  MASK_OUTER_CHASSIS: '#040907',
  COPPER_POUR_RELIEF: 'rgba(18, 62, 42, 0.55)',
  COPPER_POUR_EDGE: 'rgba(200, 150, 62, 0.24)',

  /** High-phosphor neon orange oscilloscope-beam hands */
  BEAM_ORANGE_BLOOM: '#ff6a1a',
  BEAM_ORANGE_MID: '#ff8533',
  BEAM_HOT_CORE: '#ffd2a6',
  BEAM_WHITE_HOT: '#fff2e2',

  /** Heavy machined wafer bezel */
  BEZEL_OUTER: '#181e22',
  BEZEL_MID: '#101518',
  BEZEL_INNER: '#090c0e',
  BEZEL_HIGHLIGHT: 'rgba(255, 255, 255, 0.14)',

  /** Lower chamber indicator LEDs */
  CYAN_LED: '#38f8ff',
  RED_LED: '#ff3b30',
  GREEN_LED: '#38ff7a'
} as const;

export const PCB_GEOMETRY = {
  WIDTH: 1080,
  HEIGHT: 1920,
  DIAL_CENTER: { x: 540, y: 520 } as Point2D,
  DIAL_OUTER_RADIUS: 440,
  PENDULUM_PIVOT: { x: 540, y: 990 } as Point2D,
  PENDULUM_LENGTH: 470,
  WAFER_RADIUS: 114
} as const;

export const PCB_2049_MANIFEST: ThemeManifest = {
  name: 'PCB-2049 / Industrial Silicon',
  version: '2.0.49',
  author: 'Cybernetic Chronometry Lab',
  background: '',
  dial: {
    image: '',
    center: { x: PCB_GEOMETRY.DIAL_CENTER.x, y: PCB_GEOMETRY.DIAL_CENTER.y }
  },
  hands: {
    hour: {
      image: '',
      pivot: { x: 20, y: 260 }
    },
    minute: {
      image: '',
      pivot: { x: 16, y: 380 }
    },
    second: {
      image: '',
      pivot: { x: 8, y: 390 },
      mode: 'sweep'
    },
    cap: {
      image: '',
      center: { x: 28, y: 28 }
    }
  },
  pendulum: {
    image: '',
    pivot: { x: PCB_GEOMETRY.PENDULUM_PIVOT.x, y: PCB_GEOMETRY.PENDULUM_PIVOT.y },
    anchor: { x: 60, y: 0 },
    periodSeconds: 2.0,
    maxAngleDeg: 6.0
  },
  notificationZone: {
    x: 140,
    y: 1260,
    width: 800,
    height: 440
  }
};

export const PCB_2049_EMERALD_MANIFEST: ThemeManifest = {
  ...structuredClone(PCB_2049_MANIFEST),
  name: 'Silicon Master // Rev B',
  version: '2.0.49-revB'
};


/**
 * 45-degree routed lateral trace bus paths from the lower daemon interface
 * up along the left and right board flanks into the upper dial chamber.
 * Used both to draw the copper/ENIG buses and to animate high-speed
 * "electron" packets when a WebSocket notification arrives.
 */
export const LEFT_LATERAL_BUS_PATHS: Point2D[][] = [
  [
    { x: 180, y: 1850 },
    { x: 120, y: 1790 },
    { x: 120, y: 1420 },
    { x: 76, y: 1376 },
    { x: 76, y: 1030 },
    { x: 104, y: 1002 },
    { x: 104, y: 760 },
    { x: 64, y: 720 },
    { x: 64, y: 550 },
    { x: 94, y: 520 },
    { x: 108, y: 520 }
  ],
  [
    { x: 196, y: 1850 },
    { x: 132, y: 1786 },
    { x: 132, y: 1415 },
    { x: 88, y: 1371 },
    { x: 88, y: 1035 },
    { x: 116, y: 1007 },
    { x: 116, y: 755 },
    { x: 76, y: 715 },
    { x: 76, y: 555 },
    { x: 112, y: 520 }
  ],
  [
    { x: 212, y: 1850 },
    { x: 144, y: 1782 },
    { x: 144, y: 1410 },
    { x: 100, y: 1366 },
    { x: 100, y: 1040 },
    { x: 128, y: 1012 },
    { x: 128, y: 750 },
    { x: 88, y: 710 },
    { x: 88, y: 560 },
    { x: 128, y: 520 }
  ],
  [
    { x: 228, y: 1850 },
    { x: 156, y: 1778 },
    { x: 156, y: 1405 },
    { x: 112, y: 1361 },
    { x: 112, y: 1045 },
    { x: 140, y: 1017 },
    { x: 140, y: 830 },
    { x: 220, y: 750 },
    { x: 220, y: 710 }
  ]
];

export const RIGHT_LATERAL_BUS_PATHS: Point2D[][] = LEFT_LATERAL_BUS_PATHS.map((path) =>
  path.map((pt) => ({ x: 1080 - pt.x, y: pt.y }))
);

/**
 * Tight, multi-lane 45-degree parallel copper trace buses hugging the lower wafer bezel
 * and terminating into the vertical PCIe-style ENIG gold edge-connector fingers
 * along the bottom edge of the viewport (used by pcb_2049_emerald).
 */
export const EMERALD_LOWER_LEFT_BUS_PATHS: Point2D[][] = Array.from({ length: 8 }, (_, lane) => {
  const s = lane * 8.5;
  const fingerX = 252 + lane * 24;
  return [
    { x: 356, y: 1384 + lane * 10 },
    { x: 248 - s, y: 1384 + lane * 10 },
    { x: 158 - s, y: 1474 + lane * 10 },
    { x: 158 - s, y: 1690 - lane * 4 },
    { x: 222 + s * 0.4, y: 1754 + s * 0.6 },
    { x: fingerX - 18, y: 1754 + s * 0.6 },
    { x: fingerX, y: 1772 + s * 0.6 },
    { x: fingerX, y: 1852 }
  ];
});

export const EMERALD_LOWER_RIGHT_BUS_PATHS: Point2D[][] = EMERALD_LOWER_LEFT_BUS_PATHS.map((path) =>
  path.map((pt) => ({ x: 1080 - pt.x, y: pt.y }))
);


