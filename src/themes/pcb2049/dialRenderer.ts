import { Point2D } from '../../types/theme';
import { TimeData } from '../types';
import { PCB_COLORS, PCB_GEOMETRY } from './constants';
import { drawAnnularVia } from './substrate';

const DIAL_CANVAS_SIZE = 920;
const DIAL_HALF = DIAL_CANVAS_SIZE / 2;

export class PcbDialRenderer {
  private staticDialCanvas: HTMLCanvasElement;

  constructor() {
    this.staticDialCanvas = document.createElement('canvas');
    this.staticDialCanvas.width = DIAL_CANVAS_SIZE;
    this.staticDialCanvas.height = DIAL_CANVAS_SIZE;
  }

  public init(): void {
    const ctx = this.staticDialCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, DIAL_CANVAS_SIZE, DIAL_CANVAS_SIZE);
    this.drawStaticDialSubstrate(ctx, DIAL_HALF, DIAL_HALF);
  }

  public render(
    ctx: CanvasRenderingContext2D,
    timeData: TimeData,
    dialCenter: Point2D = PCB_GEOMETRY.DIAL_CENTER,
    surgeIntensity = 0
  ): void {
    const cx = dialCenter.x;
    const cy = dialCenter.y;

    // 1. Draw pre-rendered static PCB dial rings, vias, 60 passives, and 12 SMD footprints
    ctx.save();
    ctx.drawImage(
      this.staticDialCanvas,
      cx - DIAL_HALF,
      cy - DIAL_HALF,
      DIAL_CANVAS_SIZE,
      DIAL_CANVAS_SIZE
    );

    // 2. Dynamic active electrical telemetry on dial (active second pad glow + surge ring)
    this.drawActiveDialEnergization(ctx, cx, cy, timeData, surgeIntensity);

    // 3. Hour Hand (Laser-etched PCB cantilever truss needle with ENIG rails & vector tip)
    this.drawHourCantileverHand(ctx, cx, cy, timeData.angles.hour);

    // 4. Minute Hand (Laser-etched PCB probe cantilever with micro-via spine & vector core)
    this.drawMinuteCantileverHand(ctx, cx, cy, timeData.angles.minute);

    // 5. Second Hand (Illuminated oscilloscope vector trace with phosphor persistence trail)
    this.drawSecondOscilloscopeHand(ctx, cx, cy, timeData.angles.second, timeData.secondMode);

    // 6. Center MEMS / QFN Clock Synthesizer Hub Cap (U0: CHRONO-ASIC-2049)
    this.drawCenterOscillatorCap(ctx, cx, cy, timeData.angles.second);

    ctx.restore();
  }

  private drawStaticDialSubstrate(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();

    // 1. Outer Dial Cavity & Concentric Ground/Power Copper Rings
    // Deep matte FR-4 circular dial base
    ctx.beginPath();
    ctx.arc(cx, cy, 444, 0, Math.PI * 2);
    ctx.fillStyle = '#090b0f';
    ctx.fill();

    // Outer Ground Guard Ring (Aged Copper #c8963e + ENIG #f4c462)
    ctx.beginPath();
    ctx.arc(cx, cy, 438, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 428, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 72 Stitched Annular Vias around Outer Ground Guard Ring (every 5 degrees)
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const vx = cx + Math.cos(rad) * 438;
      const vy = cy + Math.sin(rad) * 438;
      drawAnnularVia(ctx, vx, vy, 3.6, 1.6);
    }

    // Power Distribution Copper Ring (VDD_CORE = 3.3V) at r = 382
    ctx.beginPath();
    ctx.arc(cx, cy, 382, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 150, 62, 0.45)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Inner Chapter Copper Ring at r = 285 with 36 stitched vias
    ctx.beginPath();
    ctx.arc(cx, cy, 285, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 278, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244, 196, 98, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (let deg = 0; deg < 360; deg += 10) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const vx = cx + Math.cos(rad) * 285;
      const vy = cy + Math.sin(rad) * 285;
      drawAnnularVia(ctx, vx, vy, 3.4, 1.5);
    }

    // Inner BGA/ASIC Core Ring at r = 165
    ctx.beginPath();
    ctx.arc(cx, cy, 165, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    for (let deg = 15; deg < 360; deg += 30) {
      const rad = ((deg - 90) * Math.PI) / 180;
      drawAnnularVia(ctx, cx + Math.cos(rad) * 165, cy + Math.sin(rad) * 165, 3.8, 1.7);
    }

    // 2. 45-Degree Radial Fan-Out Traces from Central ASIC Hub to Hour Markers
    this.drawRadialFanoutTraces(ctx, cx, cy);

    // 3. 60 Radial Passive Solder Pad Pairs (0402 / 0603) for Minute/Second Indices
    this.draw60PassiveSolderPads(ctx, cx, cy);

    // 4. 12 SMD Package Footprints (SOIC-8 / QFN-16) as Hour Markers with Pin 1 Index
    this.draw12SmdHourFootprints(ctx, cx, cy);

    // 5. Silkscreen Brand Markings & Technical Sub-dials
    this.drawDialSilkscreenMarkings(ctx, cx, cy);

    ctx.restore();
  }

  private drawRadialFanoutTraces(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // For each of the 12 hours, route 3 parallel traces with a 45-degree dogleg jog
    for (let h = 0; h < 12; h++) {
      const baseAngle = ((h * 30 - 90) * Math.PI) / 180;

      for (let lane = -1; lane <= 1; lane++) {
        const offsetAngle = lane * 0.032;
        const r1 = 68;
        const r2 = 135;
        const r3 = 165;
        const r4 = 248;
        const r5 = 278;

        const p1x = cx + Math.cos(baseAngle + offsetAngle * 1.6) * r1;
        const p1y = cy + Math.sin(baseAngle + offsetAngle * 1.6) * r1;

        const p2x = cx + Math.cos(baseAngle + offsetAngle * 1.6) * r2;
        const p2y = cy + Math.sin(baseAngle + offsetAngle * 1.6) * r2;

        // 45-degree dogleg transition across r2..r3
        const p3x = cx + Math.cos(baseAngle + offsetAngle * 0.65) * r3;
        const p3y = cy + Math.sin(baseAngle + offsetAngle * 0.65) * r3;

        const p4x = cx + Math.cos(baseAngle + offsetAngle * 0.65) * r4;
        const p4y = cy + Math.sin(baseAngle + offsetAngle * 0.65) * r4;

        const p5x = cx + Math.cos(baseAngle + offsetAngle * 0.35) * r5;
        const p5y = cy + Math.sin(baseAngle + offsetAngle * 0.35) * r5;

        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.lineTo(p3x, p3y);
        ctx.lineTo(p4x, p4y);
        ctx.lineTo(p5x, p5y);
        ctx.strokeStyle = lane === 0 ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.AGED_COPPER;
        ctx.globalAlpha = lane === 0 ? 0.55 : 0.42;
        ctx.lineWidth = lane === 0 ? 2.2 : 1.6;
        ctx.stroke();

        // Via at end of inner fan-out trace
        if (lane === 0) {
          drawAnnularVia(ctx, p4x, p4y, 3.6, 1.6);
        }
      }
    }
    ctx.restore();
  }

  /**
   * 60 radial passive solder pad pairs (0402 / 0603) for minute/second indices.
   * Every 5th index is a larger 0603 passive footprint with silkscreen numeric readout;
   * non-5th indices are compact 0402 dual reflow pad pairs.
   */
  private draw60PassiveSolderPads(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const padRingRadius = 404;

    for (let i = 0; i < 60; i++) {
      const isMajor5 = i % 5 === 0;
      const angleRad = ((i * 6 - 90) * Math.PI) / 180;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad + Math.PI / 2); // Local -Y points outward toward the rim

      if (isMajor5) {
        // 0603 Passive Solder Pad Pair at y = -padRingRadius
        const yCenter = -padRingRadius;
        const padW = 10;
        const padH = 6.5;
        const gap = 7;

        // Silkscreen component courtyard outline
        ctx.strokeStyle = PCB_COLORS.SILKSCREEN_BONE;
        ctx.lineWidth = 1.1;
        ctx.strokeRect(-padW / 2 - 2.5, yCenter - gap / 2 - padH - 2, padW + 5, padH * 2 + gap + 4);

        // Outer ENIG Solder Pad
        ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
        ctx.fillRect(-padW / 2, yCenter - gap / 2 - padH, padW, padH);

        // Inner ENIG Solder Pad
        ctx.fillRect(-padW / 2, yCenter + gap / 2, padW, padH);

        // Dark SMD resistor body bridging the two pads
        ctx.fillStyle = '#141821';
        ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
        ctx.lineWidth = 1;
        ctx.fillRect(-padW / 2 + 1, yCenter - gap / 2 - 1, padW - 2, gap + 2);
        ctx.strokeRect(-padW / 2 + 1, yCenter - gap / 2 - 1, padW - 2, gap + 2);
      } else {
        // 0402 Passive Solder Pad Pair
        const yCenter = -padRingRadius;
        const padW = 5.5;
        const padH = 4.2;
        const gap = 4.5;

        // Outer ENIG Pad
        ctx.fillStyle = PCB_COLORS.AGED_COPPER;
        ctx.fillRect(-padW / 2, yCenter - gap / 2 - padH, padW, padH);
        ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
        ctx.fillRect(-padW / 2 + 0.6, yCenter - gap / 2 - padH + 0.6, padW - 1.2, padH - 1.2);

        // Inner ENIG Pad
        ctx.fillStyle = PCB_COLORS.AGED_COPPER;
        ctx.fillRect(-padW / 2, yCenter + gap / 2, padW, padH);
        ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
        ctx.fillRect(-padW / 2 + 0.6, yCenter + gap / 2 + 0.6, padW - 1.2, padH - 1.2);

        // Silkscreen tick between 0402 pads
        ctx.fillStyle = 'rgba(232, 226, 208, 0.45)';
        ctx.fillRect(-1, yCenter - 1, 2, 2);
      }

      ctx.restore();

      // Upright silkscreen minute numerals (00, 05 .. 55) outside/inside 0603 footprints
      if (isMajor5) {
        const labelRadius = 420;
        const lx = cx + Math.cos(angleRad) * labelRadius;
        const ly = cy + Math.sin(angleRad) * labelRadius;
        ctx.save();
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i).padStart(2, '0'), lx, ly);
        ctx.restore();
      }
    }
  }

  /**
   * 12 SMD package footprints (SOIC-8 / QFN-16) as hour markers,
   * with explicit Pin 1 index indicating exact hour positions.
   */
  private draw12SmdHourFootprints(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const smdRadius = 334;

    for (let h = 1; h <= 12; h++) {
      const hourIndex = h % 12;
      const angleRad = ((hourIndex * 30 - 90) * Math.PI) / 180;
      const isCardinalQfn = hourIndex % 3 === 0; // 12, 3, 6, 9 use QFN-16; others use SOIC-8

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad + Math.PI / 2); // Local -Y points radially outward to exact hour position
      ctx.translate(0, -smdRadius);

      if (isCardinalQfn) {
        this.drawQfn16Footprint(ctx, h);
      } else {
        this.drawSoic8Footprint(ctx, h);
      }

      ctx.restore();

      // Upright silkscreen Hour Designator & IC Reference (e.g. "U12 [12]" / "U03 [03]")
      const labelR = 250;
      const tx = cx + Math.cos(angleRad) * labelR;
      const ty = cy + Math.sin(angleRad) * labelR;

      ctx.save();
      ctx.font = isCardinalQfn
        ? 'bold 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        : 'bold 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = isCardinalQfn ? PCB_COLORS.SILKSCREEN_AMBER : PCB_COLORS.SILKSCREEN_BONE;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(h).padStart(2, '0'), tx, ty - 7);

      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = PCB_COLORS.SILKSCREEN_MUTED;
      ctx.fillText(`U${String(h).padStart(2, '0')}`, tx, ty + 9);
      ctx.restore();
    }
  }

  /**
   * QFN-16 (Quad Flat No-Lead, 16-pin) footprint for cardinal hours (12, 3, 6, 9)
   * Pin 1 index dot & silkscreen pointer aligned on the exact radial hour vector.
   */
  private drawQfn16Footprint(ctx: CanvasRenderingContext2D, hourNum: number): void {
    const bodySize = 38;
    const half = bodySize / 2;

    // 1. 45-degree fan-out copper traces from QFN pads
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const offset = -10.5 + i * 7;
      // Top & bottom traces
      ctx.beginPath();
      ctx.moveTo(offset, -half - 4);
      ctx.lineTo(offset, -half - 13);
      ctx.moveTo(offset, half + 4);
      ctx.lineTo(offset, half + 13);
      // Left & right traces
      ctx.moveTo(-half - 4, offset);
      ctx.lineTo(-half - 13, offset);
      ctx.moveTo(half + 4, offset);
      ctx.lineTo(half + 13, offset);
      ctx.stroke();
    }

    // 2. Dark IC package body with Pin 1 chamfered top-center/radial bevel
    ctx.fillStyle = '#0d1016';
    ctx.strokeStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.lineWidth = 1.3;
    ctx.fillRect(-half, -half, bodySize, bodySize);
    ctx.strokeRect(-half, -half, bodySize, bodySize);

    // 3. Central Exposed ENIG Thermal Pad (EPAD) with 2x2 thermal vias
    const epad = 18;
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fillRect(-epad / 2, -epad / 2, epad, epad);

    for (const vx of [-4.5, 4.5]) {
      for (const vy of [-4.5, 4.5]) {
        ctx.beginPath();
        ctx.arc(vx, vy, 2.0, 0, Math.PI * 2);
        ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
        ctx.fill();
      }
    }

    // 4. 16 Perimeter QFN ENIG Solder Lands (4 on each of the 4 sides)
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    for (let i = 0; i < 4; i++) {
      const offset = -10.5 + i * 7;
      // Outer (top) 4 lands
      ctx.fillRect(offset - 2, -half - 5, 4, 7);
      // Inner (bottom) 4 lands
      ctx.fillRect(offset - 2, half - 2, 4, 7);
      // Left 4 lands
      ctx.fillRect(-half - 5, offset - 2, 7, 4);
      // Right 4 lands
      ctx.fillRect(half - 2, offset - 2, 7, 4);
    }

    // 5. Explicit Pin 1 Index Marker at exact radial position (outer radial axis x=0, y=-half)
    // Bright ENIG/Amber Pin 1 circular pit inside package + Silkscreen triangle outside
    ctx.beginPath();
    ctx.arc(0, -half + 5.5, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.ENIG_BRIGHT;
    ctx.fill();
    ctx.strokeStyle = PCB_COLORS.SUBSTRATE_DARK;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Silkscreen Pin 1 exact position triangle indicator on radial axis
    ctx.beginPath();
    ctx.moveTo(0, -half - 16);
    ctx.lineTo(-4.5, -half - 23);
    ctx.lineTo(4.5, -half - 23);
    ctx.closePath();
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fill();

    // Package silkscreen code
    ctx.font = 'bold 7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'center';
    ctx.fillText(`QFN${hourNum}`, 0, half - 4);
  }

  /**
   * SOIC-8 (Small Outline IC, 8-pin) footprint for non-cardinal hours
   * Pin 1 index dot & notch indicating exact radial hour position.
   */
  private drawSoic8Footprint(ctx: CanvasRenderingContext2D, hourNum: number): void {
    const bodyW = 24;
    const bodyH = 32;
    const hw = bodyW / 2;
    const hh = bodyH / 2;

    // 1. 8 Gull-wing ENIG Solder Pads (4 left, 4 right) + 45-degree fan-out stubs
    for (let i = 0; i < 4; i++) {
      const py = -10.5 + i * 7;

      // Copper trace stub
      ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-hw - 7, py);
      ctx.lineTo(-hw - 13, py - 4);
      ctx.moveTo(hw + 7, py);
      ctx.lineTo(hw + 13, py - 4);
      ctx.stroke();

      // Left ENIG solder pad (Pins 1..4)
      ctx.fillStyle = i === 0 ? PCB_COLORS.ENIG_BRIGHT : PCB_COLORS.ENIG_GOLD;
      ctx.fillRect(-hw - 7, py - 2.2, 8, 4.4);

      // Right ENIG solder pad (Pins 8..5)
      ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
      ctx.fillRect(hw - 1, py - 2.2, 8, 4.4);
    }

    // 2. Molded SOIC-8 IC Body
    ctx.fillStyle = '#0e1218';
    ctx.strokeStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.lineWidth = 1.2;
    ctx.fillRect(-hw, -hh, bodyW, bodyH);
    ctx.strokeRect(-hw, -hh, bodyW, bodyH);

    // Exposed central copper thermal slug inside SOIC-8
    ctx.fillStyle = 'rgba(200, 150, 62, 0.45)';
    ctx.fillRect(-hw + 4, -hh + 8, bodyW - 8, bodyH - 16);

    // 3. Pin 1 Orientation Notch & Explicit Pin 1 Index Dot indicating exact hour position
    ctx.beginPath();
    ctx.arc(0, -hh, 4, 0, Math.PI);
    ctx.strokeStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Pin 1 index dot
    ctx.beginPath();
    ctx.arc(-hw + 5, -10.5, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.ENIG_BRIGHT;
    ctx.fill();

    // Radial exact-hour Pin 1 silkscreen marker pip
    ctx.beginPath();
    ctx.arc(0, -hh - 9, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fill();

    ctx.font = 'bold 7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'center';
    ctx.fillText(`S8-${hourNum}`, 0, 3);
  }

  private drawDialSilkscreenMarkings(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.textAlign = 'center';

    // Upper silkscreen brand typography in amber/bone-white monospace
    ctx.font = 'bold 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText('PCB-2049 // SILICON MASTER', cx, cy - 112);

    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fillText('MEMS TCXO 32.768KHZ  •  ENIG AU-79', cx, cy - 92);

    // Lower dial technical register readout box
    ctx.strokeStyle = 'rgba(232, 226, 208, 0.35)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(cx - 88, cy + 84, 176, 36);

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText('REV 4.2 // IMPEDANCE 50Ω', cx, cy + 98);
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fillText('PIN-1 RADIAL LOCKED', cx, cy + 112);

    // Dual Test Point rings at 4:30 and 7:30 (modern homage to dual winding arbors)
    for (const side of [-1, 1]) {
      const tpx = cx + side * 92;
      const tpy = cy + 52;
      drawAnnularVia(ctx, tpx, tpy, 11, 5);
      ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
      ctx.fillText(side < 0 ? 'TP_CLK_A' : 'TP_CLK_B', tpx, tpy + 20);
    }

    ctx.restore();
  }

  private drawActiveDialEnergization(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    timeData: TimeData,
    surgeIntensity: number
  ): void {
    ctx.save();

    // 1. Highlight the active second passive solder pad pair on the 60-pad ring
    const activeSec = timeData.seconds;
    const secRad = ((activeSec * 6 - 90) * Math.PI) / 180;
    const px = cx + Math.cos(secRad) * 404;
    const py = cy + Math.sin(secRad) * 404;

    const padGlow = ctx.createRadialGradient(px, py, 1, px, py, 18);
    padGlow.addColorStop(0, 'rgba(255, 229, 153, 0.9)');
    padGlow.addColorStop(0.5, 'rgba(244, 196, 98, 0.35)');
    padGlow.addColorStop(1, 'rgba(244, 196, 98, 0)');
    ctx.fillStyle = padGlow;
    ctx.beginPath();
    ctx.arc(px, py, 18, 0, Math.PI * 2);
    ctx.fill();

    // 2. Highlight active hour SMD footprint Pin-1 beacon
    const activeHour = timeData.hours % 12;
    const hourRad = ((activeHour * 30 - 90) * Math.PI) / 180;
    const hx = cx + Math.cos(hourRad) * 352;
    const hy = cy + Math.sin(hourRad) * 352;

    ctx.beginPath();
    ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.shadowColor = PCB_COLORS.ENIG_GOLD;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 3. If a WebSocket notification electron surge is active, illuminate concentric copper rings
    if (surgeIntensity > 0.01) {
      ctx.beginPath();
      ctx.arc(cx, cy, 428, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 215, 110, ${Math.min(0.9, surgeIntensity * 0.85)})`;
      ctx.lineWidth = 4 + surgeIntensity * 4;
      ctx.shadowColor = PCB_COLORS.ENIG_GOLD;
      ctx.shadowBlur = 24 * surgeIntensity;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 285, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(244, 196, 98, ${Math.min(0.75, surgeIntensity * 0.65)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Hour Hand: Laser-etched PCB cantilever truss needle with 45-degree skeletonized
   * cutouts, internal copper differential traces, and illuminated vector tip.
   */
  private drawHourCantileverHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    // Drop shadow for mechanical PCB cantilever depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;

    // Outer FR-4 / ENIG gold cantilever silhouette (from tail y=+58 to tip y=-242)
    ctx.beginPath();
    ctx.moveTo(-11, 56);
    ctx.lineTo(-14, 18);
    ctx.lineTo(-12, -165);
    ctx.lineTo(-4, -225);
    ctx.lineTo(0, -246);
    ctx.lineTo(4, -225);
    ctx.lineTo(12, -165);
    ctx.lineTo(14, 18);
    ctx.lineTo(11, 56);
    ctx.closePath();

    ctx.fillStyle = '#10141c';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Skeletonized 45-degree truss cutouts along cantilever body
    ctx.fillStyle = '#07090d';
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 1.2;
    for (let y = -35; y >= -150; y -= 36) {
      ctx.beginPath();
      ctx.rect(-6.5, y - 22, 13, 20);
      ctx.fill();
      ctx.stroke();
    }

    // Internal glowing oscilloscope vector trace spine
    ctx.beginPath();
    ctx.moveTo(0, 42);
    ctx.lineTo(0, -240);
    ctx.strokeStyle = PCB_COLORS.ENIG_BRIGHT;
    ctx.lineWidth = 2.0;
    ctx.shadowColor = PCB_COLORS.VECTOR_AMBER;
    ctx.shadowBlur = 8;
    ctx.stroke();

    // Illuminated vector diamond reticle at tip
    ctx.beginPath();
    ctx.moveTo(0, -244);
    ctx.lineTo(-5, -222);
    ctx.lineTo(0, -212);
    ctx.lineTo(5, -222);
    ctx.closePath();
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Minute Hand: Long laser-etched PCB cantilever probe with dual ENIG rails,
   * stitched micro-vias, and an illuminated oscilloscope vector beam.
   */
  private drawMinuteCantileverHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;

    // Tapered PCB cantilever probe (from y=+72 to tip y=-368)
    ctx.beginPath();
    ctx.moveTo(-8, 72);
    ctx.lineTo(-10, 20);
    ctx.lineTo(-7.5, -270);
    ctx.lineTo(-2.5, -352);
    ctx.lineTo(0, -372);
    ctx.lineTo(2.5, -352);
    ctx.lineTo(7.5, -270);
    ctx.lineTo(10, 20);
    ctx.lineTo(8, 72);
    ctx.closePath();

    ctx.fillStyle = '#0e1219';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Stitched micro-vias along the minute probe shaft
    for (let y = -45; y >= -255; y -= 30) {
      drawAnnularVia(ctx, 0, y, 2.8, 1.2);
    }

    // Illuminated oscilloscope vector trace running to tip
    ctx.beginPath();
    ctx.moveTo(0, 55);
    ctx.lineTo(0, -368);
    ctx.strokeStyle = PCB_COLORS.ENIG_BRIGHT;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = PCB_COLORS.VECTOR_AMBER;
    ctx.shadowBlur = 9;
    ctx.stroke();

    // Glowing needle tip
    ctx.beginPath();
    ctx.arc(0, -356, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Second Hand: Illuminated oscilloscope vector trace with phosphor persistence
   * sweep trail and SMD crystal counterweight.
   */
  private drawSecondOscilloscopeHand(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    angleDeg: number,
    secondMode: 'tick' | 'sweep'
  ): void {
    const rad = ((angleDeg - 90) * Math.PI) / 180;

    // 1. Oscilloscope Phosphor Persistence Arc Trail along the passive pad ring
    ctx.save();
    const trailSpanRad = secondMode === 'sweep' ? 0.28 : 0.14;
    const segments = 14;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const a0 = rad - trailSpanRad * (1 - t0);
      const a1 = rad - trailSpanRad * (1 - t1);
      ctx.beginPath();
      ctx.arc(cx, cy, 392, a0, a1);
      ctx.strokeStyle = `rgba(244, 196, 98, ${(t1 * 0.45).toFixed(3)})`;
      ctx.lineWidth = 3.5 * t1;
      ctx.stroke();
    }
    ctx.restore();

    // 2. Vector Trace Needle
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);

    // Counterweight tail (SMD tuning-fork resonator loop from y=0 to y=+92)
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 54);
    ctx.stroke();

    ctx.fillStyle = '#10141c';
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.8;
    ctx.fillRect(-7, 54, 14, 28);
    ctx.strokeRect(-7, 54, 14, 28);

    // Glowing phosphor vector beam from y=+54 to tip y=-396
    ctx.shadowColor = PCB_COLORS.VECTOR_AMBER;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = PCB_COLORS.VECTOR_AMBER;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 50);
    ctx.lineTo(0, -396);
    ctx.stroke();

    // Inner white-hot electron beam core
    ctx.strokeStyle = PCB_COLORS.VECTOR_CORE;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(0, -396);
    ctx.stroke();

    // Vector crosshair pip near tip
    ctx.beginPath();
    ctx.arc(0, -382, 4, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.fill();

    ctx.restore();
  }

  /**
   * Center Pinion Cap styled as a gold-lid MEMS TCXO / QFN Clock Synthesizer IC
   */
  private drawCenterOscillatorCap(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    secondAngleDeg: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);

    // Outer octagonal copper pad ring
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0e14';
    ctx.fill();
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Gold-plated ceramic QFN lid
    const s = 32;
    ctx.fillStyle = '#141922';
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 2;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeRect(-s / 2, -s / 2, s, s);

    // 4 corner gold solder tabs
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fillRect(-s / 2 - 3, -s / 2 - 3, 6, 6);
    ctx.fillRect(s / 2 - 3, -s / 2 - 3, 6, 6);
    ctx.fillRect(-s / 2 - 3, s / 2 - 3, 6, 6);
    ctx.fillRect(s / 2 - 3, s / 2 - 3, 6, 6);

    // Inner rotating phase reticle
    ctx.save();
    ctx.rotate((secondAngleDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -7, 2, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.VECTOR_CORE;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}

