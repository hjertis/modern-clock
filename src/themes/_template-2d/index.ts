import { ClockMode, ThemeManifest } from '../../types/theme';
import {
  ClockTheme,
  ThemeConfig,
  ThemeEvent,
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

/**
 * Copy-Paste 2D Canvas Starter Template
 *
 * When copying to `src/themes/<your_theme>/index.ts`:
 * 1. Change `id` and `name` to unique values.
 * 2. Customize `drawDialPlate()`, `drawTelemetryPulseRing()`, and `drawHands()`.
 * 3. Register the theme in `src/themes/themeManager.ts`.
 */
export class Template2DTheme implements ClockTheme {
  public readonly id = 'template_2d';
  public readonly name = 'Template 2D Clock';
  public readonly renderer = '2d' as const;

  private ctx: CanvasRenderingContext2D | null = null;
  private width = STAGE_WIDTH;
  private height = STAGE_HEIGHT;
  private dialCenter: { x: number; y: number } = {
    x: DIAL_CENTER_BASELINE.x,
    y: DIAL_CENTER_BASELINE.y
  };
  private presenceMode: ClockMode = 'active';
  private manifest: ThemeManifest = createDefaultManifest('Template 2D Clock');

  // Reactive telemetry pulse intensities in [0, 1]
  private doorbellPulse = 0;
  private securityAlertPulse = 0;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getPresenceMode(): ClockMode {
    return this.presenceMode;
  }

  public init(config?: ThemeConfig, canvasContext?: CanvasRenderingContext2D): void {
    this.ctx = canvasContext ?? null;
    this.width = config?.width ?? STAGE_WIDTH;
    this.height = config?.height ?? STAGE_HEIGHT;
    this.manifest = config?.manifest
      ? structuredClone(config.manifest)
      : createDefaultManifest(this.name);
    this.dialCenter = { ...this.manifest.dial.center };
    this.doorbellPulse = 0;
    this.securityAlertPulse = 0;
  }

  public resize(width = STAGE_WIDTH, height = STAGE_HEIGHT): void {
    this.width = width;
    this.height = height;
  }

  public setPresenceMode(mode: ClockMode): void {
    this.presenceMode = mode;
  }

  public setDialCenter(x: number, y: number): void {
    this.dialCenter = { x, y };
    this.manifest.dial.center.x = x;
    this.manifest.dial.center.y = y;
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

  public update(timeState: TimeData, delta: number): void {
    const dt = Math.max(0, Math.min(1, delta));
    this.doorbellPulse = Math.max(0, this.doorbellPulse - dt * 0.75);
    this.securityAlertPulse = Math.max(0, this.securityAlertPulse - dt * 0.55);

    if (!this.ctx) return;
    const ctx = this.ctx;

    const isSleep = this.presenceMode === 'sleep';
    const isNight = this.presenceMode === 'night';

    // 1. Full 1080×1920 background with ±500 px bleed margins (never shifted by Dial Center)
    const bgColor = isSleep ? '#000000' : isNight ? '#04060a' : '#0b1018';
    drawStandard2DBackground(ctx, bgColor, this.width, this.height, BLEED_MARGIN_PX);

    // 2. Pre-wired dialGroup offset strictly from (540, 540) baseline
    const offset = dialCenterToPixelOffset(this.dialCenter.x, this.dialCenter.y);
    const cx = DIAL_CENTER_BASELINE.x + offset.dx;
    const cy = DIAL_CENTER_BASELINE.y + offset.dy;

    ctx.save();
    ctx.translate(cx, cy);

    if (!isSleep) {
      this.drawDialPlate(ctx, isNight);
      this.drawTelemetryPulseRing(ctx);
    }

    this.drawHands(ctx, timeState, isSleep, isNight);
    ctx.restore();
  }

  private drawDialPlate(ctx: CanvasRenderingContext2D, isNight: boolean): void {
    const radius = 400;
    ctx.save();
    ctx.globalAlpha = isNight ? 0.55 : 1.0;

    // Dial plate
    ctx.fillStyle = '#111927';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 12 hour indices
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      ctx.save();
      ctx.rotate(angle);
      ctx.fillStyle = i % 3 === 0 ? '#e2e8f0' : '#64748b';
      ctx.fillRect(-3, -radius + 18, 6, i % 3 === 0 ? 28 : 16);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawTelemetryPulseRing(ctx: CanvasRenderingContext2D): void {
    if (this.doorbellPulse > 0.01) {
      ctx.save();
      ctx.strokeStyle = `rgba(56, 248, 255, ${(this.doorbellPulse * 0.85).toFixed(3)})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, 418 + (1 - this.doorbellPulse) * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (this.securityAlertPulse > 0.01) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 59, 48, ${(this.securityAlertPulse * 0.9).toFixed(3)})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 0, 424 + (1 - this.securityAlertPulse) * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHands(
    ctx: CanvasRenderingContext2D,
    timeState: TimeData,
    isSleep: boolean,
    isNight: boolean
  ): void {
    const hourRad = (timeState.angles.hour * Math.PI) / 180;
    const minuteRad = (timeState.angles.minute * Math.PI) / 180;
    const secondRad = (timeState.angles.second * Math.PI) / 180;

    const handColor = isSleep ? '#993810' : isNight ? '#cc6b2c' : '#f8fafc';
    const secondColor = isSleep ? '#993810' : '#38bdf8';

    // Hour hand
    ctx.save();
    ctx.rotate(hourRad);
    ctx.fillStyle = handColor;
    ctx.fillRect(-8, -220, 16, 245);
    ctx.restore();

    // Minute hand
    ctx.save();
    ctx.rotate(minuteRad);
    ctx.fillStyle = handColor;
    ctx.fillRect(-5, -320, 10, 350);
    ctx.restore();

    // Second hand (hidden in Cat-Safe Sleep mode; sweep or tick otherwise)
    if (!isSleep) {
      ctx.save();
      ctx.rotate(secondRad);
      ctx.fillStyle = secondColor;
      ctx.fillRect(-2, -350, 4, 410);
      ctx.restore();
    }

    // Center hub cap
    ctx.fillStyle = isSleep ? '#66240a' : '#eab308';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  public dispose(): void {
    this.ctx = null;
  }
}
