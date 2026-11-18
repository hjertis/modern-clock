import { ClockMode, Point2D, ThemeManifest } from '../../types/theme';
import {
  ClockTheme,
  ThemeConfig,
  ThemeEvent,
  ThemeNotificationStyle,
  TimeData
} from '../types';
import {
  BLEED_MARGIN_PX,
  classifyThemeEvent,
  createDefaultManifest,
  DIAL_CENTER_BASELINE,
  dialCenterToPixelOffset,
  drawStandard2DBackground,
  STAGE_HEIGHT,
  STAGE_WIDTH
} from '../helpers';

export interface VectorBeamOptions {
  /** Close each polygon path back to its first point */
  closed?: boolean;
  /** Outer P31 phosphor halo color (default '#1aff66') */
  haloColor?: string;
  /** Inner bright electron beam core color (default '#b8ffd0') */
  coreColor?: string;
  /** Core stroke width in pixels (default 2.0) */
  width?: number;
  /** Overall brightness multiplier in [0, 1] (default 1.0) */
  intensity?: number;
  /** Render high-intensity beam-dwell dots at vertices (default true) */
  dwellDots?: boolean;
  /** Disable additive glow and draw flat dim stroke (used in Cat-Safe Sleep mode) */
  disableGlow?: boolean;
  /** Micro-jitter amplitude in pixels (default 0) */
  jitterPx?: number;
  /** Horizontal sync-unlock displacement in pixels (default 0) */
  syncJitterX?: number;
}

/**
 * Renders one or more continuous XY oscilloscope beam paths in a single batched pass
 * using a lightweight two-pass additive glow (`globalCompositeOperation = 'lighter'`):
 * 1. Wide low-alpha P31 phosphor green halo stroke (`#1aff66`) — no expensive `shadowBlur`
 * 2. Crisp bright core stroke (`#b8ffd0`)
 * 3. Single batched `beginPath()` + `fill()` pass for all beam-dwell vertex dots.
 */
export function drawVectorBeamBatch(
  ctx: CanvasRenderingContext2D,
  polylines: Point2D[][],
  options: VectorBeamOptions = {}
): void {
  if (polylines.length === 0) return;

  const {
    closed = false,
    haloColor = '#1aff66',
    coreColor = '#b8ffd0',
    width = 2.0,
    intensity = 1.0,
    dwellDots = true,
    disableGlow = false,
    jitterPx = 0,
    syncJitterX = 0
  } = options;

  const needJitter = jitterPx !== 0 || syncJitterX !== 0;
  const transformedPolylines: Point2D[][] = [];

  for (let pIdx = 0; pIdx < polylines.length; pIdx++) {
    const pts = polylines[pIdx];
    if (pts.length === 0) continue;
    if (!needJitter) {
      transformedPolylines.push(pts);
    } else {
      const jittered: Point2D[] = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const seed = pIdx * 31 + i;
        const hash = Math.sin(seed * 12.9898 + pt.x * 0.07 + pt.y * 0.13) * 43758.5453;
        const frac = hash - Math.floor(hash);
        const jx = (frac - 0.5) * 2 * jitterPx + syncJitterX * Math.sin(pt.y * 0.04 + seed);
        const jy = (((frac * 7.13) % 1) - 0.5) * 2 * jitterPx;
        jittered[i] = { x: pt.x + jx, y: pt.y + jy };
      }
      transformedPolylines.push(jittered);
    }
  }

  if (transformedPolylines.length === 0) return;

  const traceAllPaths = () => {
    ctx.beginPath();
    for (const pts of transformedPolylines) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (closed && pts.length > 2) {
        ctx.closePath();
      }
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (disableGlow) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = intensity;
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = width;
    traceAllPaths();
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.globalCompositeOperation = 'lighter';

  // Pass 1: Lightweight wide low-alpha P31 phosphor halo (zero shadowBlur)
  ctx.globalAlpha = Math.min(1, 0.28 * intensity);
  ctx.strokeStyle = haloColor;
  ctx.lineWidth = width * 3.4;
  traceAllPaths();
  ctx.stroke();

  // Pass 2: Crisp high-energy electron beam core
  ctx.globalAlpha = Math.min(1, 0.92 * intensity);
  ctx.strokeStyle = coreColor;
  ctx.lineWidth = width;
  traceAllPaths();
  ctx.stroke();

  // Pass 3: Single batched beginPath() + fill() for all vertex dwell dots
  if (dwellDots) {
    const dotRadius = Math.max(1.2, width * 0.72);
    ctx.fillStyle = coreColor;
    ctx.globalAlpha = Math.min(1, 0.88 * intensity);
    ctx.beginPath();
    for (const pts of transformedPolylines) {
      for (const pt of pts) {
        ctx.moveTo(pt.x + dotRadius, pt.y);
        ctx.arc(pt.x, pt.y, dotRadius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Renders a single continuous XY oscilloscope beam path using `drawVectorBeamBatch`.
 */
export function drawVectorBeam(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  options: VectorBeamOptions = {}
): void {
  if (points.length === 0) return;
  drawVectorBeamBatch(ctx, [points], options);
}

/**
 * Normalized stroke glyphs in [0..1] × [0..1] coordinate box for vector CRT OSD text & numerals.
 * Includes the complete A–Z alphabet (including 'J'), 0–9 digits, and oscilloscope symbols.
 */
export const VECTOR_GLYPHS: Record<string, Array<Array<[number, number]>>> = {
  '0': [[[0.15, 0], [0.85, 0], [1, 0.2], [1, 0.8], [0.85, 1], [0.15, 1], [0, 0.8], [0, 0.2], [0.15, 0]], [[0.15, 0.8], [0.85, 0.2]]],
  '1': [[[0.25, 0.2], [0.55, 0], [0.55, 1]], [[0.2, 1], [0.85, 1]]],
  '2': [[[0, 0.2], [0.2, 0], [0.8, 0], [1, 0.2], [1, 0.45], [0, 1], [1, 1]]],
  '3': [[[0, 0.15], [0.2, 0], [0.8, 0], [1, 0.2], [0.8, 0.48], [0.35, 0.48]], [[0.8, 0.48], [1, 0.75], [0.8, 1], [0.2, 1], [0, 0.85]]],
  '4': [[[0.75, 1], [0.75, 0], [0, 0.65], [1, 0.65]]],
  '5': [[[1, 0], [0.1, 0], [0.05, 0.45], [0.8, 0.45], [1, 0.65], [0.8, 1], [0.15, 1], [0, 0.85]]],
  '6': [[[0.9, 0.1], [0.65, 0], [0.2, 0], [0, 0.25], [0, 0.8], [0.2, 1], [0.8, 1], [1, 0.75], [0.8, 0.5], [0, 0.5]]],
  '7': [[[0, 0], [1, 0], [0.35, 1]]],
  '8': [[[0.2, 0.48], [0.05, 0.25], [0.2, 0], [0.8, 0], [0.95, 0.25], [0.8, 0.48], [0.2, 0.48], [0, 0.75], [0.2, 1], [0.8, 1], [1, 0.75], [0.8, 0.48]]],
  '9': [[[1, 0.5], [0.2, 0.5], [0, 0.25], [0.2, 0], [0.8, 0], [1, 0.25], [1, 0.8], [0.75, 1], [0.15, 1]]],
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.2, 0.65], [0.8, 0.65]]],
  B: [[[0, 0], [0, 1], [0.75, 1], [1, 0.8], [0.75, 0.5], [0, 0.5]], [[0, 0], [0.7, 0], [0.95, 0.25], [0.75, 0.5]]],
  C: [[[1, 0.15], [0.75, 0], [0.25, 0], [0, 0.2], [0, 0.8], [0.25, 1], [0.75, 1], [1, 0.85]]],
  D: [[[0, 0], [0, 1], [0.7, 1], [1, 0.75], [1, 0.25], [0.7, 0], [0, 0]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.75, 0.5]]],
  F: [[[1, 0], [0, 0], [0, 1]], [[0, 0.5], [0.75, 0.5]]],
  G: [[[1, 0.15], [0.75, 0], [0.2, 0], [0, 0.2], [0, 0.8], [0.2, 1], [0.85, 1], [1, 0.8], [1, 0.55], [0.55, 0.55]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
  I: [[[0.15, 0], [0.85, 0]], [[0.5, 0], [0.5, 1]], [[0.15, 1], [0.85, 1]]],
  J: [[[0.2, 0], [0.9, 0]], [[0.65, 0], [0.65, 0.8], [0.45, 1], [0.15, 1], [0, 0.8]]],
  K: [[[0, 0], [0, 1]], [[1, 0], [0.15, 0.5], [1, 1]]],
  L: [[[0, 0], [0, 1], [1, 1]]],
  M: [[[0, 1], [0, 0], [0.5, 0.55], [1, 0], [1, 1]]],
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
  O: [[[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]],
  P: [[[0, 1], [0, 0], [0.8, 0], [1, 0.25], [0.8, 0.5], [0, 0.5]]],
  Q: [[[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]], [[0.55, 0.65], [1, 1]]],
  R: [[[0, 1], [0, 0], [0.8, 0], [1, 0.25], [0.8, 0.5], [0, 0.5]], [[0.55, 0.5], [1, 1]]],
  S: [[[1, 0.15], [0.75, 0], [0.2, 0], [0, 0.2], [0.2, 0.48], [0.8, 0.52], [1, 0.78], [0.75, 1], [0.2, 1], [0, 0.85]]],
  T: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]],
  U: [[[0, 0], [0, 0.8], [0.2, 1], [0.8, 1], [1, 0.8], [1, 0]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  W: [[[0, 0], [0.25, 1], [0.5, 0.45], [0.75, 1], [1, 0]]],
  X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
  Y: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]],
  Z: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  m: [[[0, 1], [0, 0.35], [0.5, 0.35], [0.5, 1]], [[0.5, 0.35], [1, 0.35], [1, 1]]],
  s: [[[0.9, 0.4], [0.2, 0.4], [0.1, 0.65], [0.9, 0.7], [0.8, 1], [0.1, 1]]],
  '-': [[[0.1, 0.5], [0.9, 0.5]]],
  '/': [[[0.15, 1], [0.85, 0]]],
  '.': [[[0.45, 0.85], [0.55, 0.85], [0.55, 1], [0.45, 1], [0.45, 0.85]]],
  "'": [[[0.5, 0], [0.35, 0.3]]],
  '~': [[[0, 0.55], [0.3, 0.3], [0.7, 0.75], [1, 0.45]]],
  ':': [[[0.45, 0.25], [0.55, 0.25]], [[0.45, 0.75], [0.55, 0.75]]]
};

/**
 * Vector CRT Oscilloscope Theme (`id: 'vector_oscilloscope'`)
 *
 * Pre-renders the static chassis, graticules, dial markings, numerals, rotary controls,
 * and BNC connectors onto an offscreen `staticLayer` canvas (`init()`, `resize()`,
 * `setDialCenter()`, `setPresenceMode()`), blitting it in `update()` with a single
 * `ctx.drawImage()` call and batching all dynamic vector beam paths and dwell dots.
 */
export class VectorOscilloscopeTheme implements ClockTheme {
  public readonly id = 'vector_oscilloscope';
  public readonly name = 'Vector CRT Oscilloscope';
  public readonly renderer = '2d' as const;

  private ctx: CanvasRenderingContext2D | null = null;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticCtx: CanvasRenderingContext2D | null = null;
  private staticLayerBuildCount = 0;

  private width = STAGE_WIDTH;
  private height = STAGE_HEIGHT;
  private dialCenter: { x: number; y: number } = {
    x: DIAL_CENTER_BASELINE.x,
    y: DIAL_CENTER_BASELINE.y
  };
  private presenceMode: ClockMode = 'active';
  private manifest: ThemeManifest = createDefaultManifest('Vector CRT Oscilloscope', {
    notificationZone: { x: 110, y: 1120, width: 860, height: 340 }
  });

  // Continuous animation phase & reactive telemetry state
  private simTimeSec = 0;
  private doorbellPulse = 0;
  private securityAlertPulse = 0;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getNotificationStyle(): Partial<ThemeNotificationStyle> {
    return {
      background: '#030a06',
      borderColor: '#1aff66',
      borderWidth: '1px',
      borderRadius: '0px',
      textColor: '#b8ffd0',
      mutedTextColor: 'rgba(184, 255, 208, 0.68)',
      accentColor: '#1aff66',
      doorbellAccent: '#ffd166',
      alertAccent: '#ff3b30',
      fontFamily: "'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      boxShadow: '0 0 12px rgba(26, 255, 102, 0.25)',
      backdropFilter: 'none',
      cornerStyle: 'sharp',
      headerLabel: '// OSD NOTICE'
    };
  }

  public getPresenceMode(): ClockMode {
    return this.presenceMode;
  }

  public getStaticLayerBuildCount(): number {
    return this.staticLayerBuildCount;
  }

  public getTelemetryPulses(): { doorbellPulse: number; securityAlertPulse: number } {
    return {
      doorbellPulse: this.doorbellPulse,
      securityAlertPulse: this.securityAlertPulse
    };
  }

  public init(config?: ThemeConfig, canvasContext?: CanvasRenderingContext2D): void {
    this.ctx = canvasContext ?? null;
    this.width = config?.width ?? STAGE_WIDTH;
    this.height = config?.height ?? STAGE_HEIGHT;
    this.manifest = config?.manifest
      ? structuredClone(config.manifest)
      : createDefaultManifest(this.name, {
          notificationZone: { x: 110, y: 1120, width: 860, height: 340 }
        });
    this.dialCenter = { ...this.manifest.dial.center };
    this.simTimeSec = 0;
    this.doorbellPulse = 0;
    this.securityAlertPulse = 0;
    this.rebuildStaticLayer();
  }

  public resize(width = STAGE_WIDTH, height = STAGE_HEIGHT): void {
    this.width = width;
    this.height = height;
    this.rebuildStaticLayer();
  }

  public setPresenceMode(mode: ClockMode): void {
    if (this.presenceMode === mode && this.staticLayer) return;
    this.presenceMode = mode;
    this.rebuildStaticLayer();
  }

  public setDialCenter(x: number, y: number): void {
    if (this.dialCenter.x === x && this.dialCenter.y === y && this.staticLayer) return;
    this.dialCenter = { x, y };
    this.manifest.dial.center.x = x;
    this.manifest.dial.center.y = y;
    this.rebuildStaticLayer();
  }

  public onEvent(event: ThemeEvent): void {
    const kind = classifyThemeEvent(event);
    if (kind === 'mode_change' && event.payload && 'mode' in event.payload) {
      const mode = (event.payload as { mode?: ClockMode }).mode;
      if (mode) this.setPresenceMode(mode);
      return;
    }
    if (kind === 'doorbell') {
      this.doorbellPulse = 1.0;
    } else if (kind === 'securityAlert') {
      this.securityAlertPulse = 1.0;
    }
  }

  /**
   * Pre-renders all non-moving chassis, graticule, dial, numeral, OSD label, knob, and BNC
   * vector elements onto `this.staticLayer` (sized to stage + ±500 px bleed margins).
   */
  private rebuildStaticLayer(): void {
    const totalW = this.width + BLEED_MARGIN_PX * 2;
    const totalH = this.height + BLEED_MARGIN_PX * 2;

    if (!this.staticLayer && typeof document !== 'undefined') {
      this.staticLayer = document.createElement('canvas') as HTMLCanvasElement;
    }
    if (this.staticLayer) {
      this.staticLayer.width = totalW;
      this.staticLayer.height = totalH;
      this.staticCtx =
        typeof this.staticLayer.getContext === 'function'
          ? this.staticLayer.getContext('2d')
          : null;
    }

    this.staticLayerBuildCount++;

    const targetCtx = this.staticCtx;
    if (!targetCtx) return;

    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.clearRect(0, 0, totalW, totalH);
    targetCtx.translate(BLEED_MARGIN_PX, BLEED_MARGIN_PX);

    this.renderStaticSceneToContext(targetCtx);
    targetCtx.restore();
  }

  private renderStaticSceneToContext(ctx: CanvasRenderingContext2D): void {
    const isSleep = this.presenceMode === 'sleep';
    const isNight = this.presenceMode === 'night';

    if (isSleep) {
      drawStandard2DBackground(ctx, '#000000', this.width, this.height, BLEED_MARGIN_PX);
      return;
    }

    const intensity = isNight ? 0.45 : 1.0;
    const staticStyle = {
      haloColor: '#1aff66',
      coreColor: '#b8ffd0',
      intensity,
      jitterPx: 0,
      syncJitterX: 0
    };

    // 1. Outer anodized chassis & ±500 px bleed
    this.drawInstrumentChassis(ctx, isNight);

    // 2. Upper circular CRT bezel, 10×10 graticule, dial ring, 60 ticks, numerals, and static OSD labels
    const offset = dialCenterToPixelOffset(this.dialCenter.x, this.dialCenter.y);
    ctx.save();
    ctx.translate(DIAL_CENTER_BASELINE.x + offset.dx, DIAL_CENTER_BASELINE.y + offset.dy);
    this.drawCrtScreenBezelAndGraticule(ctx, isNight);
    this.drawVectorDialFace(ctx, staticStyle);
    this.drawVectorText(ctx, 'MTB 2.5ms', -105, 232, 11, 16, staticStyle, 'center');
    ctx.restore();

    // 3. Lower dual-trace CRT bezel, 8×6 graticule, static labels, rotary knobs, and BNC connectors
    this.drawStaticLowerMonitorAndControls(ctx, staticStyle);
  }

  public update(timeState: TimeData, delta: number): void {
    const dt = Math.max(0, Math.min(1, delta));
    this.simTimeSec += dt;
    this.doorbellPulse = Math.max(0, this.doorbellPulse - dt * 0.65);
    this.securityAlertPulse = Math.max(0, this.securityAlertPulse - dt * 0.45);

    if (!this.ctx) return;
    const ctx = this.ctx;

    const isSleep = this.presenceMode === 'sleep';
    const isNight = this.presenceMode === 'night';
    const isAlert = this.securityAlertPulse > 0.05;

    // 1. Blit pre-rendered staticLayer in a single drawImage call (with fallback for headless mock contexts)
    if (this.staticLayer && this.staticCtx && typeof ctx.drawImage === 'function') {
      ctx.drawImage(this.staticLayer, -BLEED_MARGIN_PX, -BLEED_MARGIN_PX);
    } else {
      this.renderStaticSceneToContext(ctx);
    }

    const offset = dialCenterToPixelOffset(this.dialCenter.x, this.dialCenter.y);
    const dialX = DIAL_CENTER_BASELINE.x + offset.dx;
    const dialY = DIAL_CENTER_BASELINE.y + offset.dy;

    // 2. Sleep (Cat-Safe 1 FPS) Mode: draw ONLY dim #993810 hour & minute hands with zero glow
    if (isSleep) {
      ctx.save();
      ctx.translate(dialX, dialY);
      this.drawVectorHands(ctx, timeState, {
        isSleep: true,
        haloColor: '#993810',
        coreColor: '#993810',
        intensity: 1.0,
        jitterPx: 0,
        syncJitterX: 0
      });
      ctx.restore();
      return;
    }

    // 3. Dynamic phosphor beam parameters
    const intensity = isNight ? 0.45 : 1.0;
    const haloColor = isAlert ? '#ff3b30' : '#1aff66';
    const coreColor = isAlert ? '#ffd2c4' : '#b8ffd0';
    const jitterPx = isNight ? 0.12 : 0.3;
    const syncJitterX = isAlert ? this.securityAlertPulse * 7.5 : 0;
    const dynamicStyle = { haloColor, coreColor, intensity, jitterPx, syncJitterX };

    // 4. Upper CRT dynamic elements (top status OSD, digital HH:MM:SS readout, doorbell flare, hands)
    ctx.save();
    ctx.translate(dialX, dialY);

    const topText = isAlert
      ? 'TRIG UNLOCKED // ALERT'
      : "CH1 50mV~  XY-CLOCK  TRIG'D";
    this.drawVectorText(ctx, topText, 0, -245, 11, 16, dynamicStyle, 'center');

    const hh = String(timeState.hours).padStart(2, '0');
    const mm = String(timeState.minutes).padStart(2, '0');
    const ss = String(timeState.seconds).padStart(2, '0');
    this.drawVectorText(ctx, `${hh}:${mm}:${ss}`, 95, 232, 11, 16, dynamicStyle, 'center');

    if (this.doorbellPulse > 0.01) {
      this.drawDoorbellPerimeterFlare(ctx, intensity);
    }

    this.drawVectorHands(ctx, timeState, {
      isSleep: false,
      ...dynamicStyle
    });
    ctx.restore();

    // 5. Lower Dual-Trace dynamic waveforms (live Lissajous curve + CH1 sweep trace)
    this.drawDynamicLowerWaveforms(ctx, timeState, dynamicStyle);
  }

  private drawInstrumentChassis(ctx: CanvasRenderingContext2D, isNight: boolean): void {
    drawStandard2DBackground(ctx, '#111519', this.width, this.height, BLEED_MARGIN_PX);

    ctx.save();
    ctx.globalAlpha = isNight ? 0.55 : 1.0;

    // Outer recessed instrument panel seam
    ctx.strokeStyle = '#242c35';
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, 1024, 1864);

    // Horizontal brushed metal divider between upper XY scope and lower dual-trace bay
    ctx.strokeStyle = '#0a0d10';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(28, 1070);
    ctx.lineTo(1052, 1070);
    ctx.stroke();

    ctx.strokeStyle = '#26303a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(28, 1074);
    ctx.lineTo(1052, 1074);
    ctx.stroke();

    // Corner instrument rack fasteners
    const screws: Array<[number, number]> = [
      [58, 58],
      [1022, 58],
      [58, 1040],
      [1022, 1040],
      [58, 1860],
      [1022, 1860]
    ];
    ctx.fillStyle = '#1b2229';
    ctx.strokeStyle = '#333e4b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of screws) {
      ctx.moveTo(sx + 12, sy);
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawCrtScreenBezelAndGraticule(
    ctx: CanvasRenderingContext2D,
    isNight: boolean
  ): void {
    const screenRadius = 450;

    ctx.save();
    ctx.fillStyle = '#0a0e12';
    ctx.strokeStyle = '#26303a';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(0, 0, screenRadius + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Deep phosphor CRT screen cavity (#030a06)
    ctx.fillStyle = '#030a06';
    ctx.beginPath();
    ctx.arc(0, 0, screenRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.clip();

    // Subtle glass curvature vignette
    if (typeof ctx.createRadialGradient === 'function') {
      const grad = ctx.createRadialGradient(0, 0, screenRadius * 0.52, 0, 0, screenRadius);
      grad.addColorStop(0, 'rgba(26, 255, 102, 0.03)');
      grad.addColorStop(0.75, 'rgba(3, 10, 6, 0.0)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.68)');
      ctx.fillStyle = grad;
      ctx.fillRect(-screenRadius, -screenRadius, screenRadius * 2, screenRadius * 2);
    }

    // Etched 10×10 division oscilloscope graticule (#0d2b1d)
    const gridExtent = 420;
    const divPx = (gridExtent * 2) / 10;

    ctx.strokeStyle = '#0d2b1d';
    ctx.globalAlpha = isNight ? 0.55 : 0.95;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    for (let i = -5; i <= 5; i++) {
      const pos = i * divPx;
      ctx.moveTo(pos, -gridExtent);
      ctx.lineTo(pos, gridExtent);
      ctx.moveTo(-gridExtent, pos);
      ctx.lineTo(gridExtent, pos);
    }

    // 0.2-division sub-ticks along central X and Y axes
    const subStep = divPx / 5;
    for (let s = -25; s <= 25; s++) {
      const p = s * subStep;
      const tickHalf = s % 5 === 0 ? 7 : 4;
      ctx.moveTo(p, -tickHalf);
      ctx.lineTo(p, tickHalf);
      ctx.moveTo(-tickHalf, p);
      ctx.lineTo(tickHalf, p);
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawVectorDialFace(
    ctx: CanvasRenderingContext2D,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const outerRadius = 408;

    // 1. Segmented vector outer dial ring (60 chords)
    const ringPts: Point2D[] = [];
    const segments = 60;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ringPts.push({ x: Math.sin(a) * outerRadius, y: -Math.cos(a) * outerRadius });
    }
    drawVectorBeam(ctx, ringPts, {
      closed: true,
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.8,
      intensity: style.intensity * 0.85,
      dwellDots: false
    });

    // 2. Batch 48 minute ticks and 12 hour markers into 2 batched beam calls
    const minuteTickPolylines: Point2D[][] = [];
    const hourTickPolylines: Point2D[][] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const isHour = i % 5 === 0;
      const rOuter = outerRadius - 6;
      const rInner = isHour ? outerRadius - 30 : outerRadius - 15;
      const seg: Point2D[] = [
        { x: Math.sin(a) * rInner, y: -Math.cos(a) * rInner },
        { x: Math.sin(a) * rOuter, y: -Math.cos(a) * rOuter }
      ];
      if (isHour) {
        hourTickPolylines.push(seg);
      } else {
        minuteTickPolylines.push(seg);
      }
    }

    drawVectorBeamBatch(ctx, minuteTickPolylines, {
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.3,
      intensity: style.intensity * 0.65,
      dwellDots: false
    });

    drawVectorBeamBatch(ctx, hourTickPolylines, {
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 2.6,
      intensity: style.intensity,
      dwellDots: true
    });

    // 3. Crisp vector stroke cardinal numerals ('12', '3', '6', '9')
    const numeralRadius = 334;
    this.drawVectorText(ctx, '12', 0, -numeralRadius - 14, 24, 34, style, 'center');
    this.drawVectorText(ctx, '3', numeralRadius, -17, 24, 34, style, 'center');
    this.drawVectorText(ctx, '6', 0, numeralRadius - 17, 24, 34, style, 'center');
    this.drawVectorText(ctx, '9', -numeralRadius, -17, 24, 34, style, 'center');
  }

  private drawDoorbellPerimeterFlare(
    ctx: CanvasRenderingContext2D,
    intensity: number
  ): void {
    const flareRadius = 422 + (1 - this.doorbellPulse) * 18;
    const pts: Point2D[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const ripple = Math.sin(a * 8 + this.simTimeSec * 24) * 5 * this.doorbellPulse;
      pts.push({
        x: Math.sin(a) * (flareRadius + ripple),
        y: -Math.cos(a) * (flareRadius + ripple)
      });
    }
    drawVectorBeam(ctx, pts, {
      closed: true,
      haloColor: '#38f8ff',
      coreColor: '#ffffff',
      width: 3.0,
      intensity: this.doorbellPulse * intensity,
      dwellDots: false
    });
  }

  private drawVectorHands(
    ctx: CanvasRenderingContext2D,
    timeState: TimeData,
    style: {
      isSleep: boolean;
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const rotatePts = (pts: Point2D[], angleDeg: number): Point2D[] => {
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return pts.map((p) => ({
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos
      }));
    };

    const hourShape: Point2D[] = [
      { x: 0, y: 38 },
      { x: -13, y: -24 },
      { x: -7, y: -175 },
      { x: 0, y: -235 },
      { x: 7, y: -175 },
      { x: 13, y: -24 }
    ];
    const minuteShape: Point2D[] = [
      { x: 0, y: 52 },
      { x: -9, y: -32 },
      { x: -4, y: -285 },
      { x: 0, y: -348 },
      { x: 4, y: -285 },
      { x: 9, y: -32 }
    ];
    const hubPts: Point2D[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      hubPts.push({ x: Math.cos(a) * 14, y: Math.sin(a) * 14 });
    }

    // Batch closed hand polygons (hour + minute + center hub octagon) into one call
    drawVectorBeamBatch(
      ctx,
      [
        rotatePts(hourShape, timeState.angles.hour),
        rotatePts(minuteShape, timeState.angles.minute),
        hubPts
      ],
      {
        closed: true,
        haloColor: style.haloColor,
        coreColor: style.coreColor,
        width: 2.4,
        intensity: style.intensity,
        dwellDots: !style.isSleep,
        disableGlow: style.isSleep,
        jitterPx: style.jitterPx,
        syncJitterX: style.syncJitterX
      }
    );

    // Sweep/tick second hand (omitted in Cat-Safe Sleep mode)
    if (!style.isSleep) {
      const secondPts: Point2D[] = [
        { x: 0, y: 76 },
        { x: -10, y: 42 },
        { x: 10, y: 42 },
        { x: 0, y: 12 },
        { x: 0, y: -378 }
      ];
      drawVectorBeam(ctx, rotatePts(secondPts, timeState.angles.second), {
        closed: false,
        haloColor: style.haloColor,
        coreColor: style.coreColor,
        width: 1.6,
        intensity: style.intensity,
        dwellDots: true,
        jitterPx: style.jitterPx,
        syncJitterX: style.syncJitterX
      });
    }
  }

  private drawStaticLowerMonitorAndControls(
    ctx: CanvasRenderingContext2D,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const monX = 220;
    const monY = 1140;
    const monW = 640;
    const monH = 480;

    ctx.save();
    ctx.fillStyle = '#030a06';
    ctx.strokeStyle = '#26303a';
    ctx.lineWidth = 6;
    ctx.fillRect(monX, monY, monW, monH);
    ctx.strokeRect(monX, monY, monW, monH);

    // Lower monitor etched graticule (8×6 divisions)
    ctx.strokeStyle = '#0d2b1d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let gx = 1; gx < 8; gx++) {
      const x = monX + (monW / 8) * gx;
      ctx.moveTo(x, monY);
      ctx.lineTo(x, monY + monH);
    }
    for (let gy = 1; gy < 6; gy++) {
      const y = monY + (monH / 6) * gy;
      ctx.moveTo(monX, y);
      ctx.lineTo(monX + monW, y);
    }
    ctx.stroke();

    // Lower monitor static vector OSD labels (with 'J' in XY LISSAJOUS)
    this.drawVectorText(ctx, 'XY LISSAJOUS', monX + 165, monY + 430, 10, 14, style, 'center');
    this.drawVectorText(ctx, 'CH1 SWEEP', monX + 472, monY + 430, 10, 14, style, 'center');

    // Flanking vector rotary control dials (INTENSITY, FOCUS on left; VOLTS/DIV, TIME/DIV on right)
    this.drawRotaryKnob(ctx, 125, 1265, 48, -0.6, 'INTENSITY', style);
    this.drawRotaryKnob(ctx, 125, 1475, 48, 0.4, 'FOCUS', style);
    this.drawRotaryKnob(ctx, 955, 1265, 48, 0.85, 'VOLTS/DIV', style);
    this.drawRotaryKnob(ctx, 955, 1475, 48, -0.35, 'TIME/DIV', style);

    // Bottom row BNC input connectors (Y: 1735)
    this.drawBncConnector(ctx, 310, 1735, 'CH1 X', style);
    this.drawBncConnector(ctx, 540, 1735, 'CH2 Y', style);
    this.drawBncConnector(ctx, 770, 1735, 'EXT TRIG', style);

    ctx.restore();
  }

  private drawDynamicLowerWaveforms(
    ctx: CanvasRenderingContext2D,
    timeState: TimeData,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const monX = 220;
    const monY = 1140;

    // Trace 1 (Left half): Live phase-locked 3:2 Lissajous figure
    const lissCenter = { x: monX + 165, y: monY + 225 };
    const lissRadius = 110;
    const phase = (timeState.angles.second * Math.PI) / 180 + this.simTimeSec * 1.8;
    const lissPts: Point2D[] = [];
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      lissPts.push({
        x: lissCenter.x + Math.sin(3 * t + phase) * lissRadius,
        y: lissCenter.y + Math.sin(2 * t) * lissRadius
      });
    }
    drawVectorBeam(ctx, lissPts, {
      closed: true,
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.8,
      intensity: style.intensity * 0.9,
      dwellDots: false,
      jitterPx: style.jitterPx,
      syncJitterX: style.syncJitterX
    });

    // Trace 2 (Right half): Continuous triggered sweep wave + doorbell ringing burst
    const sweepLeft = monX + 330;
    const sweepWidth = 285;
    const sweepMidY = monY + 225;
    const sweepPts: Point2D[] = [];
    const ringEnv = 1 + this.doorbellPulse * 2.4;
    for (let i = 0; i <= 48; i++) {
      const u = i / 48;
      const env = Math.sin(u * Math.PI);
      const carrier = Math.sin(u * Math.PI * 6 - this.simTimeSec * 9);
      const burst =
        this.doorbellPulse > 0.01
          ? Math.sin(u * Math.PI * 18 - this.simTimeSec * 28) * this.doorbellPulse * 55 * env
          : 0;
      sweepPts.push({
        x: sweepLeft + u * sweepWidth,
        y: sweepMidY + carrier * 42 * ringEnv * env + burst
      });
    }
    drawVectorBeam(ctx, sweepPts, {
      closed: false,
      haloColor: this.doorbellPulse > 0.1 ? '#38f8ff' : style.haloColor,
      coreColor: style.coreColor,
      width: 2.0,
      intensity: style.intensity,
      dwellDots: true,
      jitterPx: style.jitterPx,
      syncJitterX: style.syncJitterX
    });
  }

  private drawRotaryKnob(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    angleRad: number,
    label: string,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const circlePts: Point2D[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      circlePts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    drawVectorBeam(ctx, circlePts, {
      closed: true,
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.5,
      intensity: style.intensity * 0.75,
      dwellDots: false
    });

    const pointerPts: Point2D[] = [
      { x: cx + Math.sin(angleRad) * (radius * 0.25), y: cy - Math.cos(angleRad) * (radius * 0.25) },
      { x: cx + Math.sin(angleRad) * (radius * 0.88), y: cy - Math.cos(angleRad) * (radius * 0.88) }
    ];
    drawVectorBeam(ctx, pointerPts, {
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 2.2,
      intensity: style.intensity,
      dwellDots: true
    });

    this.drawVectorText(ctx, label, cx, cy + radius + 18, 8, 12, style, 'center');
  }

  private drawBncConnector(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    label: string,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    }
  ): void {
    const outerPts: Point2D[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      outerPts.push({ x: cx + Math.cos(a) * 26, y: cy + Math.sin(a) * 26 });
    }
    drawVectorBeam(ctx, outerPts, {
      closed: true,
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.5,
      intensity: style.intensity * 0.7,
      dwellDots: false
    });

    drawVectorBeamBatch(
      ctx,
      [
        [
          { x: cx - 32, y: cy },
          { x: cx - 26, y: cy }
        ],
        [
          { x: cx + 26, y: cy },
          { x: cx + 32, y: cy }
        ]
      ],
      { haloColor: style.haloColor, coreColor: style.coreColor, width: 2.0, intensity: style.intensity }
    );

    this.drawVectorText(ctx, label, cx, cy + 40, 8, 12, style, 'center');
  }

  /**
   * Collects all character strokes for a string and renders them in a SINGLE batched
   * `drawVectorBeamBatch()` call.
   */
  private drawVectorText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    charW: number,
    charH: number,
    style: {
      haloColor: string;
      coreColor: string;
      intensity: number;
      jitterPx: number;
      syncJitterX: number;
    },
    align: 'left' | 'center' = 'left'
  ): void {
    const spacing = charW * 0.42;
    const totalW = text.length * charW + Math.max(0, text.length - 1) * spacing;
    let cursorX = align === 'center' ? x - totalW * 0.5 : x;

    const polylines: Point2D[][] = [];
    for (const ch of text) {
      const strokes = VECTOR_GLYPHS[ch] ?? VECTOR_GLYPHS[ch.toUpperCase()];
      if (strokes) {
        for (const poly of strokes) {
          polylines.push(
            poly.map(([nx, ny]) => ({
              x: cursorX + nx * charW,
              y: y + ny * charH
            }))
          );
        }
      }
      cursorX += charW + spacing;
    }

    drawVectorBeamBatch(ctx, polylines, {
      haloColor: style.haloColor,
      coreColor: style.coreColor,
      width: 1.5,
      intensity: style.intensity * 0.88,
      dwellDots: false,
      jitterPx: style.jitterPx * 0.5,
      syncJitterX: style.syncJitterX
    });
  }

  public dispose(): void {
    this.ctx = null;
    this.staticLayer = null;
    this.staticCtx = null;
  }
}
