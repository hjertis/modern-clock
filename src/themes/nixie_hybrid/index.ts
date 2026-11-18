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

interface TubeTransitionState {
  currentChar: string;
  previousChar: string | null;
  transitionStartMs: number;
}

const NIXIE_SWITCH_DURATION_MS = 110;

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
  private tubeTransitions: TubeTransitionState[] = Array.from({ length: 6 }, () => ({
    currentChar: '0',
    previousChar: null,
    transitionStartMs: -1000
  }));

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

    // Sleep (Cat mode): total blackout of chassis & pendulum chamber
    if (this.currentMode === 'sleep') {
      if (!this.chassisDrawnForFrame) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, NIXIE_HYBRID_GEOMETRY.WIDTH, NIXIE_HYBRID_GEOMETRY.HEIGHT);
        this.chassisDrawnForFrame = true;
      }
      this.lastBargraphFillRatio = 0;
      return;
    }

    if (!this.chassisDrawnForFrame) {
      this.drawWalnutAndBrassChassis(ctx);
      this.chassisDrawnForFrame = true;
    }

    // Park and hide pendulum cleanly when damped
    if (physicsData.dampingFactor <= 0.001) {
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

    // 0. Walnut-Lined Pendulum Cabinet Chamber (visible back wall + inner side-wall bevels)
    const chX = pivot.x - 165;
    const chY = pivot.y - 18;
    const chW = 330;
    const chH = length + cylH / 2 + 76;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(chX, chY, chW, chH, 16);
    ctx.clip();

    // Visible oiled-walnut cabinet back wall (lit softly from top-left, never pitch black)
    const backWallGrad = ctx.createLinearGradient(chX, chY, chX + chW, chY + chH);
    backWallGrad.addColorStop(0, '#2c170d');
    backWallGrad.addColorStop(0.5, '#1d0e07');
    backWallGrad.addColorStop(1, '#120804');
    ctx.fillStyle = backWallGrad;
    ctx.fillRect(chX, chY, chW, chH);

    // Subtle vertical walnut paneling grain on cabinet back wall
    ctx.strokeStyle = 'rgba(8, 3, 1, 0.38)';
    ctx.lineWidth = 1;
    for (let wx = chX + 18; wx < chX + chW - 14; wx += 14) {
      ctx.beginPath();
      ctx.moveTo(wx, chY + 8);
      ctx.lineTo(wx + Math.sin(wx * 0.1) * 2, chY + chH - 8);
      ctx.stroke();
    }

    // Inner side-wall bevels (left side wall in shadow, right side wall catching top-left light)
    const wallBevel = 14;
    ctx.fillStyle = '#0f0704';
    ctx.beginPath();
    ctx.moveTo(chX, chY);
    ctx.lineTo(chX + wallBevel, chY + wallBevel);
    ctx.lineTo(chX + wallBevel, chY + chH - wallBevel);
    ctx.lineTo(chX, chY + chH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#381e10';
    ctx.beginPath();
    ctx.moveTo(chX + chW, chY);
    ctx.lineTo(chX + chW - wallBevel, chY + wallBevel);
    ctx.lineTo(chX + chW - wallBevel, chY + chH - wallBevel);
    ctx.lineTo(chX + chW, chY + chH);
    ctx.closePath();
    ctx.fill();

    // Top inner overhang shadow & bottom inner shelf catchlight
    const topLipShadow = ctx.createLinearGradient(chX, chY, chX, chY + 34);
    topLipShadow.addColorStop(0, 'rgba(0, 0, 0, 0.80)');
    topLipShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = topLipShadow;
    ctx.fillRect(chX, chY, chW, 34);

    // Dynamic warm orange reflection cast onto the walnut back wall by the swinging IN-13 bob
    const bobWorldX = pivot.x - Math.sin(physicsData.angleRad) * length;
    const bobWorldY = pivot.y + Math.cos(physicsData.angleRad) * length;
    const backWallGlow = ctx.createRadialGradient(
      bobWorldX,
      bobWorldY,
      8,
      bobWorldX,
      bobWorldY,
      115
    );
    backWallGlow.addColorStop(0, `rgba(255, 95, 15, ${(0.34 * plasmaIntensity).toFixed(3)})`);
    backWallGlow.addColorStop(0.5, `rgba(255, 130, 30, ${(0.14 * plasmaIntensity).toFixed(3)})`);
    backWallGlow.addColorStop(1, 'rgba(255, 130, 30, 0)');
    ctx.fillStyle = backWallGlow;
    ctx.fillRect(chX, chY, chW, chH);

    // 1. Engraved Brass Swing Scale Arc
    this.drawBrassSwingScale(ctx, pivot.x, pivot.y, length + cylH / 2 + 28, physicsData.maxAngleDeg);

    const cylTopY = length - cylH / 2;

    // 1b. Dynamic Drop Shadow cast by Pendulum Assembly onto Cabinet Back Wall
    ctx.save();
    ctx.translate(pivot.x + 11, pivot.y + 13);
    ctx.rotate(physicsData.angleRad);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    ctx.fillRect(-9, 14, 4, cylTopY - 14);
    ctx.fillRect(5, 14, 4, cylTopY - 14);
    ctx.beginPath();
    ctx.roundRect(-cylW / 2 - 4, cylTopY - 8, cylW + 8, cylH + 18, 12);
    ctx.fill();
    ctx.restore();

    // Fixed Machined Brass Mounting Bracket anchored at top of cabinet recess
    const bracketGrad = ctx.createLinearGradient(pivot.x - 42, pivot.y - 16, pivot.x + 42, pivot.y + 8);
    bracketGrad.addColorStop(0, '#fff0c4');
    bracketGrad.addColorStop(0.3, '#c89436');
    bracketGrad.addColorStop(0.6, '#4b2f0b');
    bracketGrad.addColorStop(1, '#2b1905');
    ctx.fillStyle = bracketGrad;
    ctx.strokeStyle = '#2a1805';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(pivot.x - 42, pivot.y - 14, 84, 18, 4);
    ctx.fill();
    ctx.stroke();
    this.drawSteelScrew(ctx, pivot.x - 32, pivot.y - 5, 3.8);
    this.drawSteelScrew(ctx, pivot.x + 32, pivot.y - 5, 3.8);

    // 2. Swinging IN-13 Bargraph Pendulum Assembly
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(physicsData.angleRad);

    // Upper Machined-Brass Trunnion Mount (anisotropic high-contrast)
    const trunnionGrad = ctx.createLinearGradient(-24, -10, 24, 14);
    trunnionGrad.addColorStop(0, '#fff0c4');
    trunnionGrad.addColorStop(0.3, '#c89436');
    trunnionGrad.addColorStop(0.6, '#4b2f0b');
    trunnionGrad.addColorStop(1, '#2b1905');
    ctx.fillStyle = trunnionGrad;
    ctx.strokeStyle = '#f6dfa4';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-24, -10, 48, 24, 5);
    ctx.fill();
    ctx.stroke();
    this.drawSteelScrew(ctx, 0, 2, 3.5);

    // Twin Cylindrical Metallic Suspension Rods (high-contrast anisotropic specular)
    for (const rodX of [-7, 7]) {
      const rodGrad = ctx.createLinearGradient(rodX - 2.5, 0, rodX + 2.5, 0);
      rodGrad.addColorStop(0, '#362006');
      rodGrad.addColorStop(0.32, '#fff1c5');
      rodGrad.addColorStop(0.6, '#b8832b');
      rodGrad.addColorStop(1, '#2b1905');
      ctx.fillStyle = rodGrad;
      ctx.fillRect(rodX - 2.2, 14, 4.4, cylTopY - 14);
    }

    // Center High-Voltage Cathode Lead Wire
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, cylTopY);
    ctx.stroke();

    // IN-13 Borosilicate Glass Cylinder Bob (cylindrical shading)
    const tubeGrad = ctx.createLinearGradient(-cylW / 2, 0, cylW / 2, 0);
    tubeGrad.addColorStop(0, 'rgba(38, 26, 22, 0.86)');
    tubeGrad.addColorStop(0.28, NIXIE_HYBRID_COLORS.GLASS_TINT);
    tubeGrad.addColorStop(0.76, 'rgba(14, 10, 8, 0.82)');
    tubeGrad.addColorStop(1, 'rgba(8, 5, 4, 0.92)');
    ctx.fillStyle = tubeGrad;
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

    // Enriched #FF9A2E / #FF5500 outer plasma bloom (clipped inside cabinet recess)
    const bloomGrad = ctx.createRadialGradient(
      0,
      innerBottom - activeColumnH * 0.5,
      2,
      0,
      innerBottom - activeColumnH * 0.5,
      cylW * 1.45
    );
    bloomGrad.addColorStop(0, `rgba(255, 85, 0, ${(0.75 * plasmaIntensity).toFixed(3)})`);
    bloomGrad.addColorStop(0.45, `rgba(255, 154, 46, ${(0.38 * plasmaIntensity).toFixed(3)})`);
    bloomGrad.addColorStop(1, 'rgba(255, 154, 46, 0)');
    ctx.fillStyle = bloomGrad;
    ctx.fillRect(-cylW * 1.2, colTopY - 22, cylW * 2.4, activeColumnH + 44);

    // Inner glass wall neon-orange reflections
    ctx.fillStyle = `rgba(255, 110, 20, ${(0.30 * plasmaIntensity).toFixed(3)})`;
    ctx.fillRect(-cylW / 2 + 2, colTopY, 3.5, activeColumnH);
    ctx.fillRect(cylW / 2 - 5.5, colTopY, 3.5, activeColumnH);

    // #FF5500 Plasma Core Column
    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
    ctx.beginPath();
    ctx.roundRect(-6.5, colTopY, 13, activeColumnH, 6.5);
    ctx.fill();

    // Hot filament center core
    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_HOT_FILAMENT;
    ctx.beginPath();
    ctx.roundRect(-2.5, colTopY + 2, 5, Math.max(4, activeColumnH - 4), 2.5);
    ctx.fill();

    // Dual Vertical Borosilicate Glass Specular Highlights
    ctx.strokeStyle = 'rgba(255, 248, 238, 0.36)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-cylW / 2 + 6, cylTopY + 20);
    ctx.lineTo(-cylW / 2 + 6, cylTopY + cylH - 20);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 248, 238, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cylW / 2 - 6, cylTopY + 24);
    ctx.lineTo(cylW / 2 - 6, cylTopY + cylH - 24);
    ctx.stroke();

    // Heavy Machined Brass Top & Bottom End-Caps + warm orange bounce reflection
    this.drawBrassCylinderCap(ctx, -cylW / 2 - 4, cylTopY - 8, cylW + 8, 22);
    this.drawBrassCylinderCap(ctx, -cylW / 2 - 4, cylTopY + cylH - 14, cylW + 8, 24);
    ctx.strokeStyle = `rgba(255, 115, 25, ${(0.45 * plasmaIntensity).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-cylW / 2, cylTopY + 14);
    ctx.lineTo(cylW / 2, cylTopY + 14);
    ctx.moveTo(-cylW / 2, cylTopY + cylH - 14);
    ctx.lineTo(cylW / 2, cylTopY + cylH - 14);
    ctx.stroke();

    // Bottom Brass Regulation Spike (high-contrast anisotropic)
    const spikeGrad = ctx.createLinearGradient(-5, 0, 5, 0);
    spikeGrad.addColorStop(0, '#fff0c4');
    spikeGrad.addColorStop(0.45, '#c89436');
    spikeGrad.addColorStop(1, '#2b1905');
    ctx.fillStyle = spikeGrad;
    ctx.beginPath();
    ctx.moveTo(-5, cylTopY + cylH + 10);
    ctx.lineTo(5, cylTopY + cylH + 10);
    ctx.lineTo(0, cylTopY + cylH + 30);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // End swinging pendulum transform
    ctx.restore(); // End strict cabinet chamber clip

    // Chamfered brass trim frame around the pendulum cabinet opening
    const chFrameGrad = ctx.createLinearGradient(chX, chY, chX + chW, chY + chH);
    chFrameGrad.addColorStop(0, '#2b1905');
    chFrameGrad.addColorStop(0.5, '#785419');
    chFrameGrad.addColorStop(1, '#e7c275');
    ctx.strokeStyle = chFrameGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(chX, chY, chW, chH, 16);
    ctx.stroke();

    ctx.restore();
  }

  public renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted) return;

    const isSleep = this.currentMode === 'sleep';

    if (!this.chassisDrawnForFrame) {
      if (isSleep) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, NIXIE_HYBRID_GEOMETRY.WIDTH, NIXIE_HYBRID_GEOMETRY.HEIGHT);
      } else {
        this.drawWalnutAndBrassChassis(ctx);
      }
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

    if (isSleep) {
      syncTick.angles.second = syncTick.angles.minute;
    }

    this.lastRenderedTick = syncTick;

    // Sleep (Cat mode): total blackout of Zone 01 & chassis; only isolated ~14% IN-18 cathodes in Zone 02
    if (isSleep) {
      this.lastSweepActive = false;
      this.renderZone02NixieMatrix(ctx, syncTick, null, 0.14, timeData.realTimeMs, true);
      return;
    }

    // Evaluate Cathode Anti-Poisoning Sweep (1.8s slot-machine cycle at top of hour)
    const sweepElapsedMs = this.getAntiPoisoningElapsedMs(syncTick, timeData.realTimeMs);
    this.lastSweepActive = sweepElapsedMs !== null;

    // Smoothly dim plasma bloom in night mode
    const plasmaIntensity = this.currentMode === 'night' ? 0.38 : 1.0;

    // Zone 01: Oiled Walnut & Brass Analog Regulator
    this.renderZone01AnalogRegulator(ctx, syncTick, plasmaIntensity);

    // Zone 02: IN-18 Nixie Tube Cell Matrix
    this.renderZone02NixieMatrix(ctx, syncTick, sweepElapsedMs, plasmaIntensity, timeData.realTimeMs, false);
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    this.chassisDrawnForFrame = false;

    if (telemetryData.mode) {
      this.currentMode = telemetryData.mode;
    } else if (telemetryData.isSleeping) {
      this.currentMode = 'sleep';
    }

    if (this.currentMode === 'sleep' || telemetryData.isSleeping) {
      this.activePulses = [];
      return;
    }

    const plasmaIntensity = this.currentMode === 'night' ? 0.38 : 1.0;

    // Zone 03 Lower-Left Recessed Analog/Digital Telemetry Sub-Dial (`DAEMON TELEMETRY // U_NET LINK`)
    this.renderTelemetrySubDial(ctx, telemetryData, plasmaIntensity);

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

    for (let zIdx = 0; zIdx < zones.length; zIdx++) {
      const z = zones[zIdx];
      // Ambient occlusion & directional drop shadow (top-left light source)
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 5, z.rect.y + 7, z.rect.width, z.rect.height, 16);
      ctx.fill();
      ctx.restore();

      // Rich Oiled-Walnut Faceplate Gradient (lit from top-left)
      const walnutGrad = ctx.createLinearGradient(
        z.rect.x,
        z.rect.y,
        z.rect.x + z.rect.width,
        z.rect.y + z.rect.height
      );
      walnutGrad.addColorStop(0, z.isHexBack ? '#25150d' : '#3a2013');
      walnutGrad.addColorStop(0.45, z.isHexBack ? '#180d08' : '#27150c');
      walnutGrad.addColorStop(1, '#110804');

      ctx.fillStyle = walnutGrad;
      ctx.beginPath();
      ctx.roundRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height, 16);
      ctx.fill();

      // Organic Oiled-Walnut Wood Grain, Knots/Eddies, Pores & Satin Oil Sheen
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 2, z.rect.y + 2, z.rect.width - 4, z.rect.height - 4, 15);
      ctx.clip();

      // Multi-layered organic heartwood & sapwood grain fibers
      let gy = z.rect.y + 8;
      let grainIdx = 0;
      while (gy < z.rect.y + z.rect.height - 6) {
        const step = 8 + ((grainIdx * 7 + zIdx * 3) % 7);
        const amp1 = 5 + ((grainIdx * 5) % 6);
        const amp2 = 3 + ((grainIdx * 3) % 4);
        const phase = grainIdx * 0.63 + zIdx * 1.9;
        const w1 = Math.sin(phase) * amp1;
        const w2 = Math.cos(phase * 1.4) * amp2;

        ctx.strokeStyle =
          grainIdx % 3 === 0
            ? 'rgba(8, 3, 1, 0.44)'
            : grainIdx % 3 === 1
              ? 'rgba(98, 52, 24, 0.14)'
              : 'rgba(14, 6, 3, 0.30)';
        ctx.lineWidth = grainIdx % 4 === 0 ? 1.8 : 0.9;

        ctx.beginPath();
        ctx.moveTo(z.rect.x + 6, gy);
        ctx.bezierCurveTo(
          z.rect.x + z.rect.width * 0.32,
          gy + w1,
          z.rect.x + z.rect.width * 0.68,
          gy + w2,
          z.rect.x + z.rect.width - 6,
          gy + Math.sin(phase + 1.2) * 2
        );
        ctx.stroke();

        // Subtle dark wood pores along fiber lines
        if (grainIdx % 2 === 0) {
          ctx.strokeStyle = 'rgba(6, 2, 1, 0.45)';
          ctx.lineWidth = 0.8;
          for (let px = z.rect.x + 28 + ((grainIdx * 37) % 45); px < z.rect.x + z.rect.width - 30; px += 64) {
            const pLen = 5 + ((px + grainIdx) % 8);
            ctx.beginPath();
            ctx.moveTo(px, gy + Math.sin(px * 0.02 + phase) * 2.5);
            ctx.lineTo(px + pLen, gy + Math.sin(px * 0.02 + phase) * 2.5);
            ctx.stroke();
          }
        }

        gy += step;
        grainIdx++;
      }

      // Subtle walnut knot / figure eddy
      const knotX = z.rect.x + (zIdx === 1 ? z.rect.width * 0.78 : z.rect.width * 0.16);
      const knotY = z.rect.y + z.rect.height * (zIdx === 0 ? 0.82 : 0.48);
      for (let kr = 1; kr <= 4; kr++) {
        ctx.strokeStyle = `rgba(10, 4, 2, ${(0.34 - kr * 0.06).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(knotX, knotY, kr * 11, kr * 4.5, -0.08, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Soft top-left satin oil sheen across the wood surface
      const sheenGrad = ctx.createRadialGradient(
        z.rect.x + 70,
        z.rect.y + 48,
        12,
        z.rect.x + 70,
        z.rect.y + 48,
        z.rect.width * 0.82
      );
      sheenGrad.addColorStop(0, 'rgba(255, 214, 165, 0.095)');
      sheenGrad.addColorStop(0.45, 'rgba(255, 198, 138, 0.035)');
      sheenGrad.addColorStop(1, 'rgba(255, 198, 138, 0)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height);

      // Inner bevel highlight (top-left) and inner ambient occlusion shadow (bottom-right)
      ctx.strokeStyle = 'rgba(255, 232, 185, 0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 6, z.rect.y + 6, z.rect.width - 12, z.rect.height - 12, 11);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.60)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 3, z.rect.y + 3, z.rect.width - 6, z.rect.height - 6, 13);
      ctx.stroke();
      ctx.restore();

      // High-Contrast Anisotropic Machined-Brass Frame (dark-bronze shadows + pale-champagne streaks)
      const frameGrad = ctx.createLinearGradient(
        z.rect.x,
        z.rect.y,
        z.rect.x + z.rect.width,
        z.rect.y + z.rect.height
      );
      frameGrad.addColorStop(0, '#fff0c4');
      frameGrad.addColorStop(0.22, '#c89638');
      frameGrad.addColorStop(0.5, '#4b2f0b');
      frameGrad.addColorStop(0.75, '#a87624');
      frameGrad.addColorStop(1, '#2b1905');

      ctx.strokeStyle = frameGrad;
      ctx.lineWidth = 3.8;
      ctx.beginPath();
      ctx.roundRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height, 16);
      ctx.stroke();

      ctx.strokeStyle = '#3c2408';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(z.rect.x + 5, z.rect.y + 5, z.rect.width - 10, z.rect.height - 10, 12);
      ctx.stroke();

      // Corner Brass Screws with AO & Slotted Heads
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

    // Recessed Tube Bay & Dark Hex-Mesh Backplate across Zone 02 behind the IN-18 tubes
    const bayX = DIGITAL_ZONE_RECT.x + 16;
    const bayY = DIGITAL_ZONE_RECT.y + 32;
    const bayW = DIGITAL_ZONE_RECT.width - 32;
    const bayH = 144;

    ctx.save();
    ctx.fillStyle = '#070403';
    ctx.beginPath();
    ctx.roundRect(bayX, bayY, bayW, bayH, 10);
    ctx.fill();

    // Inner top-left bay shadow for physical recess depth
    const bayShadow = ctx.createLinearGradient(bayX, bayY, bayX, bayY + 26);
    bayShadow.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
    bayShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bayShadow;
    ctx.fillRect(bayX, bayY, bayW, 26);

    this.drawHexMeshRegion(ctx, bayX + 2, bayY + 2, bayW - 4, bayH - 4, 10);

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_DARK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bayX, bayY, bayW, bayH, 10);
    ctx.stroke();
    ctx.restore();

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
    ctx.fillStyle = '#080504';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();

    this.drawHexMeshRegion(ctx, x + 4, y + 4, w - 8, h - 8, 9);

    // Inner recess shadow from top-left walnut lip
    const recessGrad = ctx.createLinearGradient(x, y, x + 18, y + 18);
    recessGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    recessGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = recessGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();

    const trimGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    trimGrad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_SHADOW);
    trimGrad.addColorStop(0.5, NIXIE_HYBRID_COLORS.BRASS_DARK);
    trimGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_MID);
    ctx.strokeStyle = trimGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.stroke();
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

    // 1. Multi-Step Chamfered Brass Bezel & Matte Textured Dial Face
    // Outer bezel drop shadow onto the walnut faceplate (top-left light source)
    const bezelShadowGrad = ctx.createRadialGradient(
      cx + 6,
      cy + 9,
      outerR * 0.88,
      cx + 6,
      cy + 9,
      outerR + 22
    );
    bezelShadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    bezelShadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bezelShadowGrad;
    ctx.beginPath();
    ctx.arc(cx + 6, cy + 9, outerR + 22, 0, Math.PI * 2);
    ctx.fill();

    // Outer chamfer step (high-contrast anisotropic brass: dark bronze -> pale champagne)
    const outerChamferGrad = ctx.createLinearGradient(
      cx - outerR,
      cy - outerR,
      cx + outerR,
      cy + outerR
    );
    outerChamferGrad.addColorStop(0, '#fff2ca');
    outerChamferGrad.addColorStop(0.24, '#d39f41');
    outerChamferGrad.addColorStop(0.52, '#4d300a');
    outerChamferGrad.addColorStop(0.76, '#9c6c20');
    outerChamferGrad.addColorStop(1, '#261604');
    ctx.fillStyle = outerChamferGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();

    // Middle raised crown ring with concentric brushed-metal grain
    const crownR = outerR - 5;
    const crownGrad = ctx.createLinearGradient(
      cx - crownR,
      cy - crownR,
      cx + crownR,
      cy + crownR
    );
    crownGrad.addColorStop(0, '#fff5d6');
    crownGrad.addColorStop(0.18, '#e3b85e');
    crownGrad.addColorStop(0.45, '#59380d');
    crownGrad.addColorStop(0.68, '#b8832b');
    crownGrad.addColorStop(0.88, '#3b2407');
    crownGrad.addColorStop(1, '#6f4a13');
    ctx.fillStyle = crownGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, crownR, 0, Math.PI * 2);
    ctx.fill();

    // Subtle concentric brushed-metal grain on the brass crown
    ctx.lineWidth = 0.8;
    for (let br = innerR + 11; br < crownR - 1; br += 2.5) {
      ctx.strokeStyle = br % 5 === 0 ? 'rgba(255, 244, 210, 0.12)' : 'rgba(28, 15, 3, 0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crisp top-left specular arc on the raised brass crown
    ctx.strokeStyle = 'rgba(255, 249, 232, 0.78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, crownR - 1, Math.PI * 0.92, Math.PI * 1.62);
    ctx.stroke();

    // Inner sloped rehaut bevel (shadowed top-left, catching champagne light bottom-right)
    const rehautR = innerR + 9;
    const rehautGrad = ctx.createLinearGradient(
      cx - rehautR,
      cy - rehautR,
      cx + rehautR,
      cy + rehautR
    );
    rehautGrad.addColorStop(0, '#2a1805');
    rehautGrad.addColorStop(0.42, '#5a390e');
    rehautGrad.addColorStop(0.75, '#c79338');
    rehautGrad.addColorStop(1, '#fff0c4');
    ctx.fillStyle = rehautGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, rehautR, 0, Math.PI * 2);
    ctx.fill();

    // Dark Charcoal-Anodized Micro-Grain Dial Face (instead of pure black)
    const dialGrad = ctx.createRadialGradient(cx - 55, cy - 55, 25, cx, cy, innerR);
    dialGrad.addColorStop(0, '#272422');
    dialGrad.addColorStop(0.55, '#1b1918');
    dialGrad.addColorStop(1, '#11100f');
    ctx.fillStyle = dialGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();

    // Subtle concentric anodized micro-grain texture
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.clip();

    ctx.lineWidth = 1;
    for (let tr = 154; tr < innerR; tr += 3.5) {
      ctx.strokeStyle = tr % 7 === 0 ? 'rgba(255, 245, 230, 0.032)' : 'rgba(0, 0, 0, 0.24)';
      ctx.beginPath();
      ctx.arc(cx, cy, tr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Deep inner drop shadow cast by the chamfered bezel onto the dial face (top-left overhang)
    const innerDropShadow = ctx.createRadialGradient(
      cx + 7,
      cy + 10,
      innerR - 32,
      cx + 7,
      cy + 10,
      innerR + 4
    );
    innerDropShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
    innerDropShadow.addColorStop(0.65, 'rgba(0, 0, 0, 0.38)');
    innerDropShadow.addColorStop(1, 'rgba(0, 0, 0, 0.80)');
    ctx.fillStyle = innerDropShadow;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Recessed Movement Well: Brushed-Gunmetal Baseplate + Machined Brass Bridges + Meshing Gears
    const apertureR = 148;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, apertureR, 0, Math.PI * 2);
    ctx.clip();

    // Brushed-gunmetal baseplate
    const gunmetalGrad = ctx.createLinearGradient(
      cx - apertureR,
      cy - apertureR,
      cx + apertureR,
      cy + apertureR
    );
    gunmetalGrad.addColorStop(0, '#2a2e35');
    gunmetalGrad.addColorStop(0.5, '#1b1e23');
    gunmetalGrad.addColorStop(1, '#101215');
    ctx.fillStyle = gunmetalGrad;
    ctx.fillRect(cx - apertureR, cy - apertureR, apertureR * 2, apertureR * 2);

    // Recessed circular milling marks (engine-turned perlage) on gunmetal baseplate
    ctx.lineWidth = 1;
    for (let ringY = -120; ringY <= 120; ringY += 38) {
      for (let ringX = -120; ringX <= 120; ringX += 38) {
        if (ringX * ringX + ringY * ringY > (apertureR + 12) * (apertureR + 12)) continue;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
        ctx.beginPath();
        ctx.arc(cx + ringX, cy + ringY, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
        ctx.beginPath();
        ctx.arc(cx + ringX + 1, cy + ringY + 1, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Shared module (pitchRadius / teeth = 3.25 px) ensures identical circular pitch across all 3 gears.
    // Cycle wraps every 360s (6 min = LCM of 1, 3/2, 4/3 turns * 60s) with zero tooth or spoke jump.
    const gearModulePx = 3.25;
    const centerTeeth = 24;
    const centerRadius = centerTeeth * gearModulePx; // 78
    const cycleSec = this.currentMode === 'sleep' ? 0 : (tick.timestampMs % 360000) / 1000;
    const centerAngle = (cycleSec / 60) * Math.PI * 2; // 1 RPM synced to sweep second hand

    const pinion = this.computeMeshedGear(
      cx,
      cy,
      centerRadius,
      centerTeeth,
      centerAngle,
      16,
      gearModulePx,
      Math.atan2(-64, -76)
    );
    const regulator = this.computeMeshedGear(
      cx,
      cy,
      centerRadius,
      centerTeeth,
      centerAngle,
      18,
      gearModulePx,
      Math.atan2(58, 80)
    );

    // Bridge 1 (Lower Train Bridge): spans across the movement well behind the gears,
    // physically anchoring the pinion, center, and regulator arbors to the gunmetal plate
    this.drawMovementBridge(
      ctx,
      pinion.x - 36,
      pinion.y - 26,
      regulator.x + 36,
      regulator.y + 26,
      36,
      [
        { x: cx - 108, y: cy - 86 },
        { x: cx + 114, y: cy + 84 }
      ]
    );

    // Layered Z-depths: back-to-front (Regulator Wheel -> Pinion Wheel -> Central Escape Wheel)
    // Z-layer 1 (deepest): Lower-right Regulator Wheel (18 teeth, counter-clockwise)
    this.drawBrassGear(ctx, regulator.x, regulator.y, regulator.radius, regulator.teeth, regulator.angleRad, 0.86);
    // Z-layer 2 (middle): Upper-left Pinion Wheel (16 teeth, counter-clockwise)
    this.drawBrassGear(ctx, pinion.x, pinion.y, pinion.radius, pinion.teeth, pinion.angleRad, 0.94);
    // Z-layer 3 (front): Main center Escape Wheel (24 teeth, clockwise)
    this.drawBrassGear(ctx, cx, cy, centerRadius, centerTeeth, centerAngle, 1.0);

    // Bridge 2 (Upper Center Arbor Cock): spans from the left bezel wall to the center arbor
    // above the escape wheel (under the hands), with chamfered edges and steel screws
    this.drawMovementBridge(
      ctx,
      cx - apertureR - 4,
      cy + 22,
      cx,
      cy,
      24,
      [
        { x: cx - 124, y: cy + 18 },
        { x: cx - 96, y: cy + 14 }
      ],
      true
    );

    // Inner bevel shadow cast by the dial aperture wall into the skeleton well
    const wellWallShadow = ctx.createRadialGradient(
      cx + 10,
      cy + 12,
      apertureR - 24,
      cx + 10,
      cy + 12,
      apertureR + 6
    );
    wellWallShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
    wellWallShadow.addColorStop(0.65, 'rgba(0, 0, 0, 0.45)');
    wellWallShadow.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
    ctx.fillStyle = wellWallShadow;
    ctx.beginPath();
    ctx.arc(cx, cy, apertureR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Chamfered brass inner aperture ring
    const apertureRingGrad = ctx.createLinearGradient(
      cx - apertureR,
      cy - apertureR,
      cx + apertureR,
      cy + apertureR
    );
    apertureRingGrad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_SHADOW);
    apertureRingGrad.addColorStop(0.45, NIXIE_HYBRID_COLORS.BRASS_DARK);
    apertureRingGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_LIGHT);
    ctx.strokeStyle = apertureRingGrad;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, apertureR, 0, Math.PI * 2);
    ctx.stroke();

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

    // 7. Center Antique-Brass Arbor Cap (domed top-left lighting + drop shadow)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(cx + 3, cy + 4, 16, 0, Math.PI * 2);
    ctx.fill();

    const capGrad = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, 16);
    capGrad.addColorStop(0, '#f8e2b2');
    capGrad.addColorStop(0.55, NIXIE_HYBRID_COLORS.BRASS_MID);
    capGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_SHADOW);
    ctx.fillStyle = capGrad;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_LIGHT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = NIXIE_HYBRID_COLORS.PLASMA_CORE;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 8. Curved Sapphire-Crystal Dome Glare & Edge Vignette
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.clip();

    // Subtle upper-left curved crystal reflection
    const crystalGlare = ctx.createLinearGradient(
      cx - innerR * 0.85,
      cy - innerR * 0.85,
      cx + innerR * 0.25,
      cy + innerR * 0.25
    );
    crystalGlare.addColorStop(0, 'rgba(255, 250, 240, 0.085)');
    crystalGlare.addColorStop(0.38, 'rgba(255, 248, 235, 0.025)');
    crystalGlare.addColorStop(0.55, 'rgba(255, 248, 235, 0)');
    crystalGlare.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = crystalGlare;
    ctx.beginPath();
    ctx.ellipse(
      cx - innerR * 0.22,
      cy - innerR * 0.28,
      innerR * 0.88,
      innerR * 0.52,
      -Math.PI / 5,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Edge vignette under the crystal dome
    const vignette = ctx.createRadialGradient(cx, cy, innerR * 0.68, cx, cy, innerR);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
    ctx.fillStyle = vignette;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  /**
   * Computes tangent center position and phase-locked counter-rotation angle for an
   * outer gear meshing with the central wheel.
   * Note: drawBrassGear() places tooth tip centers at +3π/(4N) and valley centers at
   * +7π/(4N) in local coordinates, so the contact phase offset accounts for both the
   * center-to-center bearing angle and the half-tooth pitch alignment.
   */
  private computeMeshedGear(
    cx: number,
    cy: number,
    centerRadius: number,
    centerTeeth: number,
    centerAngle: number,
    outerTeeth: number,
    modulePx: number,
    dirAngle: number
  ): { x: number; y: number; radius: number; teeth: number; angleRad: number } {
    const radius = outerTeeth * modulePx;
    const distance = centerRadius + radius;
    const ratio = centerTeeth / outerTeeth;
    const phaseOffset = dirAngle * (1 + ratio) + Math.PI - Math.PI / (2 * outerTeeth);
    return {
      x: cx + Math.cos(dirAngle) * distance,
      y: cy + Math.sin(dirAngle) * distance,
      radius,
      teeth: outerTeeth,
      angleRad: -centerAngle * ratio + phaseOffset
    };
  }

  /**
   * Renders a chamfered machined-brass movement bridge with steel mounting screws
   * spanning across the skeleton well to physically support the gear arbors.
   */
  private drawMovementBridge(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    screws: Array<{ x: number; y: number }>,
    withCenterBoss = false
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    ctx.save();

    // Cast drop shadow onto deeper layer (top-left light source)
    ctx.save();
    ctx.translate(x1 + 4, y1 + 6);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.roundRect(0, -width / 2, len, width, width / 2);
    ctx.fill();
    if (withCenterBoss) {
      ctx.beginPath();
      ctx.arc(len, 0, width * 0.78, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Bridge body with high-contrast anisotropic brass gradient
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    const bridgeGrad = ctx.createLinearGradient(0, -width / 2, len, width / 2);
    bridgeGrad.addColorStop(0, '#fff0c4');
    bridgeGrad.addColorStop(0.25, '#c48f32');
    bridgeGrad.addColorStop(0.55, '#4b2f0b');
    bridgeGrad.addColorStop(0.8, '#b58129');
    bridgeGrad.addColorStop(1, '#2b1905');

    ctx.fillStyle = bridgeGrad;
    ctx.beginPath();
    ctx.roundRect(0, -width / 2, len, width, width / 2);
    ctx.fill();

    if (withCenterBoss) {
      ctx.beginPath();
      ctx.arc(len, 0, width * 0.78, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crisp pale-champagne chamfer bevel highlight on upper edge, dark bronze on lower edge
    ctx.strokeStyle = 'rgba(255, 244, 210, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(width * 0.4, -width / 2 + 1);
    ctx.lineTo(len - width * 0.4, -width / 2 + 1);
    ctx.stroke();

    ctx.strokeStyle = '#2a1805';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0, -width / 2, len, width, width / 2);
    ctx.stroke();
    ctx.restore();

    // Slotted steel bridge screws
    for (const s of screws) {
      this.drawSteelScrew(ctx, s.x, s.y, 4.5);
    }

    ctx.restore();
  }

  private drawSteelScrew(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(x + 1, y + 1.4, r + 0.6, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0.5, x, y, r);
    grad.addColorStop(0, '#f2f6fc');
    grad.addColorStop(0.5, '#8b96a6');
    grad.addColorStop(1, '#242930');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, y);
    ctx.rotate(-0.55);
    ctx.strokeStyle = '#15181c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0);
    ctx.lineTo(r * 0.7, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawBrassGear(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    radius: number,
    teeth: number,
    angleRad: number,
    depthBrightness = 1.0
  ): void {
    ctx.save();
    ctx.translate(gx, gy);

    // Subtle cast drop shadow onto deeper Z-layers (top-left light source)
    ctx.save();
    ctx.translate(4, 5);
    ctx.rotate(angleRad);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.54)';
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.rotate(angleRad);

    // High-contrast anisotropic machined-brass shading across gear rim
    const rimGrad = ctx.createLinearGradient(-radius, -radius, radius, radius);
    if (depthBrightness < 0.9) {
      rimGrad.addColorStop(0, '#d8b468');
      rimGrad.addColorStop(0.32, '#8c621d');
      rimGrad.addColorStop(0.55, '#3b2407');
      rimGrad.addColorStop(0.8, '#7a5418');
      rimGrad.addColorStop(1, '#261604');
    } else if (depthBrightness < 0.98) {
      rimGrad.addColorStop(0, '#f2d38a');
      rimGrad.addColorStop(0.3, '#a67524');
      rimGrad.addColorStop(0.55, '#472c09');
      rimGrad.addColorStop(0.8, '#93671f');
      rimGrad.addColorStop(1, '#2e1b05');
    } else {
      rimGrad.addColorStop(0, '#fff1c4');
      rimGrad.addColorStop(0.26, '#c89436');
      rimGrad.addColorStop(0.52, '#4d2f0a');
      rimGrad.addColorStop(0.76, '#b37e26');
      rimGrad.addColorStop(1, '#311d05');
    }

    ctx.fillStyle = rimGrad;
    ctx.strokeStyle =
      depthBrightness < 0.9
        ? '#593b0f'
        : '#f7dfa4';
    ctx.lineWidth = 1.2;

    // Gear Teeth Rim (addendum +4px, dedendum -6px for 2px radial root clearance at pitch tangency)
    const outerR = radius + 4;
    const innerR = radius - 6;
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

    // Hollowed Wheel Cutout (transparent-feeling dark cavity)
    const cutoutR = radius * 0.72;
    ctx.fillStyle = 'rgba(6, 3, 2, 0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, cutoutR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 5 Beveled Radial Spokes
    for (let s = 0; s < 5; s++) {
      const sa = (s * Math.PI * 2) / 5;
      const ex = Math.cos(sa) * cutoutR;
      const ey = Math.sin(sa) * cutoutR;

      ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.strokeStyle =
        depthBrightness < 0.9
          ? NIXIE_HYBRID_COLORS.BRASS_MID
          : NIXIE_HYBRID_COLORS.BRASS_GEAR_HIGHLIGHT;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore(); // End gear rotation so hub/arbor/ruby speculars align with top-left light

    // Center Brass Hub (fixed top-left directional highlight)
    const hubR = radius * 0.22;
    const hubGrad = ctx.createRadialGradient(-hubR * 0.3, -hubR * 0.3, 1, 0, 0, hubR);
    hubGrad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_LIGHT);
    hubGrad.addColorStop(0.65, NIXIE_HYBRID_COLORS.BRASS_MID);
    hubGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_SHADOW);
    ctx.fillStyle = hubGrad;
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fill();

    // Steel Center Arbor Collar
    const steelR = Math.max(4.5, radius * 0.11);
    const steelGrad = ctx.createLinearGradient(-steelR, -steelR, steelR, steelR);
    steelGrad.addColorStop(0, '#d8e0ea');
    steelGrad.addColorStop(0.5, '#6c7785');
    steelGrad.addColorStop(1, '#262b33');
    ctx.fillStyle = steelGrad;
    ctx.beginPath();
    ctx.arc(0, 0, steelR, 0, Math.PI * 2);
    ctx.fill();

    // Synthetic Ruby Jewel Bearing
    const rubyR = Math.max(2.4, radius * 0.055);
    const rubyGrad = ctx.createRadialGradient(-rubyR * 0.3, -rubyR * 0.3, 0.4, 0, 0, rubyR);
    rubyGrad.addColorStop(0, '#ff6b8b');
    rubyGrad.addColorStop(0.55, '#a80c2e');
    rubyGrad.addColorStop(1, '#3d0210');
    ctx.fillStyle = rubyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rubyR, 0, Math.PI * 2);
    ctx.fill();

    // Specular pinpoint on jewel
    ctx.fillStyle = 'rgba(255, 240, 245, 0.85)';
    ctx.beginPath();
    ctx.arc(-rubyR * 0.32, -rubyR * 0.32, Math.max(0.8, rubyR * 0.28), 0, Math.PI * 2);
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
    const angleRad = (angleDeg * Math.PI) / 180;
    const halfBase = spec.baseWidth / 2;
    const halfTip = spec.tipWidth / 2;
    const innerBase = Math.max(2, halfBase - spec.railThickness);
    const innerTip = Math.max(1.5, halfTip - spec.railThickness);

    const traceHandPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(-halfBase * 0.85, spec.tailLength);
      ctx.lineTo(-halfBase, 0);
      ctx.lineTo(-halfTip, -spec.cutoutEnd);
      ctx.lineTo(0, -spec.length);
      ctx.lineTo(halfTip, -spec.cutoutEnd);
      ctx.lineTo(halfBase, 0);
      ctx.lineTo(halfBase * 0.85, spec.tailLength);
      ctx.closePath();

      ctx.moveTo(-innerBase, -spec.cutoutStart);
      ctx.lineTo(innerBase, -spec.cutoutStart);
      ctx.lineTo(innerTip, -spec.cutoutEnd + 6);
      ctx.lineTo(-innerTip, -spec.cutoutEnd + 6);
      ctx.closePath();
    };

    // Soft dynamic drop shadow cast toward bottom-right onto dial & gear train
    ctx.save();
    ctx.translate(cx + 5, cy + 7);
    ctx.rotate(angleRad);
    traceHandPath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);

    traceHandPath();

    const handGrad = ctx.createLinearGradient(-halfBase, -spec.length * 0.4, halfBase, spec.tailLength);
    handGrad.addColorStop(0, '#fff2ca');
    handGrad.addColorStop(0.32, '#c89436');
    handGrad.addColorStop(0.58, '#4a2e09');
    handGrad.addColorStop(0.82, '#b07b24');
    handGrad.addColorStop(1, '#2b1905');
    ctx.fillStyle = handGrad;
    ctx.fill('evenodd');

    ctx.strokeStyle = '#f8e2aa';
    ctx.lineWidth = 1.4;
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
    const angleRad = (angleDeg * Math.PI) / 180;

    const traceSecondHand = (): void => {
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
    };

    // Higher Z-plane drop shadow cast toward bottom-right
    ctx.save();
    ctx.translate(cx + 8, cy + 11);
    ctx.rotate(angleRad);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.lineWidth = 2.6;
    traceSecondHand();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);

    ctx.strokeStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.fillStyle = NIXIE_HYBRID_COLORS.COPPER_ORANGE;
    ctx.lineWidth = 2.2;
    traceSecondHand();

    ctx.restore();
  }

  // ============================================================================
  // Zone 02 — IN-18 Nixie Tube Cell Matrix & Cathode Anti-Poisoning Sweep
  // ============================================================================

  private renderZone02NixieMatrix(
    ctx: CanvasRenderingContext2D,
    tick: SynchronizedTimeTick,
    sweepElapsedMs: number | null,
    plasmaIntensity: number,
    realTimeMs = performance.now(),
    isSleepBlackout = false
  ): void {
    ctx.save();

    const activeTubeChars: string[] = [];
    let tubeIdx = 0;

    for (let i = 0; i < this.cellSlots.length; i++) {
      const slot = this.cellSlots[i];
      const cell = tick.cells[i];
      const isVisible = cell?.visible ?? true;

      if (slot.isSeparator) {
        if (!isSleepBlackout) {
          this.renderNeonColonBulbAssembly(ctx, slot, isVisible, plasmaIntensity);
        }
      } else {
        // Compute active digit (either normal synchronized digit or rapid 0-9 slot-machine sweep)
        let activeChar = cell?.char || '0';
        if (sweepElapsedMs !== null && isVisible) {
          // Rapid slot-machine cycle (0-9 across all 6 tubes with slight per-tube phase offset)
          const cycleDigit = Math.floor(sweepElapsedMs / 55 + tubeIdx * 1.7) % 10;
          activeChar = String(cycleDigit);
        }

        // Track 110ms neon-plasma switching crossfade & ~15% strike surge per tube
        const tr = this.tubeTransitions[tubeIdx];
        let previousChar: string | null = null;
        let outgoingAlpha = 0;
        let incomingGain = 1.0;

        if (tr) {
          if (activeChar !== tr.currentChar) {
            tr.previousChar = tr.currentChar;
            tr.currentChar = activeChar;
            tr.transitionStartMs = realTimeMs;
          }
          const elapsed = realTimeMs - tr.transitionStartMs;
          if (elapsed >= 0 && elapsed < NIXIE_SWITCH_DURATION_MS && tr.previousChar !== null) {
            const p = elapsed / NIXIE_SWITCH_DURATION_MS;
            previousChar = tr.previousChar;
            outgoingAlpha = Math.exp(-4.5 * p);
            incomingGain = isSleepBlackout
              ? Math.min(1, p / 0.35)
              : 1 + 0.15 * Math.sin(Math.min(1, p / 0.42) * Math.PI) * (1 - p);
          } else {
            tr.previousChar = null;
          }
        }

        activeTubeChars.push(activeChar);
        this.renderIn18NixieTube(
          ctx,
          slot,
          activeChar,
          isVisible,
          plasmaIntensity,
          tubeIdx,
          realTimeMs,
          previousChar,
          outgoingAlpha,
          incomingGain,
          isSleepBlackout
        );
        tubeIdx++;
      }
    }

    this.lastActiveTubeDigits = activeTubeChars;

    if (isSleepBlackout) {
      ctx.restore();
      return;
    }

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
   * Renders an individual physical IN-18 Nixie tube seated in a recessed dark-brass socket well:
   * - Recessed shadow cavity & chamfered dark-brass bezel cut into the walnut panel
   * - Glazed-alumina ceramic insulator disc, dark metal pin-header collar, steel support rods & mica spacers
   * - Stacked dark-gunmetal unlit bent-wire cathode silhouettes (behind & in front of active digit)
   * - Continuous bent-wire neon-plasma cathode with 110ms crossfade, ~15% strike surge & live gas shimmer
   * - Fine dark hexagonal anode wire mesh + thick borosilicate glass wall refraction & speculars
   */
  private renderIn18NixieTube(
    ctx: CanvasRenderingContext2D,
    slot: DigitalCellSlotGeometry,
    activeChar: string,
    isLit: boolean,
    plasmaIntensity: number,
    tubeIdx: number,
    realTimeMs: number,
    previousChar: string | null,
    outgoingAlpha: number,
    incomingGain: number,
    isSleepBlackout = false
  ): void {
    ctx.save();

    const cx = slot.x + slot.width / 2;
    const cy = slot.y + slot.height / 2 - 4;
    const tubeW = slot.width - 4;
    const tubeH = slot.height - 14;
    const tubeX = slot.x + 2;
    const tubeY = slot.y;

    // Sleep (Cat mode) Blackout: render ONLY isolated low-current (~14%) bent-wire cathodes
    if (isSleepBlackout) {
      if (!isLit) {
        ctx.restore();
        return;
      }

      const digitW = tubeW * 0.46;
      const digitH = tubeH * 0.56;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const drawDimSleepCathode = (char: string, gain: number): void => {
        if (gain <= 0.01) return;
        const g = plasmaIntensity * gain;

        // Tight, subtle radial halo
        const tightHalo = ctx.createRadialGradient(cx, cy, 2, cx, cy, tubeW * 0.44);
        tightHalo.addColorStop(0, `rgba(255, 92, 18, ${(0.24 * g).toFixed(3)})`);
        tightHalo.addColorStop(0.55, `rgba(255, 110, 24, ${(0.09 * g).toFixed(3)})`);
        tightHalo.addColorStop(1, 'rgba(255, 110, 24, 0)');
        ctx.fillStyle = tightHalo;
        ctx.beginPath();
        ctx.arc(cx, cy, tubeW * 0.44, 0, Math.PI * 2);
        ctx.fill();

        // Subtle outer amber-orange glow
        ctx.strokeStyle = `rgba(255, 110, 24, ${(0.35 * g).toFixed(3)})`;
        ctx.lineWidth = 7.5;
        this.traceNixieWireDigitPath(ctx, char, cx, cy, digitW, digitH);
        ctx.stroke();

        // Deep, warm amber-orange low-current filament (~14% brightness, no white-hot core)
        ctx.strokeStyle = `rgba(255, 104, 22, ${Math.min(0.24, 0.95 * g).toFixed(3)})`;
        ctx.lineWidth = 3.2;
        this.traceNixieWireDigitPath(ctx, char, cx, cy, digitW, digitH);
        ctx.stroke();
      };

      if (previousChar && outgoingAlpha > 0.02) {
        drawDimSleepCathode(previousChar, outgoingAlpha);
      }
      drawDimSleepCathode(activeChar, incomingGain);

      ctx.restore();
      return;
    }

    // 0. Recessed Dark-Shadowed Socket Well & Chamfered Dark-Brass Bezel
    const wellX = slot.x - 5;
    const wellY = slot.y - 4;
    const wellW = slot.width + 10;
    const wellH = slot.height + 10;

    ctx.fillStyle = '#070403';
    ctx.beginPath();
    ctx.roundRect(wellX, wellY, wellW, wellH, 12);
    ctx.fill();

    // Deep cavity inner shadow (top-left lip overhang)
    const cavityShadow = ctx.createLinearGradient(wellX, wellY, wellX + 18, wellY + 24);
    cavityShadow.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
    cavityShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cavityShadow;
    ctx.beginPath();
    ctx.roundRect(wellX, wellY, wellW, wellH, 12);
    ctx.fill();

    // Chamfered dark-brass well bezel
    const wellBezelGrad = ctx.createLinearGradient(wellX, wellY, wellX + wellW, wellY + wellH);
    wellBezelGrad.addColorStop(0, '#2a1805');
    wellBezelGrad.addColorStop(0.45, '#593a10');
    wellBezelGrad.addColorStop(1, '#c89436');
    ctx.strokeStyle = wellBezelGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(wellX, wellY, wellW, wellH, 12);
    ctx.stroke();

    // Subtle organic neon-gas micro-flicker
    const shimmer =
      1 +
      0.024 * Math.sin(realTimeMs * 0.029 + tubeIdx * 2.1) +
      0.014 * Math.cos(realTimeMs * 0.053 + tubeIdx * 1.3);
    const effectiveIntensity = plasmaIntensity * shimmer;

    // Warm Amber Bloom Reflecting Off Inner Socket Well Behind Tube
    if (isLit) {
      const bayGlow = ctx.createRadialGradient(cx, cy, 8, cx, cy, tubeW * 1.05);
      bayGlow.addColorStop(0, `rgba(255, 105, 18, ${(0.36 * effectiveIntensity).toFixed(3)})`);
      bayGlow.addColorStop(0.55, `rgba(255, 122, 26, ${(0.15 * effectiveIntensity).toFixed(3)})`);
      bayGlow.addColorStop(1, 'rgba(255, 122, 26, 0)');
      ctx.fillStyle = bayGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, tubeW * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }

    // 1. Dark Metal Pin-Header Collar & Glazed-Alumina Ceramic Insulator Disc
    const socketY = tubeY + tubeH - 4;
    const socketH = 18;

    // Glazed-alumina ceramic insulator disc (shaded top-left to bottom-right)
    const ceramicGrad = ctx.createLinearGradient(slot.x + 3, socketY, slot.x + slot.width - 3, socketY + socketH);
    ceramicGrad.addColorStop(0, '#ebe5d8');
    ceramicGrad.addColorStop(0.48, '#c5bcb0');
    ceramicGrad.addColorStop(1, '#756d62');
    ctx.fillStyle = ceramicGrad;
    ctx.strokeStyle = '#4a433b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(slot.x + 3, socketY + 2, slot.width - 6, socketH - 1, [4, 4, 8, 8]);
    ctx.fill();
    ctx.stroke();

    // Glazed ceramic top specular lip
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(slot.x + 7, socketY + 3.5);
    ctx.lineTo(slot.x + slot.width - 7, socketY + 3.5);
    ctx.stroke();

    // Dark metal pin-header collar gripping the glass base
    const collarGrad = ctx.createLinearGradient(slot.x + 1, socketY - 6, slot.x + slot.width - 1, socketY + 4);
    collarGrad.addColorStop(0, '#3a4048');
    collarGrad.addColorStop(0.3, '#23272e');
    collarGrad.addColorStop(0.7, '#14171c');
    collarGrad.addColorStop(1, '#0b0d10');
    ctx.fillStyle = collarGrad;
    ctx.strokeStyle = '#565e6b';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(slot.x + 1, socketY - 6, slot.width - 2, 10, 3);
    ctx.fill();
    ctx.stroke();

    // Gold-plated contact pins in ceramic header
    ctx.fillStyle = NIXIE_HYBRID_COLORS.CERAMIC_PIN_GOLD;
    for (let p = -3; p <= 3; p++) {
      ctx.fillRect(cx + p * 10 - 1.5, socketY + 5, 3, 8);
    }

    // 2. Thick Borosilicate Glass Envelope (dark interior glass backdrop + exhaust pip)
    const glassBodyGrad = ctx.createLinearGradient(tubeX, tubeY, tubeX + tubeW, tubeY);
    glassBodyGrad.addColorStop(0, 'rgba(32, 26, 24, 0.92)');
    glassBodyGrad.addColorStop(0.18, 'rgba(15, 11, 10, 0.88)');
    glassBodyGrad.addColorStop(0.5, 'rgba(9, 7, 7, 0.86)');
    glassBodyGrad.addColorStop(0.84, 'rgba(13, 10, 9, 0.90)');
    glassBodyGrad.addColorStop(1, 'rgba(26, 20, 18, 0.95)');
    ctx.fillStyle = glassBodyGrad;
    ctx.strokeStyle = 'rgba(220, 206, 192, 0.42)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(tubeX, tubeY + 4, tubeW, tubeH - 4, [32, 32, 6, 6]);
    ctx.fill();
    ctx.stroke();

    // Exhaust glass pip at top center
    ctx.beginPath();
    ctx.arc(cx, tubeY + 4, 5, Math.PI, 0);
    ctx.stroke();

    // Clip interior to glass envelope
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tubeX + 2, tubeY + 6, tubeW - 4, tubeH - 8, [30, 30, 4, 4]);
    ctx.clip();

    // Thick glass wall refraction band along inner edges
    ctx.strokeStyle = 'rgba(210, 198, 186, 0.14)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(tubeX + 3.5, tubeY + 7.5, tubeW - 7, tubeH - 11, [28, 28, 3, 3]);
    ctx.stroke();

    // Top & bottom mica spacer plates + twin vertical steel support rods
    const topMicaY = tubeY + 20;
    const botMicaY = tubeY + tubeH - 14;
    const rodOffsetX = tubeW * 0.34;

    for (const rx of [cx - rodOffsetX, cx + rodOffsetX]) {
      const rodGrad = ctx.createLinearGradient(rx - 1.5, 0, rx + 1.5, 0);
      rodGrad.addColorStop(0, '#3a4048');
      rodGrad.addColorStop(0.4, '#8d97a6');
      rodGrad.addColorStop(1, '#1e2228');
      ctx.fillStyle = rodGrad;
      ctx.fillRect(rx - 1.3, topMicaY - 2, 2.6, botMicaY - topMicaY + 4);
    }

    for (const my of [topMicaY, botMicaY]) {
      ctx.fillStyle = 'rgba(150, 134, 114, 0.28)';
      ctx.strokeStyle = 'rgba(210, 192, 168, 0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tubeX + 9, my - 2.5, tubeW - 18, 5, 2);
      ctx.fill();
      ctx.stroke();
    }

    const digitW = tubeW * 0.46;
    const digitH = tubeH * 0.56;

    // 3. Multi-Layer Dark-Gunmetal Unlit Bent-Wire Cathode Silhouettes (behind active digit)
    const depthDigits = ['0', '8', '3', '6', '9'];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let d = 0; d < depthDigits.length; d++) {
      const ghostChar = depthDigits[d];
      if (ghostChar === activeChar && isLit) continue;
      const offsetX = (d - 2) * 1.6;
      const offsetY = ((d % 3) - 1) * 1.5;
      ctx.strokeStyle = 'rgba(68, 72, 78, 0.34)';
      ctx.lineWidth = 1.6;
      this.traceNixieWireDigitPath(ctx, ghostChar, cx + offsetX, cy + offsetY, digitW, digitH);
      ctx.stroke();
    }

    // Helper to render a bent-wire neon-plasma cathode at given gain/alpha
    const drawLitWireCathode = (char: string, gain: number): void => {
      if (gain <= 0.01) return;
      const g = effectiveIntensity * gain;

      // Wide ambient plasma bloom
      const bloomGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, tubeW * 0.78);
      bloomGrad.addColorStop(0, `rgba(255, 85, 0, ${Math.min(1, 0.70 * g).toFixed(3)})`);
      bloomGrad.addColorStop(0.5, `rgba(255, 154, 46, ${Math.min(1, 0.36 * g).toFixed(3)})`);
      bloomGrad.addColorStop(1, 'rgba(255, 154, 46, 0)');
      ctx.fillStyle = bloomGrad;
      ctx.fillRect(tubeX, tubeY, tubeW, tubeH);

      // Outer #FF9A2E neon-orange plasma halo
      ctx.strokeStyle = `rgba(255, 145, 40, ${Math.min(1, 0.42 * g).toFixed(3)})`;
      ctx.lineWidth = 11.5;
      this.traceNixieWireDigitPath(ctx, char, cx, cy, digitW, digitH);
      ctx.stroke();

      // Primary #FF5500 neon-orange plasma sheath
      ctx.strokeStyle = `rgba(255, 85, 0, ${Math.min(1, 0.96 * g).toFixed(3)})`;
      ctx.lineWidth = 5.4;
      this.traceNixieWireDigitPath(ctx, char, cx, cy, digitW, digitH);
      ctx.stroke();

      // Hot peach-white ionized wire core (brightens slightly on initial strike surge)
      ctx.strokeStyle =
        gain > 1.04
          ? `rgba(255, 244, 224, ${Math.min(1, 0.98 * g).toFixed(3)})`
          : `rgba(255, 228, 192, ${Math.min(1, 0.92 * g).toFixed(3)})`;
      ctx.lineWidth = 2.0;
      this.traceNixieWireDigitPath(ctx, char, cx, cy, digitW, digitH);
      ctx.stroke();
    };

    // 4. Neon-Plasma Switching (110ms exponential fade-out + strike surge) & Inner Rim Glow
    if (isLit) {
      if (previousChar && outgoingAlpha > 0.02) {
        drawLitWireCathode(previousChar, outgoingAlpha);
      }
      drawLitWireCathode(activeChar, incomingGain);

      // Warm orange inner rim reflections on left and right glass walls
      ctx.fillStyle = `rgba(255, 110, 25, ${(0.28 * effectiveIntensity).toFixed(3)})`;
      ctx.fillRect(tubeX + 2.5, tubeY + 16, 4.5, tubeH - 26);
      ctx.fillRect(tubeX + tubeW - 7, tubeY + 16, 4.5, tubeH - 26);
    }

    // Foreground unlit dark-gunmetal wire cathode silhouette in front of active digit
    const frontGhost = activeChar === '4' ? '7' : '4';
    ctx.strokeStyle = 'rgba(42, 45, 50, 0.42)';
    ctx.lineWidth = 1.5;
    this.traceNixieWireDigitPath(ctx, frontGhost, cx + 1.1, cy - 1.0, digitW, digitH);
    ctx.stroke();

    // 5. Fine Dark Hexagonal Wire-Mesh Anode Screen across front of digits
    ctx.strokeStyle = 'rgba(20, 16, 14, 0.56)';
    ctx.lineWidth = 0.85;
    const hexR = 6.5;
    const hexH = hexR * 0.866;
    let rowIdx = 0;
    for (let my = tubeY + 8; my < tubeY + tubeH - 4; my += hexH * 1.5) {
      const offsetX = rowIdx % 2 === 0 ? 0 : hexR * 1.5;
      for (let mx = tubeX + 2; mx < tubeX + tubeW + hexR; mx += hexR * 3) {
        const hx = mx + offsetX;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const vx = hx + Math.cos(a) * hexR;
          const vy = my + Math.sin(a) * hexR;
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
      }
      rowIdx++;
    }

    ctx.restore(); // End glass interior clip

    // Warm orange light spill onto ceramic base & lower brass bezel when lit
    if (isLit) {
      const spillGrad = ctx.createRadialGradient(
        cx,
        socketY - 2,
        4,
        cx,
        socketY + 4,
        tubeW * 0.58
      );
      spillGrad.addColorStop(0, `rgba(255, 110, 24, ${(0.36 * effectiveIntensity).toFixed(3)})`);
      spillGrad.addColorStop(0.6, `rgba(255, 125, 30, ${(0.14 * effectiveIntensity).toFixed(3)})`);
      spillGrad.addColorStop(1, 'rgba(255, 125, 30, 0)');
      ctx.fillStyle = spillGrad;
      ctx.fillRect(wellX, socketY - 8, wellW, 28);
    }

    // 6. Crisp Vertical Cylindrical Borosilicate Glass Speculars & Dome Reflection
    ctx.strokeStyle = 'rgba(255, 250, 242, 0.36)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(tubeX + 8.5, tubeY + 24);
    ctx.lineTo(tubeX + 8.5, tubeY + tubeH - 12);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 250, 242, 0.22)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx - 4, tubeY + 28, tubeW * 0.34, Math.PI * 1.05, Math.PI * 1.48);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 250, 242, 0.20)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(tubeX + tubeW - 7.5, tubeY + 26);
    ctx.lineTo(tubeX + tubeW - 7.5, tubeY + tubeH - 14);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Traces continuous bent-wire cathode paths for digits '0'–'9' with rounded bends.
   */
  private traceNixieWireDigitPath(
    ctx: CanvasRenderingContext2D,
    char: string,
    cx: number,
    cy: number,
    w: number,
    h: number
  ): void {
    const hw = w / 2;
    const hh = h / 2;
    const l = cx - hw;
    const r = cx + hw;
    const t = cy - hh;
    const b = cy + hh;

    ctx.beginPath();
    switch (char) {
      case '0': {
        ctx.roundRect(l, t, w, h, hw);
        break;
      }
      case '1': {
        ctx.moveTo(cx - hw * 0.45, t + hh * 0.38);
        ctx.lineTo(cx + hw * 0.1, t);
        ctx.lineTo(cx + hw * 0.1, b);
        ctx.moveTo(cx - hw * 0.45, b);
        ctx.lineTo(cx + hw * 0.55, b);
        break;
      }
      case '2': {
        ctx.moveTo(l + 2, t + hh * 0.42);
        ctx.bezierCurveTo(l + 2, t - 2, r, t - 2, r, t + hh * 0.45);
        ctx.bezierCurveTo(r, cy - 2, l, cy + hh * 0.28, l, b);
        ctx.lineTo(r, b);
        break;
      }
      case '3': {
        ctx.moveTo(l + 2, t + hh * 0.34);
        ctx.bezierCurveTo(l + 2, t - 2, r - 1, t - 2, r - 1, t + hh * 0.42);
        ctx.bezierCurveTo(r - 1, cy - 2, cx - 4, cy, cx - 4, cy);
        ctx.bezierCurveTo(r, cy, r, b + 2, l + 2, b - hh * 0.34);
        break;
      }
      case '4': {
        ctx.moveTo(r - hw * 0.35, b);
        ctx.lineTo(r - hw * 0.35, t);
        ctx.lineTo(l, cy + hh * 0.22);
        ctx.lineTo(r, cy + hh * 0.22);
        break;
      }
      case '5': {
        ctx.moveTo(r - 2, t);
        ctx.lineTo(l + 2, t);
        ctx.lineTo(l + 2, cy - hh * 0.1);
        ctx.bezierCurveTo(cx, cy - hh * 0.25, r, cy - 2, r, cy + hh * 0.42);
        ctx.bezierCurveTo(r, b + 2, l + 2, b + 2, l + 2, b - hh * 0.3);
        break;
      }
      case '6': {
        ctx.moveTo(r - 3, t + hh * 0.22);
        ctx.bezierCurveTo(cx + 2, t - 3, l, t + hh * 0.2, l, cy + hh * 0.25);
        ctx.bezierCurveTo(l, b + 2, r, b + 2, r, cy + hh * 0.32);
        ctx.bezierCurveTo(r, cy - hh * 0.12, l, cy - hh * 0.12, l, cy + hh * 0.28);
        break;
      }
      case '7': {
        ctx.moveTo(l, t);
        ctx.lineTo(r, t);
        ctx.lineTo(cx - hw * 0.22, b);
        break;
      }
      case '8': {
        ctx.arc(cx, t + hh * 0.46, hw * 0.78, 0, Math.PI * 2);
        ctx.moveTo(cx + hw * 0.9, b - hh * 0.48);
        ctx.arc(cx, b - hh * 0.48, hw * 0.9, 0, Math.PI * 2);
        break;
      }
      case '9': {
        ctx.moveTo(l + 3, b - hh * 0.22);
        ctx.bezierCurveTo(cx - 2, b + 3, r, b - hh * 0.2, r, cy - hh * 0.25);
        ctx.bezierCurveTo(r, t - 2, l, t - 2, l, cy - hh * 0.32);
        ctx.bezierCurveTo(l, cy + hh * 0.12, r, cy + hh * 0.12, r, cy - hh * 0.28);
        break;
      }
      default: {
        ctx.roundRect(l, t, w, h, hw);
        break;
      }
    }
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
    grad.addColorStop(0, NIXIE_HYBRID_COLORS.BRASS_SHADOW);
    grad.addColorStop(0.28, '#f6deaa');
    grad.addColorStop(0.55, NIXIE_HYBRID_COLORS.BRASS_MID);
    grad.addColorStop(0.85, NIXIE_HYBRID_COLORS.BRASS_DARK);
    grad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_SHADOW);

    ctx.fillStyle = grad;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Top chamfer specular highlight line
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 1.5);
    ctx.lineTo(x + w - 4, y + 1.5);
    ctx.stroke();
  }

  private drawBrassRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();

    // Countersink ambient occlusion & directional drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 2, 6.2, 0, Math.PI * 2);
    ctx.fill();

    // Domed machined brass screw head (top-left light source)
    const screwGrad = ctx.createRadialGradient(x - 1.8, y - 1.8, 0.8, x, y, 5.5);
    screwGrad.addColorStop(0, '#f8e3b4');
    screwGrad.addColorStop(0.55, NIXIE_HYBRID_COLORS.BRASS_MID);
    screwGrad.addColorStop(1, NIXIE_HYBRID_COLORS.BRASS_SHADOW);

    ctx.fillStyle = screwGrad;
    ctx.strokeStyle = NIXIE_HYBRID_COLORS.BRASS_SHADOW;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Diagonal slotted screw recess
    ctx.translate(x, y);
    ctx.rotate(-0.62);
    ctx.strokeStyle = 'rgba(18, 10, 4, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-3.4, 0);
    ctx.lineTo(3.4, 0);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 232, 185, 0.28)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-3.2, 0.9);
    ctx.lineTo(3.2, 0.9);
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

