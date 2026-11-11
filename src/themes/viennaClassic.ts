import { ThemeManifest } from '../types/theme';
import {
  Theme,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent
} from './types';

export const VIENNA_CLASSIC_MANIFEST: ThemeManifest = {
  name: 'Vienna Classic',
  version: '1.0.0',
  author: 'Maker',
  background: '/themes/default/assets/case_back.svg',
  dial: {
    image: '/themes/default/assets/dial.svg',
    center: { x: 540, y: 540 }
  },
  hands: {
    hour: {
      image: '/themes/default/assets/hand_hour.svg',
      pivot: { x: 20, y: 280 }
    },
    minute: {
      image: '/themes/default/assets/hand_minute.svg',
      pivot: { x: 16, y: 420 }
    },
    second: {
      image: '/themes/default/assets/hand_second.svg',
      pivot: { x: 8, y: 420 },
      mode: 'tick'
    },
    cap: {
      image: '/themes/default/assets/cap.svg',
      center: { x: 25, y: 25 }
    }
  },
  pendulum: {
    image: '/themes/default/assets/pendulum.svg',
    pivot: { x: 540, y: 820 },
    anchor: { x: 50, y: 20 },
    periodSeconds: 2.0,
    maxAngleDeg: 6.0
  },
  notificationZone: {
    x: 140,
    y: 1250,
    width: 800,
    height: 450
  }
};

interface LoadedAssets {
  bg: HTMLImageElement | null;
  dial: HTMLImageElement | null;
  handHour: HTMLImageElement | null;
  handMinute: HTMLImageElement | null;
  handSecond: HTMLImageElement | null;
  handCap: HTMLImageElement | null;
  pendulum: HTMLImageElement | null;
}

interface BrassPulse {
  startTimeMs: number;
  durationMs: number;
  color: string;
}

export class ViennaClassicTheme implements Theme {
  public readonly id = 'vienna_classic';
  public readonly name = 'Vienna Classic';

  private manifest: ThemeManifest = structuredClone(VIENNA_CLASSIC_MANIFEST);
  private assets: LoadedAssets = {
    bg: null,
    dial: null,
    handHour: null,
    handMinute: null,
    handSecond: null,
    handCap: null,
    pendulum: null
  };

  private isMounted = false;
  private backgroundDrawnForFrame = false;
  private activePulses: BrassPulse[] = [];

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public async mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): Promise<void> {
    this.isMounted = true;
    this.backgroundDrawnForFrame = false;
    this.activePulses = [];

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(VIENNA_CLASSIC_MANIFEST);
    }

    const [bg, dial, handHour, handMinute, handSecond, handCap, pendulum] = await Promise.all([
      this.loadImage(this.manifest.background),
      this.loadImage(this.manifest.dial.image),
      this.loadImage(this.manifest.hands.hour.image),
      this.loadImage(this.manifest.hands.minute.image),
      this.loadImage(this.manifest.hands.second.image),
      this.loadImage(this.manifest.hands.cap.image),
      this.loadImage(this.manifest.pendulum.image)
    ]);

    if (!this.isMounted) return;

    this.assets = {
      bg,
      dial,
      handHour,
      handMinute,
      handSecond,
      handCap,
      pendulum
    };
  }

  public renderPendulum(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted) return;

    // Draw background case first if this is the first pass of the frame
    if (!this.backgroundDrawnForFrame) {
      this.drawCaseBackground(ctx);
      this.backgroundDrawnForFrame = true;
    }

    const { pivot, anchor } = this.manifest.pendulum;
    const dialCenter = this.manifest.dial.center;

    ctx.save();

    // Clip out the upper dial aperture (r=444 around dialCenter) so the pendulum rod
    // top hinge at (540, 820) sits naturally behind the dial regardless of method call order
    ctx.beginPath();
    ctx.rect(0, 0, 1080, 1920);
    ctx.arc(dialCenter.x, dialCenter.y, 444, 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    if (physicsData.dimmed) {
      ctx.globalAlpha = 0.2;
    }

    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(physicsData.angleRad);
    ctx.translate(-anchor.x, -anchor.y);

    if (this.assets.pendulum && this.assets.pendulum.complete && this.assets.pendulum.naturalWidth > 0) {
      ctx.drawImage(this.assets.pendulum, 0, 0, 100, 800);
    } else {
      this.drawFallbackPendulum(ctx);
    }

    ctx.restore();
  }

  public renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted) return;

    if (!this.backgroundDrawnForFrame) {
      this.drawCaseBackground(ctx);
      this.backgroundDrawnForFrame = true;
    }

    const { dial, hands } = this.manifest;
    const cx = dial.center.x;
    const cy = dial.center.y;

    // 1. Draw Dial Face
    ctx.save();
    if (this.assets.dial && this.assets.dial.complete && this.assets.dial.naturalWidth > 0) {
      const dialW = this.assets.dial.naturalWidth || 900;
      const dialH = this.assets.dial.naturalHeight || 900;
      ctx.drawImage(this.assets.dial, cx - dialW / 2, cy - dialH / 2, dialW, dialH);
    } else {
      this.drawFallbackDial(ctx, cx, cy);
    }
    ctx.restore();

    // 2. Draw Hour Hand
    this.drawRotatedHand(
      ctx,
      this.assets.handHour,
      cx,
      cy,
      hands.hour.pivot.x,
      hands.hour.pivot.y,
      timeData.angles.hour,
      'hour'
    );

    // 3. Draw Minute Hand
    this.drawRotatedHand(
      ctx,
      this.assets.handMinute,
      cx,
      cy,
      hands.minute.pivot.x,
      hands.minute.pivot.y,
      timeData.angles.minute,
      'minute'
    );

    // 4. Draw Second Hand
    this.drawRotatedHand(
      ctx,
      this.assets.handSecond,
      cx,
      cy,
      hands.second.pivot.x,
      hands.second.pivot.y,
      timeData.angles.second,
      'second'
    );

    // 5. Draw Center Pinion Cap
    ctx.save();
    if (this.assets.handCap && this.assets.handCap.complete && this.assets.handCap.naturalWidth > 0) {
      ctx.drawImage(
        this.assets.handCap,
        cx - hands.cap.center.x,
        cy - hands.cap.center.y,
        this.assets.handCap.naturalWidth || 50,
        this.assets.handCap.naturalHeight || 50
      );
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#c69a41';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3b2607';
      ctx.stroke();
    }
    ctx.restore();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    // Reset per-frame background flag at the end of the frame's overlay pass
    this.backgroundDrawnForFrame = false;

    const now = performance.now();
    this.activePulses = this.activePulses.filter((p) => now - p.startTimeMs < p.durationMs);

    // Render reactive warm brass resonance rings on notifications/alerts
    if (this.activePulses.length > 0) {
      const cx = this.manifest.dial.center.x;
      const cy = this.manifest.dial.center.y;

      ctx.save();
      for (const pulse of this.activePulses) {
        const progress = (now - pulse.startTimeMs) / pulse.durationMs;
        const alpha = Math.max(0, (1 - progress) * 0.55);
        const radius = 435 + progress * 45;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = pulse.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 4 * (1 - progress * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Subtle engraved brass plaque at bottom pedestal showing live status
    ctx.save();
    ctx.fillStyle = 'rgba(20, 12, 7, 0.72)';
    ctx.strokeStyle = 'rgba(212, 170, 85, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(350, 1842, 380, 36, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "Georgia", "Times New Roman", serif';
    ctx.fillStyle = '#e5c178';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wsLabel = telemetryData.wsStatus === 'connected' ? 'SYNCHRONIZED' : 'AUTONOMOUS';
    ctx.fillText(
      `VIENNA REGULATOR  •  ${wsLabel}  •  ${telemetryData.fps.toFixed(0)} FPS`,
      540,
      1860
    );
    ctx.restore();
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;
    if (event.type === 'notification' || event.type === 'priority_alert' || event.type === 'mqtt_pulse') {
      const isUrgent = event.priority === 'urgent' || event.category === 'alert';
      this.activePulses.push({
        startTimeMs: performance.now(),
        durationMs: 1400,
        color: isUrgent ? '#ff5e4d' : '#f5d47a'
      });
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.backgroundDrawnForFrame = false;
    this.activePulses = [];
    this.assets = {
      bg: null,
      dial: null,
      handHour: null,
      handMinute: null,
      handSecond: null,
      handCap: null,
      pendulum: null
    };
  }

  private drawCaseBackground(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.assets.bg && this.assets.bg.complete && this.assets.bg.naturalWidth > 0) {
      ctx.drawImage(this.assets.bg, 0, 0, 1080, 1920);
    } else {
      // Procedural mahogany & brass fallback while SVG decodes
      const grad = ctx.createLinearGradient(0, 0, 1080, 0);
      grad.addColorStop(0, '#140b07');
      grad.addColorStop(0.5, '#4d2b1d');
      grad.addColorStop(1, '#140b07');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1080, 1920);

      // Trunk chamber
      ctx.fillStyle = '#120906';
      ctx.fillRect(130, 1030, 820, 740);
      ctx.strokeStyle = '#c59f4e';
      ctx.lineWidth = 5;
      ctx.strokeRect(120, 1020, 840, 760);
    }
    ctx.restore();
  }

  private drawFallbackDial(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    // Brass bezel
    ctx.beginPath();
    ctx.arc(cx, cy, 446, 0, Math.PI * 2);
    ctx.fillStyle = '#b88c38';
    ctx.fill();

    // Enamel face
    ctx.beginPath();
    ctx.arc(cx, cy, 420, 0, Math.PI * 2);
    ctx.fillStyle = '#faf5e8';
    ctx.fill();
    ctx.restore();
  }

  private drawFallbackPendulum(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#c59f4e';
    ctx.fillRect(46, 20, 8, 650);
    ctx.beginPath();
    ctx.arc(50, 670, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRotatedHand(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | null,
    cx: number,
    cy: number,
    pivotX: number,
    pivotY: number,
    angleDeg: number,
    handType: 'hour' | 'minute' | 'second'
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -pivotX, -pivotY);
    } else {
      // Immediate fallback hand geometry
      if (handType === 'hour') {
        ctx.fillStyle = '#1e3458';
        ctx.fillRect(-5, -240, 10, 290);
      } else if (handType === 'minute') {
        ctx.fillStyle = '#182e4e';
        ctx.fillRect(-4, -390, 8, 450);
      } else {
        ctx.fillStyle = '#dd2424';
        ctx.fillRect(-1.5, -400, 3, 480);
      }
    }
    ctx.restore();
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`[ViennaClassicTheme] Failed to load asset: ${url}`);
        resolve(null);
      };
      img.src = url;
    });
  }
}

