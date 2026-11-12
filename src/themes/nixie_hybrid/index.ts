import { ClockMode, ThemeManifest } from '../../types/theme';
import {
  DisplayOptions,
  formatSynchronizedTime,
  sharedDisplayOptions,
  SynchronizedTimeTick
} from '../../core/timeFormatter';
import {
  PhysicsData,
  TelemetryData,
  Theme,
  ThemeConfig,
  ThemeEvent,
  TimeData
} from '../types';
import { DigitalCellSlotGeometry } from '../hybrid_base/constants';
import {
  CATHODE_ANTI_POISONING_DURATION_MS,
  NIXIE_CELL_SLOTS,
  NIXIE_HYBRID_COLORS,
  NIXIE_HYBRID_GEOMETRY,
  NIXIE_HYBRID_MANIFEST,
  NIXIE_HYBRID_VERSION
} from './constants';

export * from './constants';

interface PlasmaPulse {
  startTimeMs: number;
  durationMs: number;
  urgent: boolean;
}

export class NixieHybridTheme implements Theme {
  public readonly id = 'nixie_hybrid';
  public readonly name = 'Nixie Chronograph';
  public readonly version = NIXIE_HYBRID_VERSION;

  private manifest: ThemeManifest = structuredClone(NIXIE_HYBRID_MANIFEST);
  private readonly cellSlots: DigitalCellSlotGeometry[] = NIXIE_CELL_SLOTS;
  private isMounted = false;
  private chassisDrawnForFrame = false;
  private currentMode: ClockMode = 'active';
  private activePulses: PlasmaPulse[] = [];
  private lastRenderedTick: SynchronizedTimeTick | null = null;
  private lastActiveTubeDigits: string[] = ['0', '0', '0', '0', '0', '0'];

  // Cathode anti-poisoning state
  private antiPoisoningStartMs: number | null = null;
  private lastObservedHour = -1;
  private lastSweepActive = false;

  // IN-13 Bargraph state for tests & telemetry
  private lastBargraphFillRatio = 0;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getCellSlots(): DigitalCellSlotGeometry[] {
    return this.cellSlots.map((s) => ({ ...s }));
  }

  public getLastRenderedTick(): SynchronizedTimeTick | null {
    return this.lastRenderedTick;
  }

  public getActiveTubeDigits(): string[] {
    return [...this.lastActiveTubeDigits];
  }

  public isAntiPoisoningActive(): boolean {
    return this.lastSweepActive;
  }

  public getBargraphFillRatio(): number {
    return this.lastBargraphFillRatio;
  }

  /**
   * Explicitly triggers the 1.8s cathode anti-poisoning slot-machine sweep.
   */
  public triggerAntiPoisoningSweep(startTimeMs: number = performance.now()): void {
    this.antiPoisoningStartMs = startTimeMs;
  }

  public mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): void {
    this.isMounted = true;
    this.chassisDrawnForFrame = false;
    this.activePulses = [];
    this.antiPoisoningStartMs = null;
    this.lastObservedHour = -1;
    this.lastSweepActive = false;

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(NIXIE_HYBRID_MANIFEST);
    }
  }

  /**
   * Evaluates whether the 1.8-second top-of-hour cathode anti-poisoning sweep is active
   * and returns the elapsed milliseconds [0, 1800) if active, or null otherwise.
   */
  public getAntiPoisoningElapsedMs(tick: SynchronizedTimeTick, realTimeMs: number): number | null {
    // 1. Direct top-of-hour window (MM === 0 && SS === 0..1.8s)
    const msIntoHour =
      tick.minutes * 60000 + tick.seconds * 1000 + tick.milliseconds;
    if (tick.minutes === 0 && msIntoHour >= 0 && msIntoHour < CATHODE_ANTI_POISONING_DURATION_MS) {
      return msIntoHour;
    }

    // 2. Hour transition trigger or manual trigger via triggerAntiPoisoningSweep()
    if (this.lastObservedHour !== -1 && this.lastObservedHour !== tick.hours24 && tick.minutes === 0) {
      this.antiPoisoningStartMs = realTimeMs;
    }
    this.lastObservedHour = tick.hours24;

    if (this.antiPoisoningStartMs !== null) {
      const elapsed = realTimeMs - this.antiPoisoningStartMs;
      if (elapsed >= 0 && elapsed < CATHODE_ANTI_POISONING_DURATION_MS) {
        return elapsed;
      }
      this.antiPoisoningStartMs = null;
    }

    return null;
  }

  public renderPendulum(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted) return;

    if (!this.chassisDrawnForFrame) {
      this.drawWalnutAndBrassChassis(ctx);
      this.chassisDrawnForFrame = true;
    }

    // Park and hide pendulum cleanly in sleep mode
    if (this.currentMode === 'sleep' || physicsData.dampingFactor <= 0.001) {
      this.lastBargraphFillRatio = 0;
      return;
    }

    const pivot = this.manifest.pendulum.pivot;
    const length = NIXIE_HYBRID_GEOMETRY.PENDULUM_LENGTH;
    const cylW = NIXIE_HYBRID_GEOMETRY.IN13_CYLINDER_WIDTH;
    const cylH = NIXIE_HYBRID_GEOMETRY.IN13_CYLINDER_HEIGHT;
    const lowerZone = NIXIE_HYBRID_GEOMETRY.LOWER_ZONE_RECT;

    const nightBloomScale = this.currentMode === 'night' ? 0.35 : 1.0;
    const notifDimScale = physicsData.dimmed ? 0.3 : 1.0;
    const dampingScale = Math.max(0.15, Math.min(1.0, physicsData.dampingFactor));
    const plasmaIntensity = nightBloomScale * dampingScale;

    // Pulse boost from active MQTT/WS notifications
    const now = performance.now();
    this.activePulses = this.activePulses.filter((p) => now - p.startTimeMs < p.durationMs);
    let pulseBoost = 0;
    for (const p of this.activePulses) {
      const progress = Math.max(0, Math.min(1, (now - p.startTimeMs) / p.durationMs));
      const wave = Math.sin(progress * Math.PI);
      pulseBoost = Math.max(pulseBoost, wave * (p.urgent ? 1.0 : 0.75));
    }

    // IN-13 neon bargraph column responds smoothly to pendulum velocity + MQTT notification pulse
    const velocityMag = Math.min(1.0, Math.abs(physicsData.angularVelocityNorm));
    const fillRatio = Math.max(0.12, Math.min(1.0, 0.18 + velocityMag * 0.68 + pulseBoost * 0.82));
    this.lastBargraphFillRatio = fillRatio;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(lowerZone.x + 8, lowerZone.y + 8, lowerZone.width - 16, lowerZone.height - 16, 12);
    ctx.clip();

    ctx.globalAlpha = notifDimScale * Math.max(0.5, nightBloomScale);

    // 1. Engraved Brass Swing Scale Arc
    this.drawBrassSwingScale(ctx, pivot.x, pivot.y, length + cylH / 2 + 28, physicsData.maxAngleDeg);

    // 2. Swinging IN-13 Bargraph Pendulum Assembly
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(physicsData.angleRad);

    // Upper Brushed-Brass Trunnion Mount
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-24, -10, 48, 24, 5);
    ctx.fill();
    ctx.stroke();

    // Twin Braided Copper/Brass Suspension Struts
    const cylTopY = length - cylH / 2;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-7, 14);
    ctx.lineTo(-7, cylTopY);
    ctx.moveTo(7, 14);
    ctx.lineTo(7, cylTopY);
    ctx.stroke();

    // Center High-Voltage Cathode Lead Wire
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, cylTopY);
    ctx.stroke();

    // IN-13 Borosilicate Glass Cylinder Bob
    ctx.fillStyle = NIXIE_HYBRID_COLORS.GLASS_TINT;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.GLASS_BORDER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-cylW / 2, cylTopY, cylW, cylH, 14);
    ctx.fill();
    ctx.stroke();

    // Internal IN-13 Anode Scale Marks
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.CATHODE_UNLIT;
    ctx.lineWidth = 1;
    const innerTop = cylTopY + 24;
    const innerBottom = cylTopY + cylH - 24;
    const innerHeight = innerBottom - innerTop;
    for (let s = 0; s <= 10; s++) {
      const sy = innerBottom - (s / 10) * innerHeight;
      const tickW = s % 5 === 0 ? 12 : 7;
      ctx.beginPath();
      ctx.moveTo(-cylW / 2 + 5, sy);
      ctx.lineTo(-cylW / 2 + 5 + tickW, sy);
      ctx.moveTo(cylW / 2 - 5, sy);
      ctx.lineTo(cylW / 2 - 5 - tickW, sy);
      ctx.stroke();
    }

    // Glowing IN-13 Neon Plasma Column (rises from bottom cap proportional to velocity + MQTT pulse)
    const activeColumnH = innerHeight * fillRatio;
    const colTopY = innerBottom - activeColumnH;

    // Soft #FF9A2E outer plasma bloom
    const bloomGrad = ctx.createRadialGradient(
      0,
      innerBottom - activeColumnH * 0.5,
      2,
      0,
      innerBottom - activeColumnH * 0.5,
      cylW * 1.15
    );
    bloomGrad.addColorStop(0, `rgba(255, 85, 0, ${(0.58 * plasmaIntensity).toFixed(3)})`);
    bloomGrad.addColorStop(0.5, `rgba(255, 154, 46, ${(0.28 * plasmaIntensity).toFixed(3)})`);
    bloomGrad.addColorStop(1, 'rgba(255, 154, 46, 0)');
    ctx.fillStyle = bloomGrad;
    ctx.fillRect(-cylW, colTopY - 16, cylW * 2, activeColumnH + 32);

    // #FF5500 Plasma Core Column
    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
    ctx.beginPath();
    ctx.roundRect(-6, colTopY, 12, activeColumnH, 6);
    ctx.fill();

    // Hot filament center core
    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_HOT_FILAMENT;
    ctx.beginPath();
    ctx.roundRect(-2.5, colTopY + 2, 5, Math.max(4, activeColumnH - 4), 2.5);
    ctx.fill();

    // Vertical Glass Specular Highlight
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.GLASS_SPECULAR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-cylW / 2 + 6, cylTopY + 20);
    ctx.lineTo(-cylW / 2 + 6, cylTopY + cylH - 20);
    ctx.stroke();

    // Heavy Machined Brass Top & Bottom End-Caps
    this.drawBrassCylinderCap(ctx, -cylW / 2 - 4, cylTopY - 8, cylW + 8, 22);
    this.drawBrassCylinderCap(ctx, -cylW / 2 - 4, cylTopY + cylH - 14, cylW + 8, 24);

    // Bottom Brass Regulation Spike
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.beginPath();
    ctx.moveTo(-5, cylTopY + cylH + 10);
    ctx.lineTo(5, cylTopY + cylH + 10);
    ctx.lineTo(0, cylTopY + cylH + 30);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  public renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted) return;

    if (!this.chassisDrawnForFrame) {
      this.drawWalnutAndBrassChassis(ctx);
      this.chassisDrawnForFrame = true;
    }

    const activeOptions: DisplayOptions =
      timeData.displayOptions || sharedDisplayOptions.getOptions();
    const effectiveSecondMode = timeData.secondMode || 'tick';
    const syncTick: SynchronizedTimeTick =
      timeData.digitalTick &&
      timeData.digitalTick.timestampMs === timeData.date.getTime()
        ? timeData.digitalTick
        : formatSynchronizedTime(timeData.date, activeOptions, effectiveSecondMode);

    if (this.currentMode === 'sleep') {
      syncTick.angles.second = syncTick.angles.minute;
    }

    this.lastRenderedTick = syncTick;

    // Evaluate Cathode Anti-Poisoning Sweep (1.8s slot-machine cycle at top of hour)
    const sweepElapsedMs =
      this.currentMode === 'sleep'
        ? null
        : this.getAntiPoisoningElapsedMs(syncTick, timeData.realTimeMs);
    this.lastSweepActive = sweepElapsedMs !== null;

    // Smoothly dim plasma bloom in night and sleep modes
    const plasmaIntensity =
      this.currentMode === 'sleep'
        ? 0.12
        : this.currentMode === 'night'
          ? 0.38
          : 1.0;

    // Zone 01: Oiled Walnut & Brass Analog Regulator
    this.renderZone01AnalogRegulator(ctx, syncTick, plasmaIntensity);

    // Zone 02: IN-18 Nixie Tube Cell Matrix
    this.renderZone02NixieMatrix(ctx, syncTick, sweepElapsedMs, plasmaIntensity);
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    this.chassisDrawnForFrame = false;

    if (telemetryData.mode) {
      this.currentMode = telemetryData.mode;
    } else if (telemetryData.isSleeping) {
      this.currentMode = 'sleep';
    }

    const plasmaIntensity =
      this.currentMode === 'sleep'
        ? 0.12
        : this.currentMode === 'night'
          ? 0.38
          : 1.0;

    // Zone 03 Lower-Left Recessed Analog/Digital Telemetry Sub-Dial (`DAEMON TELEMETRY // U_NET LINK`)
    this.renderTelemetrySubDial(ctx, telemetryData, plasmaIntensity);

    if (telemetryData.isSleeping) {
      this.activePulses = [];
      return;
    }

    // Bottom Engraved Brass Specification Plaque
    const opts = this.lastRenderedTick?.options || sharedDisplayOptions.getOptions();
    const wsLabel = telemetryData.wsStatus === 'connected' ? 'U_NET ONLINE' : 'AUTONOMOUS';
    const sweepTag = this.lastSweepActive ? 'CATHODE DEPOISONING' : opts.hourFormat.toUpperCase();

    ctx.save();
    ctx.fillStyle = NIXIE_HYBRID_COLORS.WALNUT_DEEP;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(210, 1836, 660, 40, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `NIXIE CHRONOGRAPH // IN-18 + IN-13  •  ${sweepTag}  •  ${wsLabel}  •  ${telemetryData.fps.toFixed(0)} FPS`,
      540,
      1856
    );
    ctx.restore();
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;

    if (event.type === 'mode_change' && event.payload) {
      const mode = (event.payload as { mode?: ClockMode }).mode;
      if (mode) {
        this.currentMode = mode;
      }
      return;
    }

    if (event.type === 'chime') {
      this.triggerAntiPoisoningSweep(performance.now());
      return;
    }

    if (
      event.type === 'notification' ||
      event.type === 'priority_alert' ||
      event.type === 'mqtt_pulse'
    ) {
      const urgent = event.priority === 'urgent' || event.category === 'alert';
      this.activePulses.push({
        startTimeMs: performance.now(),
        durationMs: 1500,
        urgent
      });
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.chassisDrawnForFrame = false;
    this.activePulses = [];
    this.lastRenderedTick = null;
    this.antiPoisoningStartMs = null;
    this.lastSweepActive = false;
  }

  // ============================================================================
  // Zone 01 — Oiled Walnut & Brass Analog Regulator
  // ============================================================================

  private drawWalnutAndBrassChassis(ctx: CanvasRenderingContext2D): void {
    const { WIDTH, HEIGHT, UPPER_ZONE_RECT, DIGITAL_ZONE_RECT, LOWER_ZONE_RECT } =
      NIXIE_HYBRID_GEOMETRY;

    ctx.save();

    // Deep cabinet background
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CHASSIS_DARK;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const zones = [
      { rect: UPPER_ZONE_RECT, title: 'ZONE 01 // OILED WALNUT & BRASS REGULATOR', isHexBack: false },
      { rect: DIGITAL_ZONE_RECT, title: 'ZONE 02 // IN-18 BOROSILICATE MATRIX', isHexBack: true },
      { rect: LOWER_ZONE_RECT, title: 'ZONE 03 // IN-13 BARGRAPH & TELEMETRY', isHexBack: false }
    ];

    for (const z of zones) {
      // Rich Oiled-Walnut Faceplate Gradient
      const walnutGrad = ctx.createLinearGradient(
        z.rect.x,
        z.rect.y,
        z.rect.x + z.rect.width,
        z.rect.y + z.rect.height
      );
      walnutGrad.addColorStop(0, NIXIE_HYBRID_COLORS.WALNUT_DEEP);
      walnutGrad.addColorStop(0.5, z.isHexBack ? '#110a07' : NIXIE_HYBRID_COLORS.WALNUT_MID);
      walnutGrad.addColorStop(1, NIXIE_HYBRID_COLORS.WALNUT_DEEP);

      ctx.fillStyle = walnutGrad;
      ctx.beginPath();
      ctx.roundRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height, 16);
      ctx.fill();

      // Subtle Horizontal Oiled-Walnut Grain Striations
      ctx.strokeStyle = NIXIE_HYBRID_COLORS.WALNUT_GRAIN;
      ctx.lineWidth = 1;
      for (let gy = z.rect.y + 18; gy < z.rect.y + z.rect.height - 12; gy += 16) {
        ctx.beginPath();
        ctx.moveTo(z.rect.x + 12, gy);
        ctx.lineTo(z.rect.x + z.rect.width - 12, gy);
        ctx.stroke();
      }

      // Brushed Antique-Brass Bezel Frame
      ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height, 16);
      ctx.stroke();

      ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 5, z.rect.y + 5, z.rect.width - 10, z.rect.height - 10, 12);
      ctx.stroke();

      // Corner Brass Rivets
      this.drawBrassRivet(ctx, z.rect.x + 18, z.rect.y + 18);
      this.drawBrassRivet(ctx, z.rect.x + z.rect.width - 18, z.rect.y + 18);
      this.drawBrassRivet(ctx, z.rect.x + 18, z.rect.y + z.rect.height - 18);
      this.drawBrassRivet(ctx, z.rect.x + z.rect.width - 18, z.rect.y + z.rect.height - 18);

      // Engraved Zone Title
      ctx.font = '600 11px "JetBrains Mono", "Consolas", monospace';
      ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(z.title, z.rect.x + 34, z.rect.y + 13);
    }

    // Hexagonal Mesh Cutouts in the Upper Corners of Zone 01
    this.drawCornerHexMeshCutout(
      ctx,
      UPPER_ZONE_RECT.x + 26,
      UPPER_ZONE_RECT.y + 42,
      146,
      110
    );
    this.drawCornerHexMeshCutout(
      ctx,
      UPPER_ZONE_RECT.x + UPPER_ZONE_RECT.width - 172,
      UPPER_ZONE_RECT.y + 42,
      146,
      110
    );

    // Dark Hex-Mesh Backplate across Zone 02 behind the IN-18 tubes
    this.drawHexMeshRegion(
      ctx,
      DIGITAL_ZONE_RECT.x + 16,
      DIGITAL_ZONE_RECT.y + 32,
      DIGITAL_ZONE_RECT.width - 32,
      144,
      10
    );

    ctx.restore();
  }

  private drawCornerHexMeshCutout(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.save();
    ctx.fillStyle = '#0b0705';
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    this.drawHexMeshRegion(ctx, x + 4, y + 4, w - 8, h - 8, 9);
    ctx.restore();
  }

  private drawHexMeshRegion(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    step: number
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.strokeStyle = 'rgba(194, 146, 60, 0.16)';
    ctx.lineWidth = 1;
    const rowH = step * 0.866;
    let row = 0;
    for (let py = y; py <= y + h + rowH; py += rowH) {
      const offsetX = row % 2 === 0 ? 0 : step * 0.75;
      for (let px = x - step; px <= x + w + step; px += step * 1.5) {
        const cx = px + offsetX;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const vx = cx + Math.cos(a) * (step * 0.48);
          const vy = py + Math.sin(a) * (step * 0.48);
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
      }
      row++;
    }
    ctx.restore();
  }

  private renderZone01AnalogRegulator(
    ctx: CanvasRenderingContext2D,
    tick: SynchronizedTimeTick,
    plasmaIntensity: number
  ): void {
    const cx = this.manifest.dial.center.x;
    const cy = this.manifest.dial.center.y;
    const outerR = NIXIE_HYBRID_GEOMETRY.DIAL_OUTER_RADIUS;
    const innerR = NIXIE_HYBRID_GEOMETRY.DIAL_INNER_RADIUS;

    ctx.save();

    // 1. Brushed Antique-Brass Bezel Ring & Oiled-Walnut Dial Face
    const bezelGrad = ctx.createRadialGradient(cx, cy, innerR - 6, cx, cy, outerR + 6);
    bezelGrad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_DARK);
    bezelGrad.addColorStop(0.45, NIXIE_HYBRID_COLORS.BRASS_LIGHT);
    bezelGrad.addColorStop(0.8, NIXIE_HYBRID_COLORS.BRASS_MID);
    bezelGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_SHADOW);

    ctx.fillStyle = bezelGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();

    const dialGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, innerR);
    dialGrad.addColorStop(0, '#120a06');
    dialGrad.addColorStop(0.65, NIXIE_HYBRID_COLORS.WALNUT_DEEP);
    dialGrad.addColorStop(1, '#0b0604');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();

    // 2. Exposed Slowly Meshing Brass Gear Train in Central Aperture (behind skeletonized hands)
    const apertureR = 148;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, apertureR, 0, Math.PI * 2);
    ctx.fillStyle = '#080504';
    ctx.fill();
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.clip();

    const tSec = tick.timestampMs / 1000;
    // Main center Escape Wheel (24 teeth, clockwise)
    this.drawBrassGear(ctx, cx, cy, 78, 24, tSec * 0.14);
    // Upper-left Pinion Wheel (16 teeth, counter-clockwise, meshing)
    this.drawBrassGear(ctx, cx - 76, cy - 64, 52, 16, -tSec * 0.21 + 0.2);
    // Lower-right Regulator Wheel (18 teeth, counter-clockwise, meshing)
    this.drawBrassGear(ctx, cx + 80, cy + 58, 58, 18, -tSec * 0.186);

    ctx.restore();

    // 3. Warm Amber-Backlit Hour Indices (#FF7A1A glow) & Minute Track
    for (let i = 0; i < 60; i++) {
      const angleRad = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const isQuarter = i % 15 === 0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad + Math.PI / 2);

      if (isHour) {
        const batonLen = isQuarter ? 40 : 30;
        const batonW = isQuarter ? 10 : 7;
        const glowY = -innerR + batonLen / 2 + 4;

        // Warm #FF7A1A Amber Backlight Halo behind index
        const halo = ctx.createRadialGradient(0, glowY, 2, 0, glowY, 28);
        halo.addColorStop(0, `rgba(255, 122, 26, ${(0.55 * plasmaIntensity).toFixed(3)})`);
        halo.addColorStop(1, 'rgba(255, 122, 26, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, glowY, 28, 0, Math.PI * 2);
        ctx.fill();

        // Brass-rimmed backlit amber baton
        ctx.fillStyle = NIXIE_HYBRID_COLORS.INDEX_AMBER_CORE;
        ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(-batonW / 2, -innerR + 4, batonW, batonLen, 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
        ctx.fillRect(-1, -innerR + 4, 2, 11);
      }

      ctx.restore();
    }

    // 4. Warm Amber/Brass Hour Numerals
    ctx.font = '700 23px "Georgia", "Times New Roman", serif';
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const numeralR = innerR - 64;
    for (let h = 1; h <= 12; h++) {
      const rad = ((h * 30 - 90) * Math.PI) / 180;
      ctx.fillText(String(h).padStart(2, '0'), cx + Math.cos(rad) * numeralR, cy + Math.sin(rad) * numeralR);
    }

    // 5. Skeletonized Brushed-Brass Hour & Minute Hands
    this.drawSkeletonizedBrassHand(ctx, cx, cy, tick.angles.hour, {
      length: 196,
      tailLength: 38,
      baseWidth: 22,
      tipWidth: 12,
      cutoutStart: 28,
      cutoutEnd: 148,
      railThickness: 4.5
    });

    this.drawSkeletonizedBrassHand(ctx, cx, cy, tick.angles.minute, {
      length: 288,
      tailLength: 48,
      baseWidth: 16,
      tipWidth: 9,
      cutoutStart: 32,
      cutoutEnd: 232,
      railThickness: 3.5
    });

    // 6. Thin Copper-Orange Second Hand
    this.drawCopperSecondHand(ctx, cx, cy, tick.angles.second);

    // 7. Center Antique-Brass Arbor Cap
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBrassGear(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    radius: number,
    teeth: number,
    angleRad: number
  ): void {
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angleRad);

    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_GEAR_BODY;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_GEAR_HIGHLIGHT;
    ctx.lineWidth = 1.5;

    // Gear Teeth Rim
    const outerR = radius + 6;
    const innerR = radius - 4;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.25) / teeth) * Math.PI * 2;
      const a2 = ((i + 0.5) / teeth) * Math.PI * 2;
      const a3 = ((i + 0.75) / teeth) * Math.PI * 2;
      if (i === 0) ctx.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
      ctx.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
      ctx.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
      ctx.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Hollowed Wheel Rim & 5 Radial Spokes
    ctx.fillStyle = '#090503';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.74, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_GEAR_HIGHLIGHT;
    ctx.lineWidth = 4;
    for (let s = 0; s < 5; s++) {
      const sa = (s * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sa) * radius * 0.74, Math.sin(sa) * radius * 0.74);
      ctx.stroke();
    }

    // Center Brass Hub
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawSkeletonizedBrassHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number,
    spec: {
      length: number;
      tailLength: number;
      baseWidth: number;
      tipWidth: number;
      cutoutStart: number;
      cutoutEnd: number;
      railThickness: number;
    }
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    const halfBase = spec.baseWidth / 2;
    const halfTip = spec.tipWidth / 2;

    ctx.beginPath();
    ctx.moveTo(-halfBase * 0.85, spec.tailLength);
    ctx.lineTo(-halfBase, 0);
    ctx.lineTo(-halfTip, -spec.cutoutEnd);
    ctx.lineTo(0, -spec.length);
    ctx.lineTo(halfTip, -spec.cutoutEnd);
    ctx.lineTo(halfBase, 0);
    ctx.lineTo(halfBase * 0.85, spec.tailLength);
    ctx.closePath();

    const innerBase = Math.max(2, halfBase - spec.railThickness);
    const innerTip = Math.max(1.5, halfTip - spec.railThickness);
    ctx.moveTo(-innerBase, -spec.cutoutStart);
    ctx.lineTo(innerBase, -spec.cutoutStart);
    ctx.lineTo(innerTip, -spec.cutoutEnd + 6);
    ctx.lineTo(-innerTip, -spec.cutoutEnd + 6);
    ctx.closePath();

    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.fill('evenodd');

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Warm Amber Luminous Pointer Tip
    ctx.fillStyle = NIXIE_HYBRID_COLORS.INDEX_AMBER_GLOW;
    ctx.beginPath();
    ctx.moveTo(-halfTip * 0.65, -spec.cutoutEnd - 4);
    ctx.lineTo(0, -spec.length + 3);
    ctx.lineTo(halfTip * 0.65, -spec.cutoutEnd - 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawCopperSecondHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.fillStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.lineWidth = 2.2;

    ctx.beginPath();
    ctx.moveTo(0, 66);
    ctx.lineTo(0, 42);
    ctx.moveTo(0, 20);
    ctx.lineTo(0, -314);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 31, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-3.5, -286);
    ctx.lineTo(0, -318);
    ctx.lineTo(3.5, -286);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ============================================================================
  // Zone 02 — IN-18 Nixie Tube Cell Matrix & Cathode Anti-Poisoning Sweep
  // ============================================================================

  private renderZone02NixieMatrix(
    ctx: CanvasRenderingContext2D,
    tick: SynchronizedTimeTick,
    sweepElapsedMs: number | null,
    plasmaIntensity: number
  ): void {
    ctx.save();

    const activeTubeChars: string[] = [];
    let tubeIdx = 0;

    for (let i = 0; i < this.cellSlots.length; i++) {
      const slot = this.cellSlots[i];
      const cell = tick.cells[i];
      const isVisible = cell?.visible ?? true;

      if (slot.isSeparator) {
        this.renderNeonColonBulbAssembly(ctx, slot, isVisible, plasmaIntensity);
      } else {
        // Compute active digit (either normal synchronized digit or rapid 0-9 slot-machine sweep)
        let activeChar = cell?.char || '0';
        if (sweepElapsedMs !== null && isVisible) {
          // Rapid slot-machine cycle (0-9 across all 6 tubes with slight per-tube phase offset)
          const cycleDigit = Math.floor(sweepElapsedMs / 55 + tubeIdx * 1.7) % 10;
          activeChar = String(cycleDigit);
        }
        activeTubeChars.push(activeChar);
        this.renderIn18NixieTube(ctx, slot, activeChar, isVisible, plasmaIntensity);
        tubeIdx++;
      }
    }

    this.lastActiveTubeDigits = activeTubeChars;

    // Secondary Date & Mode Strip below IN-18 sockets
    const sub = NIXIE_HYBRID_GEOMETRY.SUBSTRIP_RECT;
    ctx.fillStyle = '#0c0705';
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sub.x, sub.y, sub.width, sub.height, 6);
    ctx.fill();
    ctx.stroke();

    const subCenterY = sub.y + sub.height / 2;
    ctx.font = '700 19px "JetBrains Mono", "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (tick.options.showDate) {
      ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_BLOOM;
      ctx.fillText(tick.formattedDate, sub.x + 20, subCenterY);
    } else {
      ctx.fillStyle = NIXIE_HYBRID_COLORS.GAUGE_MUTED;
      ctx.font = '600 13px "JetBrains Mono", "Consolas", monospace';
      ctx.fillText('DATE DISPLAY STANDBY', sub.x + 20, subCenterY);
    }

    // Center Status Label (shows anti-poisoning status when active)
    ctx.font = '600 12px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle =
      sweepElapsedMs !== null
        ? NIXIE_HYBRID_COLORS.PLASMA_CORE
        : NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.textAlign = 'center';
    ctx.fillText(
      sweepElapsedMs !== null
        ? 'CATHODE DEPOISONING SWEEP // 0-9'
        : tick.options.showSeconds
          ? 'IN-18 MATRIX // HH:MM:SS'
          : 'IN-18 MATRIX // HH:MM',
      NIXIE_HYBRID_GEOMETRY.WIDTH / 2,
      subCenterY
    );

    // Right: 24H / 12H + AM / PM Neon Indicator Badges
    this.drawNixieBadge(
      ctx,
      sub.x + sub.width - 236,
      sub.y + 8,
      64,
      32,
      tick.options.hourFormat.toUpperCase(),
      true
    );
    this.drawNixieBadge(
      ctx,
      sub.x + sub.width - 160,
      sub.y + 8,
      64,
      32,
      'AM',
      tick.showMeridiem && tick.meridiem === 'AM'
    );
    this.drawNixieBadge(
      ctx,
      sub.x + sub.width - 84,
      sub.y + 8,
      64,
      32,
      'PM',
      tick.showMeridiem && tick.meridiem === 'PM'
    );

    ctx.restore();
  }

  /**
   * Renders an individual borosilicate glass IN-18 Nixie tube seated in a white ceramic PCB socket:
   * - Unlit wire cathode stack silhouettes (0-9)
   * - Warm neon plasma glow (#FF5500 core with soft #FF9A2E radial bloom & inner glass reflections)
   * - Fine dark hexagonal anode wire mesh across the front + vertical glass specular highlights
   */
  private renderIn18NixieTube(
    ctx: CanvasRenderingContext2D,
    slot: DigitalCellSlotGeometry,
    activeChar: string,
    isLit: boolean,
    plasmaIntensity: number
  ): void {
    ctx.save();

    const cx = slot.x + slot.width / 2;
    const cy = slot.y + slot.height / 2 - 4;
    const tubeW = slot.width - 4;
    const tubeH = slot.height - 14;
    const tubeX = slot.x + 2;
    const tubeY = slot.y;

    // 1. White Ceramic PCB Socket at base of tube
    const socketY = tubeY + tubeH - 4;
    const socketH = 18;
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CERAMIC_SOCKET_TOP;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.CERAMIC_SOCKET_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(slot.x + 4, socketY, slot.width - 8, socketH, [3, 3, 7, 7]);
    ctx.fill();
    ctx.stroke();

    // Ceramic socket gold anode/cathode contact pins
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CERAMIC_PIN_GOLD;
    for (let p = -3; p <= 3; p++) {
      ctx.fillRect(cx + p * 10 - 1.5, socketY + 4, 3, 8);
    }

    // 2. Domed Borosilicate Glass Envelope + Exhaust Tip (Pip)
    ctx.fillStyle = NIXIE_HYBRID_COLORS.GLASS_TINT;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.GLASS_BORDER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(tubeX, tubeY + 4, tubeW, tubeH - 4, [26, 26, 6, 6]);
    ctx.fill();
    ctx.stroke();

    // Exhaust glass pip at top center
    ctx.beginPath();
    ctx.arc(cx, tubeY + 4, 5, Math.PI, 0);
    ctx.stroke();

    // Clip interior to glass envelope
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tubeX + 2, tubeY + 6, tubeW - 4, tubeH - 8, [24, 24, 4, 4]);
    ctx.clip();

    // 3. Faint Unlit Wire Cathode Stack Silhouettes (0-9 behind active cathode)
    ctx.font = '600 68px "JetBrains Mono", "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CATHODE_UNLIT;
    const depthDigits = ['0', '8', '3', '6', '9'];
    for (let d = 0; d < depthDigits.length; d++) {
      const ghostChar = depthDigits[d];
      if (ghostChar === activeChar && isLit) continue;
      const offsetX = (d - 2) * 1.1;
      const offsetY = ((d % 3) - 1) * 1.1;
      ctx.fillText(ghostChar, cx + offsetX, cy + offsetY);
    }

    // 4. Warm Neon Plasma Glow (#FF5500 core + #FF9A2E radial bloom + inner glass wall reflections)
    if (isLit) {
      const bloomGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, tubeW * 0.68);
      bloomGrad.addColorStop(0, `rgba(255, 85, 0, ${(0.62 * plasmaIntensity).toFixed(3)})`);
      bloomGrad.addColorStop(0.55, `rgba(255, 154, 46, ${(0.32 * plasmaIntensity).toFixed(3)})`);
      bloomGrad.addColorStop(1, 'rgba(255, 154, 46, 0)');
      ctx.fillStyle = bloomGrad;
      ctx.fillRect(tubeX, tubeY, tubeW, tubeH);

      // Inner Glass Wall Orange Reflections on left and right edges
      ctx.fillStyle = NIXIE_HYBRID_COLORS.GLASS_WALL_REFLECTION;
      ctx.fillRect(tubeX + 2, tubeY + 16, 4, tubeH - 26);
      ctx.fillRect(tubeX + tubeW - 6, tubeY + 16, 4, tubeH - 26);

      // Outer #FF9A2E Neon Halo Stroke
      ctx.font = '700 72px "JetBrains Mono", "Consolas", monospace';
      ctx.strokeStyle = NIXIE_HYBRID_COLORS.PLASMA_BLOOM;
      ctx.lineWidth = 5;
      ctx.strokeText(activeChar, cx, cy);

      // Primary #FF5500 Neon Plasma Core
      ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
      ctx.fillText(activeChar, cx, cy);

      // Incandescent Wire Filament Highlight
      ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_HOT_FILAMENT;
      ctx.font = '700 71px "JetBrains Mono", "Consolas", monospace';
      ctx.fillText(activeChar, cx, cy);
    }

    // Foreground unlit cathode wire silhouette in front of active digit
    ctx.font = '500 68px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = 'rgba(40, 26, 20, 0.18)';
    const frontGhost = activeChar === '4' ? '7' : '4';
    ctx.fillText(frontGhost, cx + 0.8, cy - 0.8);

    // 5. Fine Dark Hexagonal Anode Wire Mesh across the front of the glass envelope
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.ANODE_MESH_LINE;
    ctx.lineWidth = 0.9;
    const meshStep = 11;
    for (let my = tubeY + 8; my < tubeY + tubeH; my += meshStep) {
      ctx.beginPath();
      ctx.moveTo(tubeX, my);
      ctx.lineTo(tubeX + tubeW, my + 4);
      ctx.moveTo(tubeX + tubeW, my);
      ctx.lineTo(tubeX, my + 4);
      ctx.stroke();
    }

    ctx.restore(); // End glass interior clip

    // 6. Vertical Borosilicate Glass Specular Highlights
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.GLASS_SPECULAR;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(tubeX + 9, tubeY + 24);
    ctx.lineTo(tubeX + 9, tubeY + tubeH - 14);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tubeX + tubeW - 8, tubeY + 28);
    ctx.lineTo(tubeX + tubeW - 8, tubeY + tubeH - 18);
    ctx.stroke();

    ctx.restore();
  }

  private renderNeonColonBulbAssembly(
    ctx: CanvasRenderingContext2D,
    slot: DigitalCellSlotGeometry,
    isLit: boolean,
    plasmaIntensity: number
  ): void {
    ctx.save();
    const cx = slot.x + slot.width / 2;
    const cy = slot.y + slot.height / 2 - 4;

    // Miniature ceramic dual-bulb mount
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CERAMIC_SOCKET_TOP;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.CERAMIC_SOCKET_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 13, slot.y + slot.height - 18, 26, 14, 4);
    ctx.fill();
    ctx.stroke();

    // Glass neon indicator envelope
    ctx.fillStyle = NIXIE_HYBRID_COLORS.GLASS_TINT;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.GLASS_BORDER;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 11, slot.y + 16, 22, slot.height - 34, 11);
    ctx.fill();
    ctx.stroke();

    const bulbOffsets = [-18, 18];
    for (const dy of bulbOffsets) {
      const by = cy + dy;
      if (isLit) {
        const glow = ctx.createRadialGradient(cx, by, 1, cx, by, 14);
        glow.addColorStop(0, `rgba(255, 85, 0, ${(0.75 * plasmaIntensity).toFixed(3)})`);
        glow.addColorStop(0.6, `rgba(255, 154, 46, ${(0.35 * plasmaIntensity).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(255, 154, 46, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, by, 14, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
        ctx.beginPath();
        ctx.arc(cx, by, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_HOT_FILAMENT;
        ctx.beginPath();
        ctx.arc(cx, by, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_STANDBY;
        ctx.beginPath();
        ctx.arc(cx, by, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawNixieBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    active: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = active ? 'rgba(255, 85, 0, 0.18)' : 'transparent';
    ctx.strokeStyle = active ? NIXIE_HYBRID_COLORS.PLASMA_CORE : NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 14px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = active ? NIXIE_HYBRID_COLORS.PLASMA_BLOOM : NIXIE_HYBRID_COLORS.GAUGE_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2 + 1);
    ctx.restore();
  }

  // ============================================================================
  // Zone 03 — IN-13 Helpers & Recessed Telemetry Sub-Dial
  // ============================================================================

  private renderTelemetrySubDial(
    ctx: CanvasRenderingContext2D,
    telemetryData: TelemetryData,
    plasmaIntensity: number
  ): void {
    const { x: gx, y: gy } = NIXIE_HYBRID_GEOMETRY.TELEMETRY_GAUGE_CENTER;
    const r = NIXIE_HYBRID_GEOMETRY.TELEMETRY_GAUGE_RADIUS;
    const isConnected = telemetryData.wsStatus === 'connected';

    ctx.save();

    // Recessed Brass-Rimmed Sub-Dial Housing
    ctx.fillStyle = NIXIE_HYBRID_COLORS.GAUGE_FACE;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(gx, gy, r - 6, 0, Math.PI * 2);
    ctx.stroke();

    // Analog Gauge Scale Arc (-120 deg to +120 deg)
    for (let t = -6; t <= 6; t++) {
      const aRad = ((t * 20 - 90) * Math.PI) / 180;
      const inner = r - (t % 3 === 0 ? 18 : 13);
      const outer = r - 8;
      ctx.strokeStyle =
        t >= 2 ? NIXIE_HYBRID_COLORS.PLASMA_CORE : NIXIE_HYBRID_COLORS.BRASS_LIGHT;
      ctx.lineWidth = t % 3 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(gx + Math.cos(aRad) * inner, gy + Math.sin(aRad) * inner);
      ctx.lineTo(gx + Math.cos(aRad) * outer, gy + Math.sin(aRad) * outer);
      ctx.stroke();
    }

    // Sub-Dial Inscription: DAEMON TELEMETRY // U_NET LINK
    ctx.font = '700 9px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = NIXIE_HYBRID_COLORS.GAUGE_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DAEMON TELEMETRY', gx, gy - 26);
    ctx.font = '600 8.5px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = isConnected
      ? NIXIE_HYBRID_COLORS.PLASMA_BLOOM
      : NIXIE_HYBRID_COLORS.GAUGE_MUTED;
    ctx.fillText('U_NET LINK', gx, gy - 13);

    // Digital Readout Window inside Sub-Dial
    ctx.fillStyle = '#070403';
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gx - 52, gy + 20, 104, 24, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 10px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = isConnected
      ? NIXIE_HYBRID_COLORS.PLASMA_CORE
      : NIXIE_HYBRID_COLORS.GAUGE_MUTED;
    const statusText = isConnected ? 'LINK // LOCKED' : 'LINK // STANDBY';
    ctx.fillText(statusText, gx, gy + 32);

    // Neon Pilot Lamp
    const lampX = gx;
    const lampY = gy + 56;
    if (isConnected) {
      const glow = ctx.createRadialGradient(lampX, lampY, 1, lampX, lampY, 12);
      glow.addColorStop(0, `rgba(255, 85, 0, ${(0.8 * plasmaIntensity).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255, 85, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lampX, lampY, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = isConnected
      ? NIXIE_HYBRID_COLORS.PLASMA_CORE
      : NIXIE_HYBRID_COLORS.STATUS_OFFLINE;
    ctx.beginPath();
    ctx.arc(lampX, lampY, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Miniature Analog Pointer Needle (deflects based on FPS & link state)
    const fpsRatio = Math.max(0, Math.min(1, telemetryData.fps / 60));
    const needleDeg = isConnected ? -90 + fpsRatio * 170 : -110;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate((needleDeg * Math.PI) / 180);
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, -(r - 20));
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.beginPath();
    ctx.arc(gx, gy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawBrassCylinderCap(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_DARK);
    grad.addColorStop(0.5, NIXIE_HYBRID_COLORS.BRASS_LIGHT);
    grad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_DARK);

    ctx.fillStyle = grad;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();
  }

  private drawBrassRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.fillStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawBrassSwingScale(
    ctx: CanvasRenderingContext2D,
    pivotX: number,
    pivotY: number,
    radius: number,
    maxAngleDeg: number
  ): void {
    ctx.save();
    const spanDeg = Math.max(8, maxAngleDeg + 2);
    const startRad = ((90 - spanDeg) * Math.PI) / 180;
    const endRad = ((90 + spanDeg) * Math.PI) / 180;

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_MID;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, radius, startRad, endRad);
    ctx.stroke();

    for (let deg = -Math.floor(spanDeg); deg <= Math.floor(spanDeg); deg += 1) {
      const rad = ((90 - deg) * Math.PI) / 180;
      const isZero = deg === 0;
      const isMajor = deg % 2 === 0;
      const tickLen = isZero ? 20 : isMajor ? 13 : 7;

      const x1 = pivotX + Math.cos(rad) * (radius - tickLen / 2);
      const y1 = pivotY + Math.sin(rad) * (radius - tickLen / 2);
      const x2 = pivotX + Math.cos(rad) * (radius + tickLen / 2);
      const y2 = pivotY + Math.sin(rad) * (radius + tickLen / 2);

      ctx.strokeStyle = isZero
        ? NIXIE_HYBRID_COLORS.PLASMA_CORE
        : isMajor
          ? NIXIE_HYBRID_COLORS.BRASS_LIGHT
          : NIXIE_HYBRID_COLORS.BRASS_DARK;
      ctx.lineWidth = isZero ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

