import { ThemeManifest } from '../../types/theme';
import {
  Theme,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent
} from '../types';
import { PCB_2049_MANIFEST } from './constants';
import { createSubstrateCanvas } from './substrate';
import { PcbDialRenderer } from './dialRenderer';
import { PcbPendulumRenderer } from './pendulumRenderer';
import { PcbHudOverlay } from './hudOverlay';

export class Pcb2049Theme implements Theme {
  public readonly id = 'pcb_2049';
  public readonly name = 'PCB-2049 / Industrial Silicon';

  private manifest: ThemeManifest = structuredClone(PCB_2049_MANIFEST);
  private substrateCanvas: HTMLCanvasElement | null = null;
  private dialRenderer: PcbDialRenderer;
  private pendulumRenderer: PcbPendulumRenderer;
  private hudOverlay: PcbHudOverlay;

  private isMounted = false;
  private substrateDrawnForFrame = false;

  constructor() {
    this.dialRenderer = new PcbDialRenderer();
    this.pendulumRenderer = new PcbPendulumRenderer();
    this.hudOverlay = new PcbHudOverlay();
  }

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): void {
    this.isMounted = true;
    this.substrateDrawnForFrame = false;

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(PCB_2049_MANIFEST);
    }

    // 1. Pre-render FR-4 substrate, 45-deg copper/ENIG trace buses, and silkscreen markings
    this.substrateCanvas = createSubstrateCanvas();

    // 2. Initialize Upper Chamber Dial & SMD/Passive footprints
    this.dialRenderer.init();

    // 3. Initialize Lower Chamber Wafer Pendulum & WebGL diffraction shader
    this.pendulumRenderer.init();

    // 4. Fire an initial power-on electron bus pulse
    this.hudOverlay.spawnElectronPacketWave(false);
  }

  public renderPendulum(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted) return;

    if (!this.substrateDrawnForFrame) {
      this.drawSubstrate(ctx);
      this.substrateDrawnForFrame = true;
    }

    const effectivePhysics: PhysicsData = {
      ...physicsData,
      pivot: this.manifest.pendulum.pivot
    };

    this.pendulumRenderer.render(ctx, effectivePhysics);
  }

  public renderDial(ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted) return;

    if (!this.substrateDrawnForFrame) {
      this.drawSubstrate(ctx);
      this.substrateDrawnForFrame = true;
    }

    const surgeIntensity = this.hudOverlay.getDialSurgeIntensity();
    this.dialRenderer.render(ctx, timeData, this.manifest.dial.center, surgeIntensity);
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    // Reset per-frame flag at end of render cycle
    this.substrateDrawnForFrame = false;

    this.hudOverlay.render(ctx, telemetryData);
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;
    this.hudOverlay.onEvent(event);
  }

  public destroy(): void {
    this.isMounted = false;
    this.substrateDrawnForFrame = false;
    this.substrateCanvas = null;
    this.pendulumRenderer.destroy();
    this.hudOverlay.destroy();
  }

  private drawSubstrate(ctx: CanvasRenderingContext2D): void {
    if (this.substrateCanvas) {
      ctx.drawImage(this.substrateCanvas, 0, 0);
    } else {
      ctx.fillStyle = '#0c0e12';
      ctx.fillRect(0, 0, 1080, 1920);
    }
  }
}

