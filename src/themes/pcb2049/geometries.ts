import * as THREE from 'three';
import { Point2D } from '../../types/theme';
import { ThreeStage } from '../three/ThreeStage';
import { PCB_COLORS, PCB_GEOMETRY } from './constants';

/** Converts a 2D pixel distance (in 1080x1920 space) to Three.js world units. */
export function pxToWorld(px: number): number {
  return px / ThreeStage.PIXELS_PER_UNIT;
}

/**
 * Creates the stepped FR-4 motherboard PCB shape with 45-degree chamfered corners
 * and the bottom PCIe edge-connector tongue.
 */
export function createSteppedPcbBoardGeometry(
  depth = 0.14,
  bevelEnabled = true
): THREE.ExtrudeGeometry {
  const { WIDTH, HEIGHT } = PCB_GEOMETRY;
  const m = 38;
  const c = 36;
  const shoulderY = 1834;
  const tongueLeft = 188;
  const tongueRight = WIDTH - 188;

  const pts: Point2D[] = [
    { x: m + c, y: 18 },
    { x: WIDTH - m - c, y: 18 },
    { x: WIDTH - m, y: 18 + c },
    { x: WIDTH - m, y: shoulderY - 28 },
    { x: WIDTH - m - 28, y: shoulderY },
    { x: tongueRight + 16, y: shoulderY },
    { x: tongueRight, y: shoulderY + 16 },
    { x: tongueRight, y: HEIGHT },
    { x: tongueLeft, y: HEIGHT },
    { x: tongueLeft, y: shoulderY + 16 },
    { x: tongueLeft - 16, y: shoulderY },
    { x: m + 28, y: shoulderY },
    { x: m, y: shoulderY - 28 },
    { x: m, y: 18 + c }
  ];

  const shape = new THREE.Shape();
  pts.forEach((pt, idx) => {
    const w = ThreeStage.canvasToWorldXY(pt.x, pt.y);
    if (idx === 0) shape.moveTo(w.x, w.y);
    else shape.lineTo(w.x, w.y);
  });
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled,
    bevelThickness: bevelEnabled ? 0.012 : 0,
    bevelSize: bevelEnabled ? 0.012 : 0,
    bevelSegments: bevelEnabled ? 2 : 1,
    curveSegments: 1
  });
  return geo;
}

/**
 * Generates radial 45-degree ENIG gold bus trace paths inside the circular dial,
 * routing from the central CHRONO-ASIC hub out to the 12 hour QFNs and chapter ring.
 */
export function createDialRadialBusPaths(): Point2D[][] {
  const cx = PCB_GEOMETRY.DIAL_CENTER.x;
  const cy = PCB_GEOMETRY.DIAL_CENTER.y;
  const paths: Point2D[][] = [];

  for (let i = 0; i < 24; i++) {
    const deg = i * 15 - 90;
    const rad = (deg * Math.PI) / 180;
    const isHour = i % 2 === 0;
    const rStart = isHour ? 58 : 78;
    const rBend = isHour ? 195 : 175;
    const rEnd = isHour ? 355 : 275;
    const bendOffset = (i % 4 === 0 ? 1 : -1) * (4 * Math.PI) / 180;

    paths.push([
      { x: cx + Math.cos(rad) * rStart, y: cy + Math.sin(rad) * rStart },
      { x: cx + Math.cos(rad) * rBend, y: cy + Math.sin(rad) * rBend },
      {
        x: cx + Math.cos(rad + bendOffset) * (rBend + 28),
        y: cy + Math.sin(rad + bendOffset) * (rBend + 28)
      },
      {
        x: cx + Math.cos(rad + bendOffset) * rEnd,
        y: cy + Math.sin(rad + bendOffset) * rEnd
      }
    ]);
  }

  return paths;
}

/**
 * Creates a merged 3D BufferGeometry of raised rectangular trace ribbons along
 * 45-degree mitered polylines (in 1080x1920 pixel coordinates).
 */
export function createTraceRibbonGeometry(
  paths: Point2D[][],
  widthPx: number,
  heightWorld: number
): THREE.BufferGeometry {
  const halfW = pxToWorld(widthPx) * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const pushQuad = (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    n: THREE.Vector3
  ) => {
    positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    for (let i = 0; i < 4; i++) {
      normals.push(n.x, n.y, n.z);
    }
    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset,
      vertexOffset + 2,
      vertexOffset + 3
    );
    vertexOffset += 4;
  };

  for (const path of paths) {
    if (path.length < 2) continue;
    const worldPts = path.map((pt) => {
      const w = ThreeStage.canvasToWorldXY(pt.x, pt.y);
      return new THREE.Vector2(w.x, w.y);
    });

    const leftPts: THREE.Vector2[] = [];
    const rightPts: THREE.Vector2[] = [];

    for (let i = 0; i < worldPts.length; i++) {
      let dir: THREE.Vector2;
      if (i === 0) {
        dir = worldPts[1].clone().sub(worldPts[0]).normalize();
      } else if (i === worldPts.length - 1) {
        dir = worldPts[i].clone().sub(worldPts[i - 1]).normalize();
      } else {
        const d1 = worldPts[i].clone().sub(worldPts[i - 1]).normalize();
        const d2 = worldPts[i + 1].clone().sub(worldPts[i]).normalize();
        dir = d1.add(d2);
        if (dir.lengthSq() < 1e-6) {
          dir = d1;
        } else {
          dir.normalize();
        }
      }

      const perp = new THREE.Vector2(-dir.y, dir.x);
      let miterScale = 1.0;
      if (i > 0 && i < worldPts.length - 1) {
        const d1 = worldPts[i].clone().sub(worldPts[i - 1]).normalize();
        const n1 = new THREE.Vector2(-d1.y, d1.x);
        const dot = Math.max(0.45, Math.abs(perp.dot(n1)));
        miterScale = Math.min(1.6, 1.0 / dot);
      }

      leftPts.push(worldPts[i].clone().addScaledVector(perp, halfW * miterScale));
      rightPts.push(worldPts[i].clone().addScaledVector(perp, -halfW * miterScale));
    }

    for (let i = 0; i < worldPts.length - 1; i++) {
      const l0 = leftPts[i];
      const l1 = leftPts[i + 1];
      const r0 = rightPts[i];
      const r1 = rightPts[i + 1];

      // Top face (z = heightWorld)
      pushQuad(
        new THREE.Vector3(r0.x, r0.y, heightWorld),
        new THREE.Vector3(r1.x, r1.y, heightWorld),
        new THREE.Vector3(l1.x, l1.y, heightWorld),
        new THREE.Vector3(l0.x, l0.y, heightWorld),
        new THREE.Vector3(0, 0, 1)
      );

      // Side bevels for crisp light catching
      const segDir = worldPts[i + 1].clone().sub(worldPts[i]).normalize();
      const rightN = new THREE.Vector3(segDir.y, -segDir.x, 0);
      const leftN = new THREE.Vector3(-segDir.y, segDir.x, 0);

      pushQuad(
        new THREE.Vector3(r0.x, r0.y, 0),
        new THREE.Vector3(r1.x, r1.y, 0),
        new THREE.Vector3(r1.x, r1.y, heightWorld),
        new THREE.Vector3(r0.x, r0.y, heightWorld),
        rightN
      );
      pushQuad(
        new THREE.Vector3(l1.x, l1.y, 0),
        new THREE.Vector3(l0.x, l0.y, 0),
        new THREE.Vector3(l0.x, l0.y, heightWorld),
        new THREE.Vector3(l1.x, l1.y, heightWorld),
        leftN
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Generates procedural bump & roughness maps for the glossy emerald LPI soldermask,
 * encoding FR-4 fiberglass micro-weave and 45-degree cross-hatched copper pour relief.
 */
export function createPcbLpiReliefTextures(): {
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const width = 512;
  const height = 960;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bCtx = bumpCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d');

  if (bCtx && rCtx) {
    bCtx.fillStyle = '#606060';
    bCtx.fillRect(0, 0, width, height);

    rCtx.fillStyle = '#e0e0e0';
    rCtx.fillRect(0, 0, width, height);

    // Subtle FR-4 fiberglass weave
    bCtx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    bCtx.lineWidth = 1;
    const step = 6;
    bCtx.beginPath();
    for (let x = 0; x <= width; x += step) {
      bCtx.moveTo(x, 0);
      bCtx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
      bCtx.moveTo(0, y);
      bCtx.lineTo(width, y);
    }
    bCtx.stroke();

    // Raised copper pour relief planes under the emerald LPI soldermask
    const scaleX = width / 1080;
    const scaleY = height / 1920;
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
      const px = plane.x * scaleX;
      const py = plane.y * scaleY;
      const pw = plane.w * scaleX;
      const ph = plane.h * scaleY;

      bCtx.fillStyle = '#9a9a9a';
      bCtx.fillRect(px, py, pw, ph);

      rCtx.fillStyle = '#c8c8c8';
      rCtx.fillRect(px, py, pw, ph);

      bCtx.save();
      bCtx.beginPath();
      bCtx.rect(px, py, pw, ph);
      bCtx.clip();
      bCtx.strokeStyle = '#c0c0c0';
      bCtx.lineWidth = 1;
      bCtx.beginPath();
      for (let i = -ph; i < pw + ph; i += 8) {
        bCtx.moveTo(px + i, py);
        bCtx.lineTo(px + i - ph, py + ph);
        bCtx.moveTo(px + i, py + ph);
        bCtx.lineTo(px + i - ph, py);
      }
      bCtx.stroke();
      bCtx.restore();
    }
  }

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  return { bumpMap, roughnessMap };
}

/**
 * Generates board-level silkscreen typography, mid-section technical schematic grid,
 * and edge-connector legends onto a transparent 1080x1920 CanvasTexture.
 */
export function createBoardSilkscreenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PCB_GEOMETRY.WIDTH;
  canvas.height = PCB_GEOMETRY.HEIGHT;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Mid-board technical schematic grid frame (y = 860..1265)
    const gridLeft = 114;
    const gridRight = 966;
    const gridTop = 860;
    const gridBottom = 1265;

    ctx.strokeStyle = 'rgba(244, 196, 98, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gridLeft, gridTop, gridRight - gridLeft, gridBottom - gridTop);

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

    // Silkscreen callouts
    ctx.textAlign = 'left';
    ctx.font = 'bold 21px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText('PCB-2049 // INDUSTRIAL SILICON', 124, 922);

    ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(232, 226, 208, 0.78)';
    ctx.fillText('REV 2.049 // 4-LAYER ENIG + LPI EMERALD', 124, 948);
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_AMBER;
    ctx.fillText('ZONE 01: CHRONO-DIAL  //  ZONE 03: SILICON WAFER', 124, 968);

    // Coordinate grid numeric markers
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(232, 226, 208, 0.58)';
    ctx.fillText('185', 124, 1185);
    ctx.fillText('75', 252, 1185);
    ctx.fillText('45', 804, 1185);
    ctx.fillText('150', 124, 1254);
    ctx.fillText('20', 936, 1254);

    // ZIF-16 label
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.fillText('J1: ZIF-16 KAPTON FPC', PCB_GEOMETRY.PENDULUM_PIVOT.x, 1026);

    // Bottom edge connector silkscreen
    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(232, 226, 208, 0.6)';
    ctx.fillText('PCIe-X8 // DAEMON BUS INTERFACE', 540, 1795);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates circular dial silkscreen (60 minute ticks, cardinal numerals,
 * and CHRONO-ASIC-2049 markings) onto a dedicated 900x900 CanvasTexture.
 */
export function createDialSilkscreenTexture(): THREE.CanvasTexture {
  const size = 900;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const cx = size * 0.5;
    const cy = size * 0.5;

    for (let i = 0; i < 60; i++) {
      const rad = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const rInner = isHour ? 332 : 344;
      const rOuter = 360;
      ctx.strokeStyle = isHour ? PCB_COLORS.SILKSCREEN_BONE : 'rgba(232, 226, 208, 0.45)';
      ctx.lineWidth = isHour ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * rInner, cy + Math.sin(rad) * rInner);
      ctx.lineTo(cx + Math.cos(rad) * rOuter, cy + Math.sin(rad) * rOuter);
      ctx.stroke();
    }

    const cardinals = [
      { label: '12', deg: -90 },
      { label: '03', deg: 0 },
      { label: '06', deg: 90 },
      { label: '09', deg: 180 }
    ];
    ctx.font = 'bold 22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = PCB_COLORS.SILKSCREEN_BONE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of cardinals) {
      const rad = (c.deg * Math.PI) / 180;
      ctx.fillText(c.label, cx + Math.cos(rad) * 292, cy + Math.sin(rad) * 292);
    }

    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(244, 196, 98, 0.78)';
    ctx.fillText('CHRONO-ASIC-2049', cx, cy + 72);
    ctx.fillStyle = 'rgba(232, 226, 208, 0.58)';
    ctx.fillText('VDD_CORE 3.3V // 32.768 kHz', cx, cy - 72);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a subdivided 3D Kapton ribbon geometry that can flex smoothly along Y.
 */
export function createKaptonRibbonGeometry(
  width: number,
  length: number,
  thickness: number,
  segmentsY = 24
): THREE.BoxGeometry {
  return new THREE.BoxGeometry(width, length, thickness, 1, segmentsY, 1);
}

/**
 * Updates vertex X offsets of a subdivided Kapton ribbon (centered at y = -length/2)
 * to produce a subtle harmonic bow synced with the pendulum swing.
 */
export function updateKaptonRibbonFlex(
  geometry: THREE.BufferGeometry,
  length: number,
  flexBowX: number
): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  let baseXAttr = geometry.userData.baseX as Float32Array | undefined;
  if (!baseXAttr) {
    baseXAttr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      baseXAttr[i] = pos.getX(i);
    }
    geometry.userData.baseX = baseXAttr;
  }

  for (let i = 0; i < pos.count; i++) {
    // Geometry is shifted so top is at y=0 and bottom at y=-length
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, -y / length));
    const bow = 4 * t * (1 - t) * flexBowX;
    pos.setX(i, baseXAttr[i] + bow);
  }
  pos.needsUpdate = true;
}

/**
 * Creates a precision-milled 3D clock hand with a dark metallic beveled body
 * and an intense warm neon-orange emissive core channel.
 */
export function createMilledClockHand(
  length: number,
  tailLength: number,
  width: number,
  thickness: number,
  bodyMat: THREE.Material,
  emissiveMat: THREE.Material,
  zOffset: number
): THREE.Group {
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  const hw = width * 0.5;
  shape.moveTo(-hw * 0.85, -tailLength);
  shape.lineTo(hw * 0.85, -tailLength);
  shape.lineTo(hw, 0);
  shape.lineTo(hw * 0.36, length * 0.88);
  shape.lineTo(0, length);
  shape.lineTo(-hw * 0.36, length * 0.88);
  shape.lineTo(-hw, 0);
  shape.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.z = zOffset;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Glowing neon-orange plasma core positioned cleanly (+0.01) in front of the hand frame
  const coreWidth = width * 0.38;
  const coreLength = length * 0.84;
  const coreDepth = Math.max(0.014, thickness * 0.45);
  const coreGeo = new THREE.BoxGeometry(coreWidth, coreLength, coreDepth);
  const coreMesh = new THREE.Mesh(coreGeo, emissiveMat);
  coreMesh.position.set(
    0,
    coreLength * 0.5 + length * 0.06,
    zOffset + thickness + 0.008 + 0.01 + coreDepth * 0.5
  );
  coreMesh.userData.isEmissiveIndicator = true;
  group.add(coreMesh);

  return group;
}

/**
 * Creates a matte-black 3D QFN IC package with shiny metallic solder-pad fillets.
 */
export function createQfnPackageGroup(
  size: number,
  height: number,
  pinsPerSide: number,
  bodyMat: THREE.Material,
  solderMat: THREE.Material
): THREE.Group {
  const group = new THREE.Group();

  // Matte-black epoxy mold body
  const bodyGeo = new THREE.BoxGeometry(size, size, height);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.z = height * 0.5;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Shiny metallic solder-pad fillets around all 4 sides
  const pitch = (size * 0.78) / Math.max(1, pinsPerSide - 1);
  const start = -size * 0.39;
  const padW = pitch * 0.52;
  const padL = size * 0.14;
  const padH = height * 0.38;

  const padGeoH = new THREE.BoxGeometry(padW, padL, padH);
  const padGeoV = new THREE.BoxGeometry(padL, padW, padH);

  for (let i = 0; i < pinsPerSide; i++) {
    const offset = pinsPerSide === 1 ? 0 : start + i * pitch;

    const topPad = new THREE.Mesh(padGeoH, solderMat);
    topPad.position.set(offset, size * 0.5 + padL * 0.25, padH * 0.5);
    group.add(topPad);

    const botPad = new THREE.Mesh(padGeoH, solderMat);
    botPad.position.set(offset, -size * 0.5 - padL * 0.25, padH * 0.5);
    group.add(botPad);

    const leftPad = new THREE.Mesh(padGeoV, solderMat);
    leftPad.position.set(-size * 0.5 - padL * 0.25, offset, padH * 0.5);
    group.add(leftPad);

    const rightPad = new THREE.Mesh(padGeoV, solderMat);
    rightPad.position.set(size * 0.5 + padL * 0.25, offset, padH * 0.5);
    group.add(rightPad);
  }

  return group;
}

/**
 * Creates the machined black-anodized Zone 03 wafer bezel ring using LatheGeometry.
 */
export function createMachinedWaferBezelGeometry(innerR: number, outerR: number): THREE.LatheGeometry {
  const profile = [
    new THREE.Vector2(innerR, -0.04),
    new THREE.Vector2(outerR, -0.04),
    new THREE.Vector2(outerR, 0.10),
    new THREE.Vector2(outerR - 0.06, 0.16),
    new THREE.Vector2(innerR + 0.07, 0.16),
    new THREE.Vector2(innerR + 0.02, 0.08),
    new THREE.Vector2(innerR, 0.08),
    new THREE.Vector2(innerR, -0.04)
  ];
  const geo = new THREE.LatheGeometry(profile, 64);
  // Rotate so lathe axis aligns with +Z
  geo.rotateX(Math.PI * 0.5);
  return geo;
}
