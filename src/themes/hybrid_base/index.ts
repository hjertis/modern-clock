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
import {
  DigitalCellSlotGeometry,
  HYBRID_BASE_COLORS,
  HYBRID_BASE_GEOMETRY,
  HYBRID_BASE_MANIFEST,
  HYBRID_BASE_VERSION,
  HYBRID_DIGITAL_CELL_SLOTS
} from './constants';

export * from './constants';

interface AlertPulse {
  startTimeMs: number;
  durationMs: number;
  color: string;
}

export class HybridBaseTheme implements Theme {
  public readonly id = 'hybrid_base';
  public readonly name = 'Hybrid Analog/Digital';
  public readonly version = HYBRID_BASE_VERSION;

  private manifest: ThemeManifest = structuredClone(HYBRID_BASE_MANIFEST);
  private readonly cellSlots: DigitalCellSlotGeometry[] = HYBRID_DIGITAL_CELL_SLOTS;
  private isMounted = false;
  private chassisDrawnForFrame = false;
  private currentMode: ClockMode = 'active';
  private activePulses: AlertPulse[] = [];
  private lastRenderedTick: SynchronizedTimeTick | null = null;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getCellSlots(): DigitalCellSlotGeometry[] {
    return this.cellSlots.map((slot) => ({ ...slot }));
  }

  public getLastRenderedTick(): SynchronizedTimeTick | null {
    return this.lastRenderedTick;
  }

  public mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): void {
    this.isMounted = true;
    this.chassisDrawnForFrame = false;
    this.activePulses = [];

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(HYBRID_BASE_MANIFEST);
    }
  }

  public renderPendulum(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted) return;

    if (!this.chassisDrawnForFrame) {
      this.drawChassis(ctx);
      this.chassisDrawnForFrame = true;
    }

    // Pause cleanly in sleep mode or when fully damped
    if (this.currentMode === 'sleep' || physicsData.dampingFactor <= 0.001) {
      return;
    }

    const pivot = this.manifest.pendulum.pivot;
    const length = HYBRID_BASE_GEOMETRY.PENDULUM_LENGTH;
    const bobRadius = HYBRID_BASE_GEOMETRY.PENDULUM_BOB_RADIUS;
    const lowerZone = HYBRID_BASE_GEOMETRY.LOWER_ZONE_RECT;

    // Smooth dimming in night mode or when notification toast is active
    const nightAlpha = this.currentMode === 'night' ? 0.45 : 1.0;
    const notifAlpha = physicsData.dimmed ? 0.25 : 1.0;
    const dampingAlpha = Math.max(0.15, Math.min(1.0, physicsData.dampingFactor));

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(lowerZone.x + 8, lowerZone.y + 8, lowerZone.width - 16, lowerZone.height - 16, 12);
    ctx.clip();

    ctx.globalAlpha = nightAlpha * notifAlpha * dampingAlpha;

    // 1. Calibration Swing Scale Arc at bottom of pendulum travel
    this.drawPendulumScaleArc(ctx, pivot.x, pivot.y, length + bobRadius + 28, physicsData.maxAngleDeg);

    // 2. Harmonic Pendulum Assembly (Rod + Concentric Bob)
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(physicsData.angleRad);

    // Hinge Trunnion Block
    ctx.fillStyle = HYBRID_BASE_COLORS.BORDER_HIGHLIGHT;
    ctx.strokeStyle = HYBRID_BASE_COLORS.INDEX_PRIMARY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -10, 44, 24, 4);
    ctx.fill();
    ctx.stroke();

    // Twin-Rail Skeletonized Suspension Rod
    ctx.strokeStyle = HYBRID_BASE_COLORS.PENDULUM_ROD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, 14);
    ctx.lineTo(-5, length - bobRadius);
    ctx.moveTo(5, 14);
    ctx.lineTo(5, length - bobRadius);
    ctx.stroke();

    // Cross-braces along rod
    ctx.lineWidth = 1.5;
    for (let y = 90; y < length - bobRadius - 20; y += 95) {
      ctx.beginPath();
      ctx.moveTo(-5, y);
      ctx.lineTo(5, y);
      ctx.stroke();
    }

    // Concentric Machined Pendulum Bob
    const bobY = length;
    ctx.fillStyle = HYBRID_BASE_COLORS.PENDULUM_BOB_OUTER;
    ctx.strokeStyle = HYBRID_BASE_COLORS.PENDULUM_BOB_RING;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, bobY, bobRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner Metering Ring (skeletonized crosshair inside bob)
    ctx.strokeStyle = HYBRID_BASE_COLORS.INDEX_SECONDARY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, bobY, bobRadius * 0.64, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-bobRadius * 0.8, bobY);
    ctx.lineTo(bobRadius * 0.8, bobY);
    ctx.moveTo(0, bobY - bobRadius * 0.8);
    ctx.lineTo(0, bobY + bobRadius * 0.8);
    ctx.stroke();

    // Center Phase Core
    ctx.fillStyle = HYBRID_BASE_COLORS.PENDULUM_BOB_CORE;
    ctx.beginPath();
    ctx.arc(0, bobY, 9, 0, Math.PI * 2);
    ctx.fill();

    // Bottom Regulation Pointer Spike
    ctx.fillStyle = HYBRID_BASE_COLORS.HAND_SECOND;
    ctx.beginPath();
    ctx.moveTo(-4, bobY + bobRadius);
    ctx.lineTo(4, bobY + bobRadius);
    ctx.lineTo(0, bobY + bobRadius + 18);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  public renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted) return;

    if (!this.chassisDrawnForFrame) {
      this.drawChassis(ctx);
      this.chassisDrawnForFrame = true;
    }

    // Derive synchronized analog & digital components from the single timestamp tick.
    // Respects active secondMode ('sweep' vs 'tick') for analog hands while digital cells step cleanly.
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

    const nightAlpha = this.currentMode === 'night' ? 0.65 : 1.0;

    ctx.save();
    ctx.globalAlpha = nightAlpha;

    // Zone 1: Upper Analog Dial
    this.renderUpperAnalogDial(ctx, syncTick);

    // Zone 2: Center Digital Module (8 discrete character cells + Date/AM-PM strip)
    this.renderCenterDigitalModule(ctx, syncTick);

    ctx.restore();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    this.chassisDrawnForFrame = false;

    if (telemetryData.mode) {
      this.currentMode = telemetryData.mode;
    } else if (telemetryData.isSleeping) {
      this.currentMode = 'sleep';
    }

    if (telemetryData.isSleeping) {
      this.activePulses = [];
      return;
    }

    const now = performance.now();
    this.activePulses = this.activePulses.filter((p) => now - p.startTimeMs < p.durationMs);

    if (this.activePulses.length > 0) {
      const cx = this.manifest.dial.center.x;
      const cy = this.manifest.dial.center.y;
      ctx.save();
      for (const pulse of this.activePulses) {
        const progress = (now - pulse.startTimeMs) / pulse.durationMs;
        const alpha = Math.max(0, (1 - progress) * 0.55);
        const radius = HYBRID_BASE_GEOMETRY.DIAL_OUTER_RADIUS + progress * 32;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = pulse.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3.5 * (1 - progress * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Bottom Structural Status Strip
    const opts = this.lastRenderedTick?.options || sharedDisplayOptions.getOptions();
    const wsLabel = telemetryData.wsStatus === 'connected' ? 'SYNCED' : 'LOCAL';
    const modeLabel = (telemetryData.mode || 'active').toUpperCase();

    ctx.save();
    ctx.fillStyle = HYBRID_BASE_COLORS.ZONE_PANEL_BG;
    ctx.strokeStyle = HYBRID_BASE_COLORS.BORDER_STRUCTURAL;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(220, 1836, 640, 40, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `HYBRID BASE ${HYBRID_BASE_VERSION}  •  ${opts.hourFormat.toUpperCase()}  •  ${modeLabel}  •  ${wsLabel}  •  ${telemetryData.fps.toFixed(0)} FPS`,
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

    if (
      event.type === 'notification' ||
      event.type === 'priority_alert' ||
      event.type === 'mqtt_pulse'
    ) {
      const isUrgent = event.priority === 'urgent' || event.category === 'alert';
      this.activePulses.push({
        startTimeMs: performance.now(),
        durationMs: 1200,
        color: isUrgent ? HYBRID_BASE_COLORS.ALERT_URGENT : HYBRID_BASE_COLORS.CELL_GLYPH_ACCENT
      });
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.chassisDrawnForFrame = false;
    this.activePulses = [];
    this.lastRenderedTick = null;
  }

  private drawChassis(ctx: CanvasRenderingContext2D): void {
    const { WIDTH, HEIGHT, UPPER_ZONE_RECT, DIGITAL_ZONE_RECT, LOWER_ZONE_RECT } =
      HYBRID_BASE_GEOMETRY;

    ctx.save();

    // Full 1080x1920 Matte Slate Chassis
    ctx.fillStyle = HYBRID_BASE_COLORS.CHASSIS_BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle alignment grid lines
    ctx.strokeStyle = HYBRID_BASE_COLORS.GRID_HAIRLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, 32);
    ctx.lineTo(WIDTH / 2, HEIGHT - 32);
    ctx.stroke();

    // 3 Structural Zone Panels (Upper Analog, Center Digital, Lower Pendulum)
    const zones = [
      { rect: UPPER_ZONE_RECT, label: 'ZONE 01 // ANALOG REGULATOR' },
      { rect: DIGITAL_ZONE_RECT, label: 'ZONE 02 // DIGITAL CELL MATRIX' },
      { rect: LOWER_ZONE_RECT, label: 'ZONE 03 // HARMONIC PENDULUM' }
    ];

    for (const z of zones) {
      ctx.fillStyle = HYBRID_BASE_COLORS.ZONE_PANEL_BG;
      ctx.strokeStyle = HYBRID_BASE_COLORS.BORDER_STRUCTURAL;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(z.rect.x, z.rect.y, z.rect.width, z.rect.height, 14);
      ctx.fill();
      ctx.stroke();

      // Corner structural registration ticks
      ctx.font = '600 11px "JetBrains Mono", "Consolas", monospace';
      ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_MUTED;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(z.label, z.rect.x + 18, z.rect.y + 12);
    }

    ctx.restore();
  }

  private renderUpperAnalogDial(ctx: CanvasRenderingContext2D, tick: SynchronizedTimeTick): void {
    const cx = this.manifest.dial.center.x;
    const cy = this.manifest.dial.center.y;
    const outerR = HYBRID_BASE_GEOMETRY.DIAL_OUTER_RADIUS;
    const innerR = HYBRID_BASE_GEOMETRY.DIAL_INNER_RADIUS;

    ctx.save();

    // 1. Dial Outer Bezel & Recessed Face
    ctx.fillStyle = HYBRID_BASE_COLORS.DIAL_FACE;
    ctx.strokeStyle = HYBRID_BASE_COLORS.BORDER_HIGHLIGHT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner Chapter Ring Track
    ctx.strokeStyle = HYBRID_BASE_COLORS.DIAL_RING;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerR - 170, 0, Math.PI * 2);
    ctx.stroke();

    // 2. 60 Minute/Second Ticks & 12 Crisp Baton Indices
    for (let i = 0; i < 60; i++) {
      const angleRad = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const isQuarter = i % 15 === 0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad + Math.PI / 2);

      if (isHour) {
        const hourNum = i / 5 === 0 ? 12 : i / 5;
        if (hourNum === 12) {
          // Double baton index at 12 o'clock
          ctx.fillStyle = HYBRID_BASE_COLORS.INDEX_PRIMARY;
          ctx.fillRect(-9, -innerR, 6.5, 42);
          ctx.fillRect(2.5, -innerR, 6.5, 42);
        } else if (isQuarter) {
          // Bold cardinal baton index (3, 6, 9)
          ctx.fillStyle = HYBRID_BASE_COLORS.INDEX_PRIMARY;
          ctx.fillRect(-5, -innerR, 10, 40);
        } else {
          // Standard hour baton index
          ctx.fillStyle = HYBRID_BASE_COLORS.INDEX_PRIMARY;
          ctx.fillRect(-3.5, -innerR, 7, 30);
        }
      } else {
        // Crisp minute tick
        ctx.fillStyle = HYBRID_BASE_COLORS.INDEX_MINUTE;
        ctx.fillRect(-1, -innerR, 2, 12);
      }

      ctx.restore();
    }

    // 3. High-Contrast 12-Hour Numerals inside Baton Ring
    ctx.font = '700 24px "JetBrains Mono", "Consolas", sans-serif';
    ctx.fillStyle = HYBRID_BASE_COLORS.INDEX_SECONDARY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const numeralR = innerR - 64;
    for (let h = 1; h <= 12; h++) {
      const rad = ((h * 30 - 90) * Math.PI) / 180;
      const nx = cx + Math.cos(rad) * numeralR;
      const ny = cy + Math.sin(rad) * numeralR;
      ctx.fillText(String(h).padStart(2, '0'), nx, ny);
    }

    // Dial specification inscription (remains legible through skeletonized hands)
    ctx.font = '600 13px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_SECONDARY;
    ctx.fillText('HYBRID CHRONOGRAPH', cx, cy - 86);
    ctx.font = '500 11px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_MUTED;
    ctx.fillText(`SYNC LOCK // ${HYBRID_BASE_VERSION.toUpperCase()}`, cx, cy + 92);

    // 4. Skeletonized Hour Hand
    this.drawSkeletonizedHand(ctx, cx, cy, tick.angles.hour, {
      length: 196,
      tailLength: 38,
      baseWidth: 20,
      tipWidth: 12,
      cutoutStart: 28,
      cutoutEnd: 148,
      railThickness: 4
    });

    // 5. Skeletonized Minute Hand
    this.drawSkeletonizedHand(ctx, cx, cy, tick.angles.minute, {
      length: 288,
      tailLength: 48,
      baseWidth: 16,
      tipWidth: 9,
      cutoutStart: 32,
      cutoutEnd: 232,
      railThickness: 3.5
    });

    // 6. Tick-Stepping Second Hand
    this.drawSteppingSecondHand(ctx, cx, cy, tick.angles.second);

    // 7. Center Pinion Cap
    ctx.fillStyle = HYBRID_BASE_COLORS.HAND_CAP_OUTER;
    ctx.strokeStyle = HYBRID_BASE_COLORS.INDEX_PRIMARY;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = HYBRID_BASE_COLORS.HAND_CAP_INNER;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws a skeletonized (open-frame cutout) hand so underlying dial indices and labels remain legible.
   */
  private drawSkeletonizedHand(
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

    // Outer contour + inner cutout using even-odd fill rule
    ctx.beginPath();
    ctx.moveTo(-halfBase * 0.85, spec.tailLength);
    ctx.lineTo(-halfBase, 0);
    ctx.lineTo(-halfTip, -spec.cutoutEnd);
    ctx.lineTo(0, -spec.length);
    ctx.lineTo(halfTip, -spec.cutoutEnd);
    ctx.lineTo(halfBase, 0);
    ctx.lineTo(halfBase * 0.85, spec.tailLength);
    ctx.closePath();

    // Inner skeleton window cutout
    const innerBase = Math.max(2, halfBase - spec.railThickness);
    const innerTip = Math.max(1.5, halfTip - spec.railThickness);
    ctx.moveTo(-innerBase, -spec.cutoutStart);
    ctx.lineTo(innerBase, -spec.cutoutStart);
    ctx.lineTo(innerTip, -spec.cutoutEnd + 6);
    ctx.lineTo(-innerTip, -spec.cutoutEnd + 6);
    ctx.closePath();

    ctx.fillStyle = HYBRID_BASE_COLORS.HAND_HOUSING;
    ctx.fill('evenodd');

    ctx.strokeStyle = HYBRID_BASE_COLORS.HAND_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // High-contrast luminous pointer tip
    ctx.fillStyle = HYBRID_BASE_COLORS.CELL_GLYPH_ACCENT;
    ctx.beginPath();
    ctx.moveTo(-halfTip * 0.65, -spec.cutoutEnd - 4);
    ctx.lineTo(0, -spec.length + 3);
    ctx.lineTo(halfTip * 0.65, -spec.cutoutEnd - 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawSteppingSecondHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    ctx.strokeStyle = HYBRID_BASE_COLORS.HAND_SECOND;
    ctx.fillStyle = HYBRID_BASE_COLORS.HAND_SECOND;
    ctx.lineWidth = 2.5;

    // Tail shaft + open counterweight ring
    ctx.beginPath();
    ctx.moveTo(0, 68);
    ctx.lineTo(0, 44);
    ctx.moveTo(0, 22);
    ctx.lineTo(0, -312);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 33, 11, 0, Math.PI * 2);
    ctx.stroke();

    // Precision needle tip
    ctx.beginPath();
    ctx.moveTo(-3.5, -284);
    ctx.lineTo(0, -318);
    ctx.lineTo(3.5, -284);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Renders the Center Digital Module with 8 discrete character cells (`H`, `H`, `:`, `M`, `M`, `:`, `S`, `S`)
   * plus the secondary date / 12H-24H / AM-PM strip.
   */
  private renderCenterDigitalModule(
    ctx: CanvasRenderingContext2D,
    tick: SynchronizedTimeTick
  ): void {
    ctx.save();

    // 1. Render each of the 8 discrete character cell slots
    for (let i = 0; i < this.cellSlots.length; i++) {
      const slot = this.cellSlots[i];
      const cell = tick.cells[i];
      const isVisible = cell?.visible ?? true;

      // Individual cell bay housing
      ctx.fillStyle = HYBRID_BASE_COLORS.CELL_HOUSING_BG;
      ctx.strokeStyle = isVisible
        ? HYBRID_BASE_COLORS.CELL_BORDER_ACTIVE
        : HYBRID_BASE_COLORS.CELL_BORDER_STANDBY;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(slot.x, slot.y, slot.width, slot.height, 8);
      ctx.fill();
      ctx.stroke();

      // Subtle tube/cell socket alignment crossbars (blueprint for future Nixie cathode mesh)
      ctx.strokeStyle = HYBRID_BASE_COLORS.GRID_HAIRLINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(slot.x + 6, slot.y + slot.height / 2);
      ctx.lineTo(slot.x + slot.width - 6, slot.y + slot.height / 2);
      ctx.stroke();

      const centerX = slot.x + slot.width / 2;
      const centerY = slot.y + slot.height / 2;

      if (!slot.isSeparator) {
        // Subtle ghost figure '8' background inside digit cell
        ctx.font = '700 76px "JetBrains Mono", "Consolas", monospace';
        ctx.fillStyle = HYBRID_BASE_COLORS.CELL_GLYPH_GHOST;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('8', centerX, centerY + 3);
      }

      if (isVisible && cell) {
        if (slot.isSeparator) {
          // Colon separator dots
          ctx.fillStyle = HYBRID_BASE_COLORS.CELL_GLYPH_ACCENT;
          ctx.beginPath();
          ctx.arc(centerX, centerY - 20, 5.5, 0, Math.PI * 2);
          ctx.arc(centerX, centerY + 20, 5.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Active digit character
          const isSecondsCell = slot.role === 's1' || slot.role === 's2';
          ctx.font = '700 76px "JetBrains Mono", "Consolas", monospace';
          ctx.fillStyle = isSecondsCell
            ? HYBRID_BASE_COLORS.CELL_GLYPH_ACCENT
            : HYBRID_BASE_COLORS.CELL_GLYPH_ACTIVE;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(cell.char, centerX, centerY + 3);
        }
      }
    }

    // 2. Render Secondary Date & Format / Meridiem Sub-Strip
    const sub = HYBRID_BASE_GEOMETRY.SUBSTRIP_RECT;
    ctx.fillStyle = HYBRID_BASE_COLORS.SUBSTRIP_BG;
    ctx.strokeStyle = HYBRID_BASE_COLORS.BORDER_STRUCTURAL;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sub.x, sub.y, sub.width, sub.height, 6);
    ctx.fill();
    ctx.stroke();

    // Left: Date readout (when showDate is enabled)
    ctx.font = '700 20px "JetBrains Mono", "Consolas", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const subCenterY = sub.y + sub.height / 2;

    if (tick.options.showDate) {
      ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_PRIMARY;
      ctx.fillText(tick.formattedDate, sub.x + 20, subCenterY);
    } else {
      ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_MUTED;
      ctx.font = '600 14px "JetBrains Mono", "Consolas", monospace';
      ctx.fillText('DATE DISPLAY STANDBY', sub.x + 20, subCenterY);
    }

    // Center: Synchronized Cell Format Telemetry
    ctx.font = '600 13px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = HYBRID_BASE_COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'center';
    ctx.fillText(
      tick.options.showSeconds ? 'MODE // HH:MM:SS' : 'MODE // HH:MM',
      HYBRID_BASE_GEOMETRY.WIDTH / 2,
      subCenterY
    );

    // Right: 24H / 12H + AM / PM Indicator Pills
    this.drawIndicatorBadge(
      ctx,
      sub.x + sub.width - 236,
      sub.y + 8,
      64,
      32,
      tick.options.hourFormat.toUpperCase(),
      true
    );
    this.drawIndicatorBadge(
      ctx,
      sub.x + sub.width - 160,
      sub.y + 8,
      64,
      32,
      'AM',
      tick.showMeridiem && tick.meridiem === 'AM'
    );
    this.drawIndicatorBadge(
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

  private drawIndicatorBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    active: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = active ? HYBRID_BASE_COLORS.BADGE_ACTIVE_BG : 'transparent';
    ctx.strokeStyle = active
      ? HYBRID_BASE_COLORS.BADGE_ACTIVE_BORDER
      : HYBRID_BASE_COLORS.CELL_BORDER_STANDBY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 14px "JetBrains Mono", "Consolas", monospace';
    ctx.fillStyle = active ? HYBRID_BASE_COLORS.BADGE_ACTIVE_TEXT : HYBRID_BASE_COLORS.TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2 + 1);
    ctx.restore();
  }

  private drawPendulumScaleArc(
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

    ctx.strokeStyle = HYBRID_BASE_COLORS.BORDER_HIGHLIGHT;
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
        ? HYBRID_BASE_COLORS.HAND_SECOND
        : isMajor
          ? HYBRID_BASE_COLORS.INDEX_SECONDARY
          : HYBRID_BASE_COLORS.INDEX_MINUTE;
      ctx.lineWidth = isZero ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

