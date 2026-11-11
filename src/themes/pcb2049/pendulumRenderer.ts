import { PhysicsData } from '../types';
import { PCB_COLORS, PCB_GEOMETRY } from './constants';
import { drawAnnularVia } from './substrate';
import { WaferShaderRenderer } from './waferShader';

export class PcbPendulumRenderer {
  private waferShader: WaferShaderRenderer;

  constructor() {
    this.waferShader = new WaferShaderRenderer();
  }

  public init(): void {
    this.waferShader.init();
  }

  public render(ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    const pivotX = physicsData.pivot?.x ?? PCB_GEOMETRY.PENDULUM_PIVOT.x;
    const pivotY = physicsData.pivot?.y ?? PCB_GEOMETRY.PENDULUM_PIVOT.y;
    const bobDist = PCB_GEOMETRY.PENDULUM_LENGTH; // 470px
    const waferR = PCB_GEOMETRY.WAFER_RADIUS; // 114px

    ctx.save();

    // Clip to lower chamber area below the ZIF mezzanine bridge so top of ribbon inserts cleanly
    ctx.beginPath();
    ctx.rect(120, pivotY - 4, 840, 820);
    ctx.clip();

    if (physicsData.dimmed) {
      ctx.globalAlpha = 0.22;
    }

    ctx.translate(pivotX, pivotY);
    ctx.rotate(physicsData.angleRad);

    // Subtle dynamic flex curvature offset in middle of polyimide ribbon cable
    const flexBowX = Math.sin(physicsData.angleRad * 4.0) * 6.5;

    // 1. Draw Flexible Polyimide Ribbon Cable (FPC) with 8 parallel copper/gold traces
    this.drawPolyimideRibbonCable(ctx, bobDist - waferR + 14, flexBowX, physicsData.timeSec);

    // 2. Draw Monocrystalline Silicon Wafer Bob with WebGL Specular/Diffraction Shader Pass
    this.drawSiliconWaferBob(ctx, 0, bobDist, waferR, physicsData);

    // 3. Draw Bottom Laser Index Needle & Vernier Pointer sweeping over the beat scale
    this.drawCalibrationPointer(ctx, 0, bobDist + waferR);

    ctx.restore();
  }

  public destroy(): void {
    this.waferShader.destroy();
  }

  private drawPolyimideRibbonCable(
    ctx: CanvasRenderingContext2D,
    ribbonLen: number,
    flexBowX: number,
    timeSec: number
  ): void {
    const ribbonW = 52;
    const halfW = ribbonW / 2;

    ctx.save();

    // Drop shadow behind flexible ribbon cable
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 8;

    // Translucent Kapton / Polyimide amber ribbon body with subtle quadratic flex curve
    const ribGrad = ctx.createLinearGradient(-halfW, 0, halfW, 0);
    ribGrad.addColorStop(0, '#4f2807');
    ribGrad.addColorStop(0.2, '#7d430e');
    ribGrad.addColorStop(0.5, '#9e5715');
    ribGrad.addColorStop(0.8, '#7d430e');
    ribGrad.addColorStop(1, '#4f2807');

    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    ctx.quadraticCurveTo(-halfW + flexBowX, ribbonLen * 0.5, -halfW, ribbonLen);
    ctx.lineTo(halfW, ribbonLen);
    ctx.quadraticCurveTo(halfW + flexBowX, ribbonLen * 0.5, halfW, 0);
    ctx.closePath();

    ctx.fillStyle = ribGrad;
    ctx.fill();

    // Reset shadow for crisp internal trace rendering
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Polyimide outer amber edge border
    ctx.strokeStyle = PCB_COLORS.POLYIMIDE_EDGE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Horizontal flex-relief stiffener ribs & sprocket holes along ribbon edges
    ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
    for (let y = 24; y < ribbonLen - 20; y += 28) {
      const t = y / ribbonLen;
      const curveOffset = 4 * t * (1 - t) * flexBowX;
      // Left & right FPC alignment sprocket perforations
      ctx.fillRect(-halfW + 3 + curveOffset, y - 3, 3.5, 6);
      ctx.fillRect(halfW - 6.5 + curveOffset, y - 3, 3.5, 6);
    }

    // 8 Parallel Etched Copper & Immersion Gold Signal Traces running down the FPC ribbon
    const numTraces = 8;
    const traceSpan = 32;
    const spacing = traceSpan / (numTraces - 1);

    for (let i = 0; i < numTraces; i++) {
      const xOffset = -traceSpan / 2 + i * spacing;
      const isGold = i === 0 || i === 3 || i === 4 || i === 7;

      ctx.beginPath();
      ctx.moveTo(xOffset, 0);
      ctx.quadraticCurveTo(xOffset + flexBowX, ribbonLen * 0.5, xOffset, ribbonLen);
      ctx.strokeStyle = isGold ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.AGED_COPPER;
      ctx.lineWidth = isGold ? 2.1 : 1.6;
      ctx.stroke();

      // Animated synchronous clock pulse packet travelling down each trace
      const pulsePhase = (timeSec * 1.5 + i * 0.14) % 1.0;
      const py = pulsePhase * ribbonLen;
      const pt = py / ribbonLen;
      const px = xOffset + 4 * pt * (1 - pt) * flexBowX;

      ctx.beginPath();
      ctx.arc(px, py, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = PCB_COLORS.ENIG_BRIGHT;
      ctx.fill();
    }

    // Silkscreen flex cable markings on polyimide surface
    ctx.save();
    ctx.translate(flexBowX * 0.5, ribbonLen * 0.45);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 235, 190, 0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('FPC-2049 // POLYIMIDE 8-LANE BUS', 0, -18);
    ctx.restore();

    // Top ZIF Stiffener Collar & Bottom Probe Card Bracket
    ctx.fillStyle = '#12161f';
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.6;
    ctx.fillRect(-halfW - 4, 0, ribbonW + 8, 16);
    ctx.strokeRect(-halfW - 4, 0, ribbonW + 8, 16);

    // Bottom FPC-to-Wafer Probe Head Collar
    ctx.fillRect(-halfW - 8, ribbonLen - 18, ribbonW + 16, 22);
    ctx.strokeRect(-halfW - 8, ribbonLen - 18, ribbonW + 16, 22);

    for (let i = -2; i <= 2; i++) {
      drawAnnularVia(ctx, i * 11, ribbonLen - 7, 3.0, 1.3);
    }

    ctx.restore();
  }

  private drawSiliconWaferBob(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    waferR: number,
    physicsData: PhysicsData
  ): void {
    ctx.save();
    ctx.translate(bx, by);

    // 1. Deep 3D drop shadow under silicon wafer carrier
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 14;
    ctx.beginPath();
    ctx.arc(0, 0, waferR + 8, 0, Math.PI * 2);
    ctx.fillStyle = '#090c12';
    ctx.fill();
    ctx.restore();

    // 2. Outer CNC Silicon-Carbide / Copper Carrier Bezel Ring
    ctx.beginPath();
    ctx.arc(0, 0, waferR + 8, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, waferR + 3, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 3. Render WebGL Specular / Diffraction Shader Pass for Monocrystalline Silicon Wafer
    const waferCanvas = this.waferShader.render(
      physicsData.angleRad,
      physicsData.angularVelocityNorm,
      physicsData.timeSec
    );
    ctx.drawImage(waferCanvas, -waferR, -waferR, waferR * 2, waferR * 2);

    // 4. Fine Photolithography Die Grid Overlay & Reticle Crosshair on Wafer Surface
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, waferR - 5, 0, Math.PI * 2);
    ctx.clip();

    // Crisp micro-scribe lines accenting the shader die boundaries
    const dieStep = (waferR * 2) / 11;
    ctx.strokeStyle = 'rgba(244, 196, 98, 0.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = -waferR; x <= waferR; x += dieStep) {
      ctx.moveTo(x, -waferR);
      ctx.lineTo(x, waferR);
    }
    for (let y = -waferR; y <= waferR; y += dieStep) {
      ctx.moveTo(-waferR, y);
      ctx.lineTo(waferR, y);
    }
    ctx.stroke();

    // Central laser-etched wafer alignment reticle
    ctx.strokeStyle = 'rgba(244, 196, 98, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.moveTo(-26, 0);
    ctx.lineTo(26, 0);
    ctx.moveTo(0, -26);
    ctx.lineTo(0, 26);
    ctx.stroke();
    ctx.restore();

    // 5. Three Gold Kinematic Wafer Retention Clamps at -60°, +60°, 180°
    for (const deg of [-55, 55, 135, 225]) {
      const rad = ((deg - 90) * Math.PI) / 180;
      ctx.save();
      ctx.rotate(rad);
      ctx.fillStyle = '#12161f';
      ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
      ctx.lineWidth = 1.5;
      ctx.fillRect(-7, -waferR - 10, 14, 16);
      ctx.strokeRect(-7, -waferR - 10, 14, 16);
      drawAnnularVia(ctx, 0, -waferR - 3, 3.2, 1.4);
      ctx.restore();
    }

    // 6. Wafer Lot Silkscreen ID on Top Probe Header
    ctx.fillStyle = '#0d1017';
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.4;
    ctx.fillRect(-52, -waferR - 10, 104, 18);
    ctx.strokeRect(-52, -waferR - 10, 104, 18);

    ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SI-100 // DIE_ARRAY', 0, -waferR - 1);

    ctx.restore();
  }

  private drawCalibrationPointer(ctx: CanvasRenderingContext2D, x: number, topY: number): void {
    ctx.save();
    ctx.translate(x, topY);

    // Precision gold micrometer vernier nut & laser pointer tip
    ctx.fillStyle = '#12161f';
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.6;
    ctx.fillRect(-14, 4, 28, 14);
    ctx.strokeRect(-14, 4, 28, 14);

    // Laser-etched cantilever pointer spike reaching the optical beat scale
    ctx.beginPath();
    ctx.moveTo(-4, 18);
    ctx.lineTo(4, 18);
    ctx.lineTo(0, 58);
    ctx.closePath();
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fill();

    // Glowing optical interferometer tip pip
    ctx.beginPath();
    ctx.arc(0, 58, 3, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.shadowColor = PCB_COLORS.VECTOR_AMBER;
    ctx.shadowBlur = 10;
    ctx.fill();

    ctx.restore();
  }
}

