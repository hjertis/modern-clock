import { Point2D } from '../../types/theme';
import {
  PCB_COLORS,
  PCB_EMERALD_COLORS,
  PCB_GEOMETRY,
  LEFT_LATERAL_BUS_PATHS,
  RIGHT_LATERAL_BUS_PATHS,
  EMERALD_LOWER_LEFT_BUS_PATHS,
  EMERALD_LOWER_RIGHT_BUS_PATHS,
  PcbThemeVariant
} from './constants';

/**
 * Renders the static multi-layer FR-4 motherboard substrate for PCB-2049
 * onto an offscreen 1080x1920 canvas during theme mount().
 */
export function createSubstrateCanvas(variant: PcbThemeVariant = 'standard'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PCB_GEOMETRY.WIDTH;
  canvas.height = PCB_GEOMETRY.HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  if (variant === 'emerald') {
    drawEmeraldFr4Substrate(ctx);
    drawEmeraldCopperPourRelief(ctx);
    drawLateralTraceBuses(ctx, 'emerald');
    drawEmeraldMidSectionGridAndBridge(ctx);
    drawEmeraldLowerWaferBusesAndEdgeFingers(ctx);
    drawCornerMountingHolesAndFiducials(ctx);
    drawBoardSilkscreenLegends(ctx, 'emerald');
    return canvas;
  }

  drawBaseFr4Substrate(ctx);
  drawCopperGroundPours(ctx);
  drawLateralTraceBuses(ctx, 'standard');
  drawChamberArchitecture(ctx);
  drawLowerWaferBayAndBeatScale(ctx);
  drawCornerMountingHolesAndFiducials(ctx);
  drawBoardSilkscreenLegends(ctx, 'standard');

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

function drawLateralTraceBuses(
  ctx: CanvasRenderingContext2D,
  variant: PcbThemeVariant = 'standard'
): void {
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
    const alpha = variant === 'emerald' ? (isGoldTrace ? 0.78 : 0.68) : isGoldTrace ? 0.65 : 0.55;
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
    [{ x: 940, y: 990 }, { x: 905, y: 955 }, { x: 730, y: 955 }, { x: 695, y: 990 }, { x: 615, y: 990 }]
  ];

  if (variant === 'standard') {
    secondaryTraces.push(
      [{ x: 260, y: 1850 }, { x: 290, y: 1820 }, { x: 460, y: 1820 }, { x: 480, y: 1840 }],
      [{ x: 820, y: 1850 }, { x: 790, y: 1820 }, { x: 620, y: 1820 }, { x: 600, y: 1840 }]
    );
  }

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

function drawBoardSilkscreenLegends(
  ctx: CanvasRenderingContext2D,
  variant: PcbThemeVariant = 'standard'
): void {
  ctx.save();
  ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;

  // Top header silkscreen bar
  ctx.textAlign = 'center';
  ctx.fillText(
    variant === 'emerald'
      ? 'PCB-2049 // SILICON MASTER // REV B // EMERALD LPI SOLDERMASK'
      : 'PCB-2049 // INDUSTRIAL SILICON CHRONOGRAPH SUBSTRATE // IPC-6012 CLASS 3',
    540,
    46
  );

  if (variant === 'emerald') {
    ctx.restore();
    return;
  }

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

function drawEmeraldFr4Substrate(ctx: CanvasRenderingContext2D): void {
  const { WIDTH, HEIGHT } = PCB_GEOMETRY;

  // 1. Dark anodized outer frame / bezel rails on left and right edges
  ctx.fillStyle = PCB_EMERALD_COLORS.MASK_OUTER_CHASSIS;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 2. Stepped Emerald-Green FR-4 Motherboard Card with PCIe bottom tongue
  const boardGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  boardGrad.addColorStop(0, PCB_EMERALD_COLORS.MASK_DEEP);
  boardGrad.addColorStop(0.35, PCB_EMERALD_COLORS.MASK_RICH);
  boardGrad.addColorStop(0.7, PCB_EMERALD_COLORS.MASK_DEEP);
  boardGrad.addColorStop(1, PCB_EMERALD_COLORS.MASK_RICH);

  ctx.save();
  ctx.beginPath();
  const m = 38;
  const c = 36;
  const shoulderY = 1834;
  const tongueLeft = 188;
  const tongueRight = WIDTH - 188;

  ctx.moveTo(m + c, 18);
  ctx.lineTo(WIDTH - m - c, 18);
  ctx.lineTo(WIDTH - m, 18 + c);
  ctx.lineTo(WIDTH - m, shoulderY - 28);
  ctx.lineTo(WIDTH - m - 28, shoulderY);
  ctx.lineTo(tongueRight + 16, shoulderY);
  ctx.lineTo(tongueRight, shoulderY + 16);
  ctx.lineTo(tongueRight, HEIGHT);
  ctx.lineTo(tongueLeft, HEIGHT);
  ctx.lineTo(tongueLeft, shoulderY + 16);
  ctx.lineTo(tongueLeft - 16, shoulderY);
  ctx.lineTo(m + 28, shoulderY);
  ctx.lineTo(m, shoulderY - 28);
  ctx.lineTo(m, 18 + c);
  ctx.closePath();

  ctx.fillStyle = boardGrad;
  ctx.fill();

  // Subtle fiberglass FR-4 micro-weave inside the emerald board
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(120, 255, 190, 0.022)';
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

  // Board perimeter aged copper keep-out border
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // Edge plated half-moon castellations along left & right edges
  for (let y = 160; y <= 1760; y += 36) {
    if (y > 920 && y < 1060) continue;
    drawEdgeCastellation(ctx, m, y, 'left');
    drawEdgeCastellation(ctx, WIDTH - m, y, 'right');
  }
  ctx.restore();
}

function drawEmeraldCopperPourRelief(ctx: CanvasRenderingContext2D): void {
  ctx.save();

  // Translucent emerald-green copper pour relief planes (classic green LPI soldermask over 1oz copper planes)
  const reliefPlanes = [
    { x: 66, y: 66, w: 220, h: 220 },
    { x: 794, y: 66, w: 220, h: 220 },
    { x: 86, y: 740, w: 260, h: 210 },
    { x: 734, y: 740, w: 260, h: 210 },
    { x: 86, y: 1030, w: 340, h: 280 },
    { x: 654, y: 1030, w: 340, h: 280 },
    { x: 180, y: 1320, w: 720, h: 490 }
  ];

  for (const plane of reliefPlanes) {
    ctx.save();
    // Raised copper plane under green soldermask
    ctx.fillStyle = 'rgba(20, 68, 45, 0.42)';
    ctx.strokeStyle = 'rgba(200, 150, 62, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(plane.x, plane.y, plane.w, plane.h);
    ctx.strokeRect(plane.x, plane.y, plane.w, plane.h);

    // 45-degree cross-hatched copper ground relief pattern visible through emerald mask
    ctx.beginPath();
    ctx.rect(plane.x, plane.y, plane.w, plane.h);
    ctx.clip();

    ctx.strokeStyle = 'rgba(200, 150, 62, 0.085)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -plane.h; i < plane.w + plane.h; i += 14) {
      ctx.moveTo(plane.x + i, plane.y);
      ctx.lineTo(plane.x + i - plane.h, plane.y + plane.h);
      ctx.moveTo(plane.x + i, plane.y + plane.h);
      ctx.lineTo(plane.x + i - plane.h, plane.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawEmeraldMidSectionGridAndBridge(ctx: CanvasRenderingContext2D): void {
  const { PENDULUM_PIVOT } = PCB_GEOMETRY;
  ctx.save();

  // 1. Mid-board technical schematic grid frame matching the reference image (y = 850..1280)
  const gridLeft = 114;
  const gridRight = 966;
  const gridTop = 860;
  const gridBottom = 1265;

  // Recessed dark-emerald technical bay
  ctx.fillStyle = 'rgba(6, 22, 15, 0.72)';
  ctx.strokeStyle = 'rgba(200, 150, 62, 0.42)';
  ctx.lineWidth = 1.4;
  ctx.fillRect(gridLeft, gridTop, gridRight - gridLeft, gridBottom - gridTop);
  ctx.strokeRect(gridLeft, gridTop, gridRight - gridLeft, gridBottom - gridTop);

  // Fine orthogonal coordinate grid lines inside mid-section
  ctx.strokeStyle = 'rgba(244, 196, 98, 0.11)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gridLeft + 60; x < gridRight; x += 60) {
    ctx.moveTo(x, gridTop);
    ctx.lineTo(x, gridBottom);
  }
  for (let y = gridTop + 50; y < gridBottom; y += 50) {
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(gridRight, y);
  }
  ctx.stroke();

  // Reference image silkscreen callouts on upper-left of mid-board (above U_NET panel)
  ctx.textAlign = 'left';
  ctx.font = 'bold 21px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
  ctx.fillText('PCB-2049 // INDUSTRIAL SILICON', 124, 922);

  ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(232, 226, 208, 0.75)';
  ctx.fillText('DAEMON: /ws (CONNECTED)', 124, 948);
  ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
  ctx.fillText('STATUS: ACTIVE // PENDULUM SYNC NOMINAL', 124, 968);

  // Coordinate grid numeric markers from reference image (185, 75, 45, 150, 20)
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(232, 226, 208, 0.55)';
  ctx.fillText('185', 124, 1185);
  ctx.fillText('75', 252, 1185);
  ctx.fillText('45', 804, 1185);
  ctx.fillText('150', 124, 1254);
  ctx.fillText('20', 936, 1254);

  // Right-side status bar silkscreen frames above/behind U_OSC
  for (let i = 0; i < 3; i++) {
    const bx = 824;
    const by = 924 + i * 34;
    ctx.strokeStyle = 'rgba(200, 150, 62, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, 130, 26);
    ctx.fillStyle = 'rgba(244, 196, 98, 0.25)';
    ctx.fillRect(bx + 8, by + 16, 86 - i * 18, 4);
    ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText('⚙ STATUS', bx + 8, by + 11);
  }

  // ZIF-16 Mezzanine FPC Connector Shroud at Pendulum Pivot (540, 990)
  const zifW = 148;
  const zifH = 34;
  const zifX = PENDULUM_PIVOT.x - zifW / 2;
  const zifY = PENDULUM_PIVOT.y - zifH / 2;

  ctx.fillStyle = '#07140e';
  ctx.strokeStyle = PCB_COLORS.ENIG_GOLD;
  ctx.lineWidth = 1.8;
  ctx.fillRect(zifX, zifY, zifW, zifH);
  ctx.strokeRect(zifX, zifY, zifW, zifH);

  for (let i = 0; i < 16; i++) {
    const px = zifX + 14 + i * 8;
    ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
    ctx.fillRect(px - 2, zifY - 5, 4, 6);
    ctx.fillRect(px - 2, zifY + zifH - 1, 4, 6);
  }

  ctx.restore();
}

function drawEmeraldLowerWaferBusesAndEdgeFingers(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Recessed emerald lower chamber bay around wafer & buses
  ctx.fillStyle = 'rgba(5, 18, 12, 0.68)';
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 1330);
  ctx.lineTo(132, 1294);
  ctx.lineTo(948, 1294);
  ctx.lineTo(984, 1330);
  ctx.lineTo(984, 1796);
  ctx.lineTo(948, 1832);
  ctx.lineTo(132, 1832);
  ctx.lineTo(96, 1796);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2. Tight, multi-lane 45° parallel copper trace buses hugging the lower wafer bezel
  // and terminating into the bottom PCIe gold edge-connector fingers
  const lowerBuses = [...EMERALD_LOWER_LEFT_BUS_PATHS, ...EMERALD_LOWER_RIGHT_BUS_PATHS];

  // Dark soldermask trench behind trace bundles
  for (const path of lowerBuses) {
    strokePolyline(ctx, path, 'rgba(2, 8, 5, 0.85)', 6.5);
  }

  // Draw each parallel copper/gold trace lane with crisp 45-degree miter corners
  lowerBuses.forEach((path, idx) => {
    const lane = idx % 8;
    const isBrightGold = lane === 0 || lane === 3 || lane === 4 || lane === 7;
    const color = isBrightGold ? PCB_COLORS.ENIG_GOLD : PCB_COLORS.AGED_COPPER;
    const width = isBrightGold ? 3.2 : 2.6;

    strokePolyline(ctx, path, color, width);

    // Subtle specular highlight along center of trace
    if (isBrightGold) {
      strokePolyline(ctx, path, 'rgba(255, 236, 179, 0.45)', 1.1);
    }

    // Vias at wafer-side origin and selected bends
    drawAnnularVia(ctx, path[0].x, path[0].y, 4.2, 1.8);
    drawAnnularVia(ctx, path[2].x, path[2].y, 3.8, 1.6);
  });

  // Additional inner companion 45-degree traces hugging directly under the lower wafer arc
  const innerWaferHugLeft: Point2D[][] = [
    [
      { x: 350, y: 1590 },
      { x: 260, y: 1590 },
      { x: 224, y: 1626 },
      { x: 224, y: 1696 },
      { x: 280, y: 1752 },
      { x: 454, y: 1752 },
      { x: 472, y: 1770 },
      { x: 472, y: 1852 }
    ],
    [
      { x: 368, y: 1618 },
      { x: 274, y: 1618 },
      { x: 244, y: 1648 },
      { x: 244, y: 1688 },
      { x: 292, y: 1736 },
      { x: 478, y: 1736 },
      { x: 496, y: 1754 },
      { x: 496, y: 1852 }
    ],
    [
      { x: 410, y: 1676 },
      { x: 332, y: 1676 },
      { x: 368, y: 1712 },
      { x: 504, y: 1712 },
      { x: 520, y: 1728 },
      { x: 520, y: 1852 }
    ]
  ];
  const innerWaferHugRight: Point2D[][] = innerWaferHugLeft.map((p) =>
    p.map((pt) => ({ x: 1080 - pt.x, y: pt.y }))
  );

  for (const path of [...innerWaferHugLeft, ...innerWaferHugRight]) {
    strokePolyline(ctx, path, 'rgba(2, 8, 5, 0.85)', 6.0);
    strokePolyline(ctx, path, PCB_COLORS.ENIG_GOLD, 3.0);
    drawAnnularVia(ctx, path[0].x, path[0].y, 4.5, 1.9);
  }

  // 3. Glowing Cyan & Red SMD Indicator LEDs + Silkscreen Callouts flanking the lower wafer
  const drawGlowingLed = (x: number, y: number, color: string, r = 4.2) => {
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, r * 4.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Dual cyan optical lock LEDs on left and right of wafer bezel (y ~ 1515, 1532)
  drawGlowingLed(236, 1514, PCB_EMERALD_COLORS.CYAN_LED, 4.0);
  drawGlowingLed(236, 1532, PCB_EMERALD_COLORS.CYAN_LED, 4.0);
  drawGlowingLed(1080 - 236, 1514, PCB_EMERALD_COLORS.CYAN_LED, 4.0);
  drawGlowingLed(1080 - 236, 1532, PCB_EMERALD_COLORS.CYAN_LED, 4.0);

  // Red fault/sync LED pairs + FD01..FD04 / RD01..RD04 silkscreen legends (y ~ 1600..1654)
  drawGlowingLed(278, 1626, PCB_EMERALD_COLORS.RED_LED, 3.8);
  drawGlowingLed(278, 1644, PCB_EMERALD_COLORS.RED_LED, 3.8);
  drawGlowingLed(1080 - 278, 1626, PCB_EMERALD_COLORS.RED_LED, 3.8);
  drawGlowingLed(1080 - 278, 1644, PCB_EMERALD_COLORS.RED_LED, 3.8);

  // Warm amber bus activity LEDs along outer trace lanes
  drawGlowingLed(150, 1495, PCB_COLORS.ENIG_BRIGHT, 3.6);
  drawGlowingLed(930, 1545, PCB_COLORS.ENIG_BRIGHT, 3.6);
  drawGlowingLed(290, 1684, PCB_COLORS.ENIG_BRIGHT, 3.6);
  drawGlowingLed(790, 1684, PCB_COLORS.ENIG_BRIGHT, 3.6);

  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(232, 226, 208, 0.75)';
  ctx.textAlign = 'left';
  ['FD01', 'FD02', 'FD03', 'FD04'].forEach((lbl, i) => {
    ctx.fillText(lbl, 236, 1602 + i * 15);
  });
  ctx.textAlign = 'right';
  ['RD01', 'RD02', 'RD03', 'RD04'].forEach((lbl, i) => {
    ctx.fillText(lbl, 1080 - 236, 1602 + i * 15);
  });

  // Bottom SMD resistor array triplets near lower corners (x ~ 136..172 and 908..944, y ~ 1796)
  for (const baseX of [136, 908]) {
    for (let i = 0; i < 3; i++) {
      const rx = baseX + i * 16;
      const ry = 1794;
      ctx.fillStyle = PCB_COLORS.ENIG_GOLD;
      ctx.fillRect(rx, ry, 6, 4);
      ctx.fillRect(rx, ry + 10, 6, 4);
      ctx.fillStyle = '#141c18';
      ctx.fillRect(rx, ry + 4, 6, 6);
    }
  }

  // 4. Vertical PCIe-Style ENIG Gold Edge-Connector Fingers along Bottom Edge of Viewport
  const fingerTopY = 1850;
  const fingerHeight = 68;
  const fingerWidth = 14;
  const fingerPitch = 24;

  // Emerald soldermask edge-connector substrate bar
  ctx.fillStyle = PCB_EMERALD_COLORS.MASK_RICH;
  ctx.fillRect(194, 1840, 692, 80);
  ctx.strokeStyle = 'rgba(200, 150, 62, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(194, 1840, 692, 80);

  // Draw left bank (12 gold fingers) and right bank (12 gold fingers) with PCIe keying gap in center
  const fingerXPositions: number[] = [];
  for (let i = 0; i < 12; i++) {
    fingerXPositions.push(228 + i * fingerPitch);
  }
  for (let i = 0; i < 12; i++) {
    fingerXPositions.push(588 + i * fingerPitch);
  }

  for (const fx of fingerXPositions) {
    const left = fx - fingerWidth / 2;

    // Short copper neck trace entering top of gold finger
    ctx.fillStyle = PCB_COLORS.AGED_COPPER;
    ctx.fillRect(fx - 2.5, fingerTopY - 12, 5, 14);

    // Metallic ENIG gold finger gradient with 3D beveled sheen
    const fGrad = ctx.createLinearGradient(left, fingerTopY, left + fingerWidth, fingerTopY);
    fGrad.addColorStop(0, '#b5832b');
    fGrad.addColorStop(0.25, PCB_COLORS.ENIG_GOLD);
    fGrad.addColorStop(0.5, PCB_COLORS.ENIG_BRIGHT);
    fGrad.addColorStop(0.8, PCB_COLORS.ENIG_GOLD);
    fGrad.addColorStop(1, '#9c6e1f');

    ctx.fillStyle = fGrad;
    ctx.beginPath();
    ctx.moveTo(left + 2, fingerTopY);
    ctx.lineTo(left + fingerWidth - 2, fingerTopY);
    ctx.lineTo(left + fingerWidth, fingerTopY + 4);
    ctx.lineTo(left + fingerWidth, fingerTopY + fingerHeight - 5);
    ctx.lineTo(left + fingerWidth - 3, fingerTopY + fingerHeight);
    ctx.lineTo(left + 3, fingerTopY + fingerHeight);
    ctx.lineTo(left, fingerTopY + fingerHeight - 5);
    ctx.lineTo(left, fingerTopY + 4);
    ctx.closePath();
    ctx.fill();

    // Crisp dark copper outline & top chamfer line
    ctx.strokeStyle = 'rgba(90, 58, 12, 0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 245, 200, 0.55)';
    ctx.fillRect(left + 2, fingerTopY + 2, fingerWidth - 4, 3);
  }

  // Central PCIe mechanical polarization keyway slot (between x=508 and x=572)
  ctx.fillStyle = '#030705';
  ctx.strokeStyle = PCB_COLORS.AGED_COPPER;
  ctx.lineWidth = 1.5;
  ctx.fillRect(528, 1858, 24, 62);
  ctx.strokeRect(528, 1858, 24, 62);

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

