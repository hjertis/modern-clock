import { Point2D } from '../../types/theme';
import {
  PCB_COLORS,
  PCB_GEOMETRY,
  LEFT_LATERAL_BUS_PATHS,
  RIGHT_LATERAL_BUS_PATHS
} from './constants';

/**
 * Renders the static multi-layer FR-4 motherboard substrate for PCB-2049
 * onto an offscreen 1080x1920 canvas during theme mount().
 */
export function createSubstrateCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PCB_GEOMETRY.WIDTH;
  canvas.height = PCB_GEOMETRY.HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  drawBaseFr4Substrate(ctx);
  drawCopperGroundPours(ctx);
  drawLateralTraceBuses(ctx);
  drawChamberArchitecture(ctx);
  drawLowerWaferBayAndBeatScale(ctx);
  drawCornerMountingHolesAndFiducials(ctx);
  drawBoardSilkscreenLegends(ctx);

  return canvas;
}

function drawBaseFr4Substrate(ctx: CanvasRenderingContext2D): void {
  const { WIDTH, HEIGHT } = PCB_GEOMETRY;

  // 1. Deep matte FR-4 black #0c0e12 base
  ctx.fillStyle = PCB_COLORS.SUBSTRATE_BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 2. Subtle fiberglass FR-4 micro-weave cross-hatch grid
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.014)';
  ctx.lineWidth = 1;
  const step = 12;
  ctx.beginPath();
  for (let x = 0; x <= WIDTH; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
  }
  for (let y = 0; y <= HEIGHT; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
  }
  ctx.stroke();
  ctx.restore();

  // 3. Outer CNC-chamfered board edge keep-out border & ENIG edge castellations
  ctx.save();
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  // 45-degree chamfered board perimeter
  const m = 18;
  const c = 36;
  ctx.moveTo(m + c, m);
  ctx.lineTo(WIDTH - m - c, m);
  ctx.lineTo(WIDTH - m, m + c);
  ctx.lineTo(WIDTH - m, HEIGHT - m - c);
  ctx.lineTo(WIDTH - m - c, HEIGHT - m);
  ctx.lineTo(m + c, HEIGHT - m);
  ctx.lineTo(m, HEIGHT - m - c);
  ctx.lineTo(m, m + c);
  ctx.closePath();
  ctx.stroke();

  // Inner ENIG gold guard trace
  ctx.strokeStyle = 'rgba(244, 196, 98, 0.45)';
  ctx.lineWidth = 1.5;
  const m2 = 26;
  ctx.beginPath();
  ctx.moveTo(m2 + c, m2);
  ctx.lineTo(WIDTH - m2 - c, m2);
  ctx.lineTo(WIDTH - m2, m2 + c);
  ctx.lineTo(WIDTH - m2, HEIGHT - m2 - c);
  ctx.lineTo(WIDTH - m2 - c, HEIGHT - m2);
  ctx.lineTo(m2 + c, HEIGHT - m2);
  ctx.lineTo(m2, HEIGHT - m2 - c);
  ctx.lineTo(m2, m2 + c);
  ctx.closePath();
  ctx.stroke();

  // Edge plated half-moon castellations along left & right edges
  for (let y = 160; y <= 1760; y += 32) {
    if (y > 920 && y < 1060) continue;
    drawEdgeCastellation(ctx, m, y, 'left');
    drawEdgeCastellation(ctx, WIDTH - m, y, 'right');
  }
  ctx.restore();
}

function drawEdgeCastellation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: 'left' | 'right'
): void {
  ctx.save();
  ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
  ctx.beginPath();
  if (side === 'left') {
    ctx.rect(x - 3, y - 5, 9, 10);
  } else {
    ctx.rect(x - 6, y - 5, 9, 10);
  }
  ctx.fill();

  ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCopperGroundPours(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  // Cross-hatched inner copper ground pour in upper corner spandrels
  ctx.strokeStyle = 'rgba(200, 150, 62, 0.11)';
  ctx.lineWidth = 1.2;

  const spandrels = [
    { x: 42, y: 42, w: 190, h: 190 },
    { x: 848, y: 42, w: 190, h: 190 },
    { x: 42, y: 780, w: 170, h: 170 },
    { x: 868, y: 780, w: 170, h: 170 }
  ];

  for (const box of spandrels) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    ctx.beginPath();
    for (let i = -box.h; i < box.w + box.h; i += 10) {
      ctx.moveTo(box.x + i, box.y);
      ctx.lineTo(box.x + i - box.h, box.y + box.h);
      ctx.moveTo(box.x + i, box.y + box.h);
      ctx.lineTo(box.x + i - box.h, box.y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(200, 150, 62, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
  ctx.restore();
}

function drawLateralTraceBuses(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const allBuses = [...LEFT_LATERAL_BUS_PATHS, ...RIGHT_LATERAL_BUS_PATHS];

  // 1. Solder mask trench shadow under traces
  for (const path of allBuses) {
    strokePolyline(ctx, path, 'rgba(0, 0, 0, 0.65)', 5.5);
  }

  // 2. Aged copper & ENIG trace lines with 45-degree routing
  allBuses.forEach((path, idx) => {
    const isGoldTrace = idx % 2 === 0;
    const color = isGoldTrace ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.AGED_COPPER;
    const alpha = isGoldTrace ? 0.65 : 0.55;
    ctx.save();
    ctx.globalAlpha = alpha;
    strokePolyline(ctx, path, color, isGoldTrace ? 2.6 : 2.2);
    ctx.restore();

    // Draw annular vias at start, end, and selected bend vertices
    drawAnnularVia(ctx, path[0].x, path[0].y, 5.5, 2.5);
    drawAnnularVia(ctx, path[path.length - 1].x, path[path.length - 1].y, 5.5, 2.5);
    if (path.length > 5) {
      drawAnnularVia(ctx, path[4].x, path[4].y, 4.5, 2.0);
    }
  });

  // Additional decorative 45-degree secondary bus traces in upper and lower flanks
  const secondaryTraces: Point2D[][] = [
    // Upper left fan-in
    [{ x: 64, y: 260 }, { x: 110, y: 306 }, { x: 110, y: 410 }, { x: 145, y: 445 }],
    [{ x: 80, y: 260 }, { x: 124, y: 304 }, { x: 124, y: 404 }, { x: 156, y: 436 }],
    // Upper right fan-in
    [{ x: 1016, y: 260 }, { x: 970, y: 306 }, { x: 970, y: 410 }, { x: 935, y: 445 }],
    [{ x: 1000, y: 260 }, { x: 956, y: 304 }, { x: 956, y: 404 }, { x: 924, y: 436 }],
    // Mid-board horizontal bus feeds
    [{ x: 140, y: 990 }, { x: 175, y: 955 }, { x: 350, y: 955 }, { x: 385, y: 990 }, { x: 465, y: 990 }],
    [{ x: 940, y: 990 }, { x: 905, y: 955 }, { x: 730, y: 955 }, { x: 695, y: 990 }, { x: 615, y: 990 }],
    // Bottom bus trunk
    [{ x: 260, y: 1850 }, { x: 290, y: 1820 }, { x: 460, y: 1820 }, { x: 480, y: 1840 }],
    [{ x: 820, y: 1850 }, { x: 790, y: 1820 }, { x: 620, y: 1820 }, { x: 600, y: 1840 }]
  ];

  for (const path of secondaryTraces) {
    strokePolyline(ctx, path, PCB_COLORS.AGED_COPPER, 2.0);
    drawAnnularVia(ctx, path[0].x, path[0].y, 4.5, 2.0);
    drawAnnularVia(ctx, path[path.length - 1].x, path[path.length - 1].y, 4.5, 2.0);
  }

  ctx.restore();
}

function drawChamberArchitecture(ctx: CanvasRenderingContext2D): void {
  const { PENDULUM_PIVOT } = PCB_GEOMETRY;

  ctx.save();
  // Mid-Board Mezzanine Divider Bridge (separating Upper Chrono Chamber & Lower Wafer Chamber)
  const bridgeY = 968;
  const bridgeH = 44;

  // Copper busbar backing
  ctx.fillStyle = '#11151d';
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(155, bridgeY);
  ctx.lineTo(925, bridgeY);
  ctx.lineTo(945, bridgeY + 20);
  ctx.lineTo(925, bridgeY + bridgeH);
  ctx.lineTo(155, bridgeY + bridgeH);
  ctx.lineTo(135, bridgeY + 20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Stitched ground vias along the mezzanine bridge
  for (let x = 180; x <= 900; x += 36) {
    if (Math.abs(x - 540) < 90) continue;
    drawAnnularVia(ctx, x, bridgeY + 10, 4.2, 1.8);
    drawAnnularVia(ctx, x, bridgeY + bridgeH - 10, 4.2, 1.8);
  }

  // ZIF-16 Mezzanine FPC Connector Shroud at Pendulum Pivot (540, 990)
  const zifW = 148;
  const zifH = 38;
  const zifX = PENDULUM_PIVOT.x - zifW / 2;
  const zifY = PENDULUM_PIVOT.y - zifH / 2;

  ctx.fillStyle = '#07090d';
  ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
  ctx.lineWidth = 2;
  ctx.fillRect(zifX, zifY, zifW, zifH);
  ctx.strokeRect(zifX, zifY, zifW, zifH);

  // Gold ZIF connector contact pins (16 pins across top of shroud)
  for (let i = 0; i < 16; i++) {
    const px = zifX + 14 + i * 8;
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fillRect(px - 2, zifY - 6, 4, 7);
    ctx.fillRect(px - 2, zifY + zifH - 1, 4, 7);
  }

  // Locking actuator tabs on left & right of ZIF connector
  ctx.fillStyle = PCB_COLORS.AGED_COPPER;
  ctx.fillRect(zifX - 10, zifY + 6, 10, zifH - 12);
  ctx.fillRect(zifX + zifW, zifY + 6, 10, zifH - 12);

  // Silkscreen label for connector
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
  ctx.textAlign = 'center';
  ctx.fillText('J1_FPC_WAFER_BUS // ZIF-16P', PENDULUM_PIVOT.x, zifY + 15);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
  ctx.fillText('PIVOT_0 (540, 990)', PENDULUM_PIVOT.x, zifY + 29);

  ctx.restore();
}

function drawLowerWaferBayAndBeatScale(ctx: CanvasRenderingContext2D): void {
  ctx.save();

  // Recessed Lower Chamber Inspection Bay (octagonal chamfered cutout)
  const bayX = 155;
  const bayY = 1028;
  const bayW = 770;
  const bayH = 756;
  const cham = 34;

  ctx.beginPath();
  ctx.moveTo(bayX + cham, bayY);
  ctx.lineTo(bayX + bayW - cham, bayY);
  ctx.lineTo(bayX + bayW, bayY + cham);
  ctx.lineTo(bayX + bayW, bayY + bayH - cham);
  ctx.lineTo(bayX + bayW - cham, bayY + bayH);
  ctx.lineTo(bayX + cham, bayY + bayH);
  ctx.lineTo(bayX, bayY + bayH - cham);
  ctx.lineTo(bayX, bayY + cham);
  ctx.closePath();

  // Deep recessed cavity fill
  ctx.fillStyle = '#07090d';
  ctx.fill();

  // Clip inside bay to draw EMI copper mesh shield & circuit backing
  ctx.save();
  ctx.clip();

  // 45-degree EMI copper ground mesh plane
  ctx.strokeStyle = 'rgba(200, 150, 62, 0.065)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -bayH; i < bayW + bayH; i += 18) {
    ctx.moveTo(bayX + i, bayY);
    ctx.lineTo(bayX + i - bayH, bayY + bayH);
    ctx.moveTo(bayX + i, bayY + bayH);
    ctx.lineTo(bayX + i - bayH, bayY);
  }
  ctx.stroke();

  // Vertical & 45-deg optical reference grid lines inside lower chamber
  ctx.strokeStyle = 'rgba(244, 196, 98, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(540, bayY);
  ctx.lineTo(540, bayY + bayH);
  ctx.moveTo(bayX, 1460);
  ctx.lineTo(bayX + bayW, 1460);
  ctx.stroke();
  ctx.setLineDash([]);

  // Concentric target rings around wafer neutral park position (540, 1460)
  ctx.strokeStyle = 'rgba(200, 150, 62, 0.16)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(540, 1460, 140, 0, Math.PI * 2);
  ctx.arc(540, 1460, 175, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Chamber outer copper & ENIG double border
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Via stitching around the lower chamber perimeter
  for (let y = bayY + 50; y <= bayY + bayH - 50; y += 42) {
    drawAnnularVia(ctx, bayX - 10, y, 4.5, 2.0);
    drawAnnularVia(ctx, bayX + bayW + 10, y, 4.5, 2.0);
  }

  // Optical Beat Scale / Harmonic Protractor at bottom of pendulum arc (y ~ 1630)
  const pivotX = PCB_GEOMETRY.PENDULUM_PIVOT.x;
  const pivotY = PCB_GEOMETRY.PENDULUM_PIVOT.y;
  const scaleRadius = 640;

  ctx.save();
  // Arc from -8 deg to +8 deg around pendulum pivot (90 deg = straight down)
  const degToRad = (deg: number) => ((90 + deg) * Math.PI) / 180;

  // Outer copper arc band
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, scaleRadius, degToRad(-8.5), degToRad(8.5));
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pivotX, pivotY, scaleRadius + 22, degToRad(-8.5), degToRad(8.5));
  ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Degree graduation ticks (-8 to +8 in 0.5 deg steps)
  ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let deg = -8; deg <= 8; deg += 0.5) {
    const a = degToRad(deg);
    const isMajor = Number.isInteger(deg) && deg % 2 === 0;
    const isInt = Number.isInteger(deg);
    const innerR = isMajor ? scaleRadius - 10 : isInt ? scaleRadius - 4 : scaleRadius + 2;
    const outerR = isMajor ? scaleRadius + 22 : isInt ? scaleRadius + 18 : scaleRadius + 12;

    const x1 = pivotX + Math.cos(a) * innerR;
    const y1 = pivotY + Math.sin(a) * innerR;
    const x2 = pivotX + Math.cos(a) * outerR;
    const y2 = pivotY + Math.sin(a) * outerR;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = deg === 0 ? PCB_COLORS.ENIG_BRIGHT : isMajor ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = deg === 0 ? 3 : isMajor ? 2 : 1;
    ctx.stroke();

    if (isMajor) {
      const tx = pivotX + Math.cos(a) * (scaleRadius + 30);
      const ty = pivotY + Math.sin(a) * (scaleRadius + 30);
      ctx.fillStyle = deg === 0 ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.SILKSCREEN_BONE;
      const sign = deg > 0 ? '+' : '';
      ctx.fillText(`${sign}${deg}°`, tx, ty);
    }
  }

  // Optical photo-interrupter sensor footprints at -6°, 0°, +6°
  for (const sensorDeg of [-6, 0, 6]) {
    const a = degToRad(sensorDeg);
    const sx = pivotX + Math.cos(a) * (scaleRadius + 58);
    const sy = pivotY + Math.sin(a) * (scaleRadius + 58);
    drawAnnularVia(ctx, sx, sy, 6, 2.5);
  }

  ctx.fillStyle = PCB_COLORS.SILKSCREEN_MUTED;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('OPTICAL_INTERFEROMETER // HARMONIC SWING SCALE θ(t)', 540, 1712);

  ctx.restore();
  ctx.restore();
}

function drawCornerMountingHolesAndFiducials(ctx: CanvasRenderingContext2D): void {
  const { WIDTH, HEIGHT } = PCB_GEOMETRY;
  const holes = [
    { x: 68, y: 68, id: 'MH1' },
    { x: WIDTH - 68, y: 68, id: 'MH2' },
    { x: 68, y: HEIGHT - 68, id: 'MH3' },
    { x: WIDTH - 68, y: HEIGHT - 68, id: 'MH4' }
  ];

  for (const h of holes) {
    ctx.save();
    // Outer solder-mask clearance ring
    ctx.beginPath();
    ctx.arc(h.x, h.y, 26, 0, Math.PI * 2);
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ENIG plated mounting ring
    ctx.beginPath();
    ctx.arc(h.x, h.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fill();

    // 8 satellite ground vias around mounting ring
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const vx = h.x + Math.cos(a) * 16.5;
      const vy = h.y + Math.sin(a) * 16.5;
      ctx.beginPath();
      ctx.arc(vx, vy, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
      ctx.fill();
    }

    // Center M4 drill bore
    ctx.beginPath();
    ctx.arc(h.x, h.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#040507';
    ctx.fill();
    ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Silkscreen label
    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'center';
    ctx.fillText(`${h.id}_GND`, h.x, h.y + 38);
    ctx.restore();
  }

  // Optical pick-and-place Fiducial Targets (FID1..FID4)
  const fiducials = [
    { x: 140, y: 80, label: 'FID1' },
    { x: WIDTH - 140, y: 80, label: 'FID2' },
    { x: 110, y: 950, label: 'FID3' },
    { x: WIDTH - 110, y: 950, label: 'FID4' }
  ];

  for (const fid of fiducials) {
    ctx.save();
    ctx.strokeStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(fid.x, fid.y, 11, 0, Math.PI * 2);
    ctx.moveTo(fid.x - 15, fid.y);
    ctx.lineTo(fid.x + 15, fid.y);
    ctx.moveTo(fid.x, fid.y - 15);
    ctx.lineTo(fid.x, fid.y + 15);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(fid.x, fid.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fill();

    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fillText(fid.label, fid.x + 16, fid.y + 4);
    ctx.restore();
  }
}

function drawBoardSilkscreenLegends(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;

  // Top header silkscreen bar
  ctx.textAlign = 'center';
  ctx.fillText(
    'PCB-2049 // INDUSTRIAL SILICON CHRONOGRAPH SUBSTRATE // IPC-6012 CLASS 3',
    540,
    46
  );

  // Layer Stackup Coupon on bottom left
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(232, 226, 208, 0.4)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(130, 1812, 260, 62);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('LAYER STACKUP [FR-4 TG180]', 140, 1830);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('L1: ENIG_SIG   L2: GND_PLANE', 140, 1847);
  ctx.fillText('L3: VDD_3V3    L4: CHRONO_BUS', 140, 1862);

  // Center bottom daemon bus port silkscreen
  ctx.textAlign = 'center';
  ctx.strokeRect(420, 1812, 240, 62);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('J2_TELEMETRY_INGRESS', 540, 1830);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('DIFF_PAIR: 100Ω IMPEDANCE', 540, 1847);
  ctx.fillText('45° MITER ROUTING // ENIG AU', 540, 1862);

  // Right bottom fabrication block
  ctx.textAlign = 'left';
  ctx.strokeRect(690, 1812, 260, 62);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('FAB_SPEC // WAFER_REV_2049', 700, 1830);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('SUBSTRATE: #0C0E12 MATTE BLK', 700, 1847);
  ctx.fillText('FINISH: IMMERSION GOLD #F4C462', 700, 1862);

  ctx.restore();
}

export function drawAnnularVia(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR = 5,
  innerR = 2.2
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, innerR, 0, Math.PI * 2);
  ctx.fillStyle = PCB_COLORS.SUBSTRATE_DARK;
  ctx.fill();
  ctx.restore();
}

export function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  color: string,
  width: number
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

