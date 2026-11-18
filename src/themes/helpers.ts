import * as THREE from 'three';
import { ClockMode, ThemeManifest } from '../types/theme';
import {
  ClockTheme,
  PhysicsData,
  TelemetryData,
  Theme,
  ThemeConfig,
  ThemeEvent,
  TimeData
} from './types';

export const STAGE_WIDTH = 1080;
export const STAGE_HEIGHT = 1920;
export const DIAL_CENTER_BASELINE = { x: 540, y: 540 } as const;
export const BLEED_MARGIN_PX = 500;
export const THREE_PIXELS_PER_UNIT = 100;

/**
 * Standard Z-layer stack for Three.js themes (strictly back-to-front):
 * background < cabinet/frame < dial plate & gears < porthole glass < hour/minute/second hands & hub cap
 */
export const STANDARD_Z_LAYERS = {
  BACKGROUND: -1.6,
  CABINET_FRAME: -0.9,
  DIAL_PLATE_AND_GEARS: -0.3,
  PORTHOLE_GLASS: 0.12,
  HOUR_HAND: 0.24,
  MINUTE_HAND: 0.32,
  SECOND_HAND: 0.40,
  HUB_CAP: 0.46
} as const;

export type StandardZLayerName = keyof typeof STANDARD_Z_LAYERS;

/**
 * Converts a 1080×1920 canvas Dial Center (x, y) into a 2D pixel delta
 * relative to the (540, 540) baseline.
 */
export function dialCenterToPixelOffset(
  dialCenterX: number,
  dialCenterY: number
): { dx: number; dy: number } {
  return {
    dx: dialCenterX - DIAL_CENTER_BASELINE.x,
    dy: dialCenterY - DIAL_CENTER_BASELINE.y
  };
}

/**
 * Converts a 1080×1920 canvas Dial Center (x, y) into Three.js world-space
 * XY offsets (100 px = 1.0 world unit, Y-up) relative to the (540, 540) baseline.
 */
export function dialCenterToWorldOffset(
  dialCenterX: number,
  dialCenterY: number
): { x: number; y: number } {
  return {
    x: (dialCenterX - DIAL_CENTER_BASELINE.x) / THREE_PIXELS_PER_UNIT,
    y: (DIAL_CENTER_BASELINE.y - dialCenterY) / THREE_PIXELS_PER_UNIT
  };
}

/**
 * Applies Dial Center X/Y offsets strictly to `dialGroup` (never the camera
 * or full-screen background) so the outer 1080×1920 substrate stays locked.
 */
export function applyDialCenterToGroup(
  dialGroup: THREE.Object3D | null | undefined,
  dialCenterX: number,
  dialCenterY: number,
  basePosition: { x?: number; y?: number; z?: number } = {}
): { x: number; y: number } {
  const offset = dialCenterToWorldOffset(dialCenterX, dialCenterY);
  if (dialGroup) {
    dialGroup.position.x = (basePosition.x ?? 0) + offset.x;
    dialGroup.position.y = (basePosition.y ?? 0) + offset.y;
    if (basePosition.z !== undefined) {
      dialGroup.position.z = basePosition.z;
    }
  }
  return offset;
}

/**
 * Assigns an object's Z position using the standard Three.js Z-layer stack.
 */
export function setStandardZLayer(
  object: THREE.Object3D,
  layer: StandardZLayerName,
  localOffset = 0
): number {
  const z = STANDARD_Z_LAYERS[layer] + localOffset;
  object.position.z = z;
  return z;
}

/**
 * Verifies that a set of Three.js layers obeys the strict back-to-front Z order:
 * background < cabinet/frame < dial plate & gears < porthole glass < hands & hub cap.
 */
export function isStandardZLayerOrderValid(layers: {
  background?: THREE.Object3D | null;
  cabinetFrame?: THREE.Object3D | null;
  dialPlate?: THREE.Object3D | null;
  portholeGlass?: THREE.Object3D | null;
  hourHand?: THREE.Object3D | null;
  minuteHand?: THREE.Object3D | null;
  secondHand?: THREE.Object3D | null;
  hubCap?: THREE.Object3D | null;
}): boolean {
  const ordered = [
    layers.background,
    layers.cabinetFrame,
    layers.dialPlate,
    layers.portholeGlass,
    layers.hourHand,
    layers.minuteHand,
    layers.secondHand,
    layers.hubCap
  ].filter((obj): obj is THREE.Object3D => Boolean(obj));

  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].position.z <= ordered[i - 1].position.z) {
      return false;
    }
  }
  return true;
}

export interface SleepLightTarget {
  light: THREE.Light | null | undefined;
  activeIntensity: number;
  nightIntensity?: number;
}

export interface SleepIsolationTargets {
  scene?: THREE.Scene | null;
  dialGroup?: THREE.Object3D | null;
  handsGroup?: THREE.Object3D | null;
  /** Non-emissive groups/meshes hidden in Sleep mode (never include dialGroup or handsGroup) */
  hiddenInSleepGroups?: Array<THREE.Object3D | null | undefined>;
  /** Emissive needle/indicator meshes kept visible above black-crush in Sleep mode */
  emissiveIndicatorMeshes?: THREE.Object3D[];
  /** Shared emissive material for needles/indicators */
  emissiveMaterial?: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | null;
  lightsToZeroInSleep?: SleepLightTarget[];
  activeBackgroundHex?: number;
  sleepEmissiveHex?: number;
  nightEmissiveHex?: number;
  activeEmissiveHex?: number;
}

/**
 * Isolates `handsGroup` and `emissiveIndicatorMeshes` so Sleep (Cat-Safe 1 FPS) mode
 * always keeps the glowing needles visible above black-crush without parent `visible = false`
 * inheritance.
 */
export function applySleepModeIsolation(
  mode: ClockMode,
  targets: SleepIsolationTargets
): void {
  const isSleep = mode === 'sleep';
  const isNight = mode === 'night';

  if (targets.scene) {
    targets.scene.background = new THREE.Color(
      isSleep ? 0x000000 : (targets.activeBackgroundHex ?? 0x05070a)
    );
    targets.scene.environmentIntensity = isSleep ? 0 : isNight ? 0.15 : 0.45;
  }

  // Hide non-emissive cabinet, dial plate, glass, and body meshes in Sleep mode
  if (targets.hiddenInSleepGroups) {
    for (const group of targets.hiddenInSleepGroups) {
      if (group) {
        group.visible = !isSleep;
      }
    }
  }

  // Never set visible = false on dialGroup or handsGroup so child emissive meshes stay visible
  if (targets.dialGroup) {
    targets.dialGroup.visible = true;
  }
  if (targets.handsGroup) {
    targets.handsGroup.visible = true;
  }

  if (targets.emissiveIndicatorMeshes) {
    for (const mesh of targets.emissiveIndicatorMeshes) {
      mesh.visible = true;
      if (targets.emissiveMaterial && mesh instanceof THREE.Mesh) {
        mesh.material = targets.emissiveMaterial;
      }
    }
  }

  if (targets.emissiveMaterial) {
    const mat = targets.emissiveMaterial;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthTest = !isSleep;

    if (mat instanceof THREE.MeshBasicMaterial) {
      const colorHex = isSleep
        ? (targets.sleepEmissiveHex ?? 0x993810)
        : isNight
          ? (targets.nightEmissiveHex ?? 0xcc5518)
          : (targets.activeEmissiveHex ?? 0xff8a2b);
      mat.color.setHex(colorHex);
    } else if (mat instanceof THREE.MeshStandardMaterial) {
      const colorHex = isSleep
        ? (targets.sleepEmissiveHex ?? 0x993810)
        : isNight
          ? (targets.nightEmissiveHex ?? 0xcc5518)
          : (targets.activeEmissiveHex ?? 0xff8a2b);
      mat.emissive.setHex(colorHex);
      mat.emissiveIntensity = isSleep ? 0.45 : isNight ? 0.75 : 1.6;
    }
    mat.needsUpdate = true;
  }

  if (targets.lightsToZeroInSleep) {
    for (const entry of targets.lightsToZeroInSleep) {
      if (!entry.light) continue;
      if (isSleep) {
        entry.light.intensity = 0;
      } else if (isNight) {
        entry.light.intensity = entry.nightIntensity ?? entry.activeIntensity * 0.25;
      } else {
        entry.light.intensity = entry.activeIntensity;
      }
    }
  }
}

/**
 * Returns the full 1080×1920 background rectangle expanded by ±bleed margins (default ±500 px).
 */
export function computeBleedRect(
  width = STAGE_WIDTH,
  height = STAGE_HEIGHT,
  bleed = BLEED_MARGIN_PX
): { x: number; y: number; width: number; height: number } {
  return {
    x: -bleed,
    y: -bleed,
    width: width + bleed * 2,
    height: height + bleed * 2
  };
}

/**
 * Fills the 2D canvas background covering 1080×1920 plus ±500 px bleed margins.
 */
export function drawStandard2DBackground(
  ctx: CanvasRenderingContext2D,
  fillStyle: string | CanvasGradient | CanvasPattern,
  width = STAGE_WIDTH,
  height = STAGE_HEIGHT,
  bleed = BLEED_MARGIN_PX
): void {
  const rect = computeBleedRect(width, height, bleed);
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export type ClassifiedThemeEvent = 'doorbell' | 'securityAlert' | 'mode_change' | 'other';

/**
 * Normalizes legacy and modern ThemeEvent shapes into canonical reactive categories.
 */
export function classifyThemeEvent(event: ThemeEvent): ClassifiedThemeEvent {
  if (event.type === 'mode_change') {
    return 'mode_change';
  }
  if (event.type === 'doorbell' || event.category === 'doorbell') {
    return 'doorbell';
  }
  if (
    event.type === 'securityAlert' ||
    event.type === 'priority_alert' ||
    event.category === 'securityAlert' ||
    event.category === 'alert' ||
    event.priority === 'urgent'
  ) {
    return 'securityAlert';
  }
  return 'other';
}

/**
 * Builds a standard 1080×1920 portrait ThemeManifest centered at (540, 540).
 */
export function createDefaultManifest(
  name: string,
  overrides: Partial<ThemeManifest> = {}
): ThemeManifest {
  return {
    name,
    version: '1.0.0',
    author: 'Modern Clock',
    background: '',
    dial: {
      image: '',
      center: { x: DIAL_CENTER_BASELINE.x, y: DIAL_CENTER_BASELINE.y },
      ...overrides.dial
    },
    hands: {
      hour: { image: '', pivot: { x: 0, y: 0 } },
      minute: { image: '', pivot: { x: 0, y: 0 } },
      second: { image: '', pivot: { x: 0, y: 0 }, mode: 'sweep' },
      cap: { image: '', center: { x: DIAL_CENTER_BASELINE.x, y: DIAL_CENTER_BASELINE.y } },
      ...overrides.hands
    },
    pendulum: {
      image: '',
      pivot: { x: 540, y: 990 },
      anchor: { x: 540, y: 990 },
      periodSeconds: 2.0,
      maxAngleDeg: 6.0,
      ...overrides.pendulum
    },
    notificationZone: {
      x: 110,
      y: 1280,
      width: 860,
      height: 460,
      ...overrides.notificationZone
    },
    ...overrides
  };
}

/**
 * Type guard distinguishing the unified `ClockTheme` interface from legacy `Theme`.
 */
export function isClockTheme(candidate: unknown): candidate is ClockTheme {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Partial<ClockTheme>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    (obj.renderer === '2d' || obj.renderer === 'three') &&
    typeof obj.init === 'function' &&
    typeof obj.update === 'function' &&
    typeof obj.dispose === 'function'
  );
}

/**
 * Adapts a `ClockTheme` instance to the legacy `Theme` interface used by `ClockEngine`.
 */
export function adaptClockThemeToTheme(clockTheme: ClockTheme): Theme {
  let lastMode: ClockMode | undefined;
  let lastDialX: number = DIAL_CENTER_BASELINE.x;
  let lastDialY: number = DIAL_CENTER_BASELINE.y;

  return {
    id: clockTheme.id,
    name: clockTheme.name,

    async mount(canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): Promise<void> {
      await clockTheme.init(config, canvasContext);
      const manifest = clockTheme.getManifest?.();
      if (manifest) {
        lastDialX = manifest.dial.center.x;
        lastDialY = manifest.dial.center.y;
      }
      if (config?.width && config?.height) {
        clockTheme.resize(config.width, config.height);
      }
    },

    renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
      const manifest = clockTheme.getManifest?.();
      if (
        manifest &&
        (manifest.dial.center.x !== lastDialX || manifest.dial.center.y !== lastDialY)
      ) {
        lastDialX = manifest.dial.center.x;
        lastDialY = manifest.dial.center.y;
        clockTheme.setDialCenter(lastDialX, lastDialY);
      }
      clockTheme.update(timeData, timeData.deltaTimeSec);
    },

    renderPendulum(_ctx: CanvasRenderingContext2D, _physicsData: PhysicsData): void {
      // ClockTheme handles its own update/render pass inside `update(timeState, delta)`
    },

    renderOverlay(_ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
      const nextMode: ClockMode =
        telemetryData.mode ?? (telemetryData.isSleeping ? 'sleep' : 'active');
      if (nextMode !== lastMode) {
        lastMode = nextMode;
        clockTheme.setPresenceMode(nextMode);
      }
    },

    onEvent(event: ThemeEvent): void {
      if (event.type === 'mode_change' && event.payload && 'mode' in event.payload) {
        const mode = (event.payload as { mode?: ClockMode }).mode;
        if (mode) {
          lastMode = mode;
          clockTheme.setPresenceMode(mode);
        }
      }
      clockTheme.onEvent(event);
    },

    destroy(): void {
      clockTheme.dispose();
    },

    ...(clockTheme.getManifest
      ? { getManifest: (): ThemeManifest => clockTheme.getManifest!() }
      : {})
  };
}
