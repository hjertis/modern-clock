import { Point2D } from '../../types/theme';
import { TelemetryData, ThemeEvent } from '../types';
import {
  PCB_COLORS,
  PCB_GEOMETRY,
  LEFT_LATERAL_BUS_PATHS,
  RIGHT_LATERAL_BUS_PATHS,
  EMERALD_LOWER_LEFT_BUS_PATHS,
  EMERALD_LOWER_RIGHT_BUS_PATHS,
  PcbThemeVariant
} from './constants';

function drawAnnularVia(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerRadius: number,
  holeRadius: number
): void {
  ctx.beginPath();
  ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
  ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, holeRadius, 0, Math.PI * 2);
  ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
  ctx.fill();
}

interface ElectronPacket {
  path: Point2D[];
  segmentLengths: number[];
  totalLength: number;
  startTimeMs: number;
  durationMs: number;
  isUrgent: boolean;
  tailLengthPx: number;
}

export class PcbHudOverlay {
  private packets: ElectronPacket[] = [];
  private rxEventCount = 0;
  private lastSurgeTimeMs = -10000;
  private phaseHistory: number[] = [];
  private readonly variant: PcbThemeVariant;

  constructor(variant: PcbThemeVariant = 'standard') {
    this.variant = variant;
  }

  public onEvent(event: ThemeEvent): void {
    if (
      event.type === 'notification' ||
      event.type === 'mqtt_pulse' ||
      event.type === 'priority_alert'
    ) {
      this.rxEventCount++;
      const isUrgent = event.priority === 'urgent' || event.category === 'alert';
      this.spawnElectronPacketWave(isUrgent);
    }
  }

  /**
   * Spawns high-speed "electron" packets racing up both left and right
   * 45-degree lateral trace buses toward the upper dial chamber.
   */
  public spawnElectronPacketWave(isUrgent = false): void {
    const now = performance.now();
    const allBuses = [...LEFT_LATERAL_BUS_PATHS, ...RIGHT_LATERAL_BUS_PATHS];

    // Spawn 3 staggered waves along all 8 lateral buses (24 high-speed electron packets)
    for (let wave = 0; wave < 3; wave++) {
      allBuses.forEach((path, busIdx) => {
        const { segmentLengths, totalLength } = this.computePathMetrics(path);
        const staggerMs = wave * 135 + (busIdx % 4) * 28;
        const speedDurationMs = isUrgent ? 520 : 640;

        this.packets.push({
          path,
          segmentLengths,
          totalLength,
          startTimeMs: now + staggerMs,
          durationMs: speedDurationMs,
          isUrgent,
          tailLengthPx: 95
        });
      });
    }

    // In emerald variant, also fire electron packets from the bottom PCIe gold edge fingers up into the wafer bezel
    if (this.variant === 'emerald') {
      const lowerEdgeBuses = [
        ...EMERALD_LOWER_LEFT_BUS_PATHS,
        ...EMERALD_LOWER_RIGHT_BUS_PATHS
      ].map((p) => [...p].reverse());

      for (let wave = 0; wave < 2; wave++) {
        lowerEdgeBuses.forEach((path, idx) => {
          if (idx % 2 !== 0) return;
          const { segmentLengths, totalLength } = this.computePathMetrics(path);
          this.packets.push({
            path,
            segmentLengths,
            totalLength,
            startTimeMs: now + wave * 150 + (idx % 8) * 22,
            durationMs: isUrgent ? 460 : 560,
            isUrgent,
            tailLengthPx: 80
          });
        });
      }
    }

    // Trigger dial ring surge when the leading wave reaches the dial
    this.lastSurgeTimeMs = now + 500;
  }


  public getDialSurgeIntensity(): number {
    const now = performance.now();
    const elapsed = now - this.lastSurgeTimeMs;
    if (elapsed < 0 || elapsed > 900) return 0;
    return Math.sin((elapsed / 900) * Math.PI);
  }

  public render(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (telemetryData.isSleeping) {
      this.packets = [];
      return;
    }

    const now = performance.now();

    // Update rolling pendulum phase history for mini oscilloscope readout
    this.phaseHistory.push(telemetryData.pendulumAngleDeg);
    if (this.phaseHistory.length > 64) {
      this.phaseHistory.shift();
    }

    // 1. Render active high-speed electron packets along lateral trace buses
    this.renderElectronPackets(ctx, now);

    // 2. Render Left Telemetry Panel: Backend Daemon Connection (/ws)
    this.renderDaemonTelemetryPanel(ctx, telemetryData);

    // 3. Render Right Telemetry Panel: Pendulum Phase, Harmonic Waveform & FPS
    this.renderOscillatorTelemetryPanel(ctx, telemetryData);

    // 4. Optional calibration / debug technical grid when enabled
    if (telemetryData.showDebugGrid) {
      this.renderTechnicalDebugGrid(ctx, telemetryData);
    }
  }

  public destroy(): void {
    this.packets = [];
    this.phaseHistory = [];
  }

  private renderElectronPackets(ctx: CanvasRenderingContext2D, now: number): void {
    // Prune completed packets
    this.packets = this.packets.filter((pkt) => now < pkt.startTimeMs + pkt.durationMs);
    if (this.packets.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const pkt of this.packets) {
      if (now < pkt.startTimeMs) continue;

      const progress = Math.min(1, (now - pkt.startTimeMs) / pkt.durationMs);
      const headDist = progress * pkt.totalLength;
      const tailDist = Math.max(0, headDist - pkt.tailLengthPx);

      const headPt = this.samplePathAtDistance(pkt.path, pkt.segmentLengths, headDist);
      const midPt = this.samplePathAtDistance(
        pkt.path,
        pkt.segmentLengths,
        (headDist + tailDist) * 0.5
      );
      const tailPt = this.samplePathAtDistance(pkt.path, pkt.segmentLengths, tailDist);

      const primaryColor = pkt.isUrgent ? PCB_COLORS.CRIMSON_ALERT : PCB_COLORS.ENIG_GOLD;
      const coreColor = pkt.isUrgent ? '#ff9f94' : PCB_COLORS.VECTOR_CORE;

      // Glowing comet tail along trace
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tailPt.x, tailPt.y);
      ctx.lineTo(midPt.x, midPt.y);
      ctx.lineTo(headPt.x, headPt.y);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 4.2;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.85 * (1 - progress * 0.25);
      ctx.stroke();

      // White-hot electron packet head
      ctx.beginPath();
      ctx.arc(headPt.x, headPt.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = coreColor;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private renderDaemonTelemetryPanel(
    ctx: CanvasRenderingContext2D,
    telemetry: TelemetryData
  ): void {
    const x = 172;
    const y = 1044;
    const w = 292;
    const h = 114;

    ctx.save();

    // Translucent PCB HUD module enclosure with 45-degree chamfered corner
    this.drawHudModuleBox(ctx, x, y, w, h, 'U_NET // DAEMON_TELEMETRY');

    // Clean display endpoint (e.g. host:8088/ws)
    const cleanEndpoint = (telemetry.wsUrl || 'ws').replace(/^wss?:\/\//, '');

    // Status LED SMD Indicator Pad
    let ledColor: string = PCB_COLORS.ENIG_GOLD;
    let statusLabel = 'STANDBY';
    if (telemetry.wsStatus === 'connected') {
      ledColor = PCB_COLORS.STATUS_OK;
      statusLabel = 'ONLINE // LINK_UP';
    } else if (telemetry.wsStatus === 'connecting' || telemetry.wsStatus === 'reconnecting') {
      ledColor = PCB_COLORS.STATUS_WARN;
      statusLabel = 'SYN_WAIT // RETRY';
    } else {
      ledColor = PCB_COLORS.CRIMSON_ALERT;
      statusLabel = 'LOCAL_AUTONOMOUS';
    }

    // SMD LED Footprint
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x + 20, y + 40, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'left';
    ctx.fillText(cleanEndpoint, x + 34, y + 44);

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fillText(`STATE : ${statusLabel}`, x + 16, y + 66);

    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText(
      `BUS_RX: ${String(this.rxEventCount).padStart(4, '0')} PKTS   ALERTS: ${telemetry.activeNotificationsCount}`,
      x + 16,
      y + 85
    );

    const utcIso = telemetry.currentDate.toISOString().substring(11, 23);
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_MUTED;
    ctx.fillText(`CLK_UTC: ${utcIso}Z`, x + 16, y + 103);

    ctx.restore();
  }

  private renderOscillatorTelemetryPanel(
    ctx: CanvasRenderingContext2D,
    telemetry: TelemetryData
  ): void {
    const x = 616;
    const y = 1044;
    const w = 292;
    const h = 114;

    ctx.save();
    this.drawHudModuleBox(ctx, x, y, w, h, 'U_OSC // HARMONIC_READOUT');

    const sign = telemetry.pendulumAngleDeg >= 0 ? '+' : '';
    const angleStr = `${sign}${telemetry.pendulumAngleDeg.toFixed(2)}°`;
    const phaseStr = `${telemetry.pendulumPhaseDeg.toFixed(0).padStart(3, '0')}°`;
    const fpsStr = `${telemetry.fps.toFixed(1)} FPS`;
    const msStr = `${telemetry.frameTimeMs.toFixed(1)}ms`;

    ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText(`SWING θ: ${angleStr}   PHASE φ: ${phaseStr}`, x + 16, y + 44);

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText(`RENDER : ${fpsStr} (${msStr})`, x + 16, y + 65);
    ctx.fillText(
      `ESCAPE : ${telemetry.secondMode.toUpperCase()}_MODE  •  T=${telemetry.pendulumPeriodSec.toFixed(1)}s`,
      x + 16,
      y + 84
    );

    // Mini real-time Vector Oscilloscope trace showing θ(t) harmonic wave
    const scopeX = x + 16;
    const scopeY = y + 92;
    const scopeW = w - 32;
    const scopeH = 14;

    ctx.strokeStyle = 'rgba(200, 150, 62, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(scopeX, scopeY, scopeW, scopeH);

    if (this.phaseHistory.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < this.phaseHistory.length; i++) {
        const px = scopeX + (i / 63) * scopeW;
        const normY = this.phaseHistory[i] / 6.5; // [-1, 1]
        const py = scopeY + scopeH / 2 - normY * (scopeH * 0.42);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawHudModuleBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string
  ): void {
    const cham = 12;
    ctx.beginPath();
    ctx.moveTo(x + cham, y);
    ctx.lineTo(x + w - cham, y);
    ctx.lineTo(x + w, y + cham);
    ctx.lineTo(x + w, y + h - cham);
    ctx.lineTo(x + w - cham, y + h);
    ctx.lineTo(x + cham, y + h);
    ctx.lineTo(x, y + h - cham);
    ctx.lineTo(x, y + cham);
    ctx.closePath();

    ctx.fillStyle =
      this.variant === 'emerald' ? 'rgba(6, 20, 14, 0.88)' : 'rgba(10, 12, 17, 0.86)';
    ctx.fill();

    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Header bar
    ctx.fillStyle = 'rgba(200, 150, 62, 0.16)';
    ctx.fillRect(x + 2, y + 2, w - 4, 20);

    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText(title, x + 14, y + 16);

    drawAnnularVia(ctx, x + w - 14, y + 12, 3.2, 1.4);
  }

  private renderTechnicalDebugGrid(
    ctx: CanvasRenderingContext2D,
    _telemetry: TelemetryData
  ): void {
    const { DIAL_CENTER, PENDULUM_PIVOT } = PCB_GEOMETRY;
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 196, 98, 0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);

    ctx.beginPath();
    ctx.moveTo(DIAL_CENTER.x, 40);
    ctx.lineTo(DIAL_CENTER.x, 1880);
    ctx.moveTo(40, DIAL_CENTER.y);
    ctx.lineTo(1040, DIAL_CENTER.y);
    ctx.moveTo(40, PENDULUM_PIVOT.y);
    ctx.lineTo(1040, PENDULUM_PIVOT.y);
    ctx.stroke();

    ctx.restore();
  }

  private computePathMetrics(path: Point2D[]): {
    segmentLengths: number[];
    totalLength: number;
  } {
    const segmentLengths: number[] = [];
    let totalLength = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const dx = path[i + 1].x - path[i].x;
      const dy = path[i + 1].y - path[i].y;
      const len = Math.hypot(dx, dy);
      segmentLengths.push(len);
      totalLength += len;
    }
    return { segmentLengths, totalLength };
  }

  private samplePathAtDistance(
    path: Point2D[],
    segmentLengths: number[],
    dist: number
  ): Point2D {
    let remaining = Math.max(0, dist);
    for (let i = 0; i < segmentLengths.length; i++) {
      const segLen = segmentLengths[i];
      if (remaining <= segLen || i === segmentLengths.length - 1) {
        const t = segLen > 0 ? Math.min(1, remaining / segLen) : 0;
        return {
          x: path[i].x + (path[i + 1].x - path[i].x) * t,
          y: path[i].y + (path[i + 1].y - path[i].y) * t
        };
      }
      remaining -= segLen;
    }
    return path[path.length - 1];
  }
}

