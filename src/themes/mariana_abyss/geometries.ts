import * as THREE from 'three';

function addRoundedRectPath(
  target: THREE.Path | THREE.Shape,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  clockwise = false
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const rad = Math.min(r, hw, hh);
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = cy - hh;
  const y1 = cy + hh;

  if (!clockwise) {
    target.moveTo(x0 + rad, y0);
    target.lineTo(x1 - rad, y0);
    target.quadraticCurveTo(x1, y0, x1, y0 + rad);
    target.lineTo(x1, y1 - rad);
    target.quadraticCurveTo(x1, y1, x1 - rad, y1);
    target.lineTo(x0 + rad, y1);
    target.quadraticCurveTo(x0, y1, x0, y1 - rad);
    target.lineTo(x0, y0 + rad);
    target.quadraticCurveTo(x0, y0, x0 + rad, y0);
  } else {
    target.moveTo(x0 + rad, y0);
    target.quadraticCurveTo(x0, y0, x0, y0 + rad);
    target.lineTo(x0, y1 - rad);
    target.quadraticCurveTo(x0, y1, x0 + rad, y1);
    target.lineTo(x1 - rad, y1);
    target.quadraticCurveTo(x1, y1, x1, y1 - rad);
    target.lineTo(x1, y0 + rad);
    target.quadraticCurveTo(x1, y0, x1 - rad, y0);
    target.lineTo(x0 + rad, y0);
  }
}

/**
 * Extruded 3D cast-iron bathysphere front bulkhead with beveled edges and
 * three-zone cutouts (Zone 01 porthole, Zone 02 tube bay, Zone 03 aquarium window).
 */
export function createBathysphereChassisGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  addRoundedRectPath(shape, 0, 0, 10.6, 19.0, 0.35, false);

  // Zone 01: Circular porthole opening at (0, 5.10)
  const portholeHole = new THREE.Path();
  portholeHole.absarc(0, 5.1, 3.22, 0, Math.PI * 2, true);
  shape.holes.push(portholeHole);

  // Zone 02: Center pressure-tube bay at (0, -0.05)
  const tubeHole = new THREE.Path();
  addRoundedRectPath(tubeHole, 0, -0.05, 8.2, 1.92, 0.22, true);
  shape.holes.push(tubeHole);

  // Zone 03: Deep abyssal aquarium window at (0, -4.97)
  const aquariumHole = new THREE.Path();
  addRoundedRectPath(aquariumHole, 0, -4.97, 8.1, 6.55, 0.26, true);
  shape.holes.push(aquariumHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 36
  });
  geo.translate(0, 0, -0.42);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extruded oxidized naval-bronze trim frame around a rectangular zone opening.
 */
export function createZoneBezelFrameGeometry(
  innerW: number,
  innerH: number,
  border: number,
  radius: number,
  depth = 0.22
): THREE.ExtrudeGeometry {
  const outer = new THREE.Shape();
  addRoundedRectPath(outer, 0, 0, innerW + border * 2, innerH + border * 2, radius + border * 0.5, false);

  const hole = new THREE.Path();
  addRoundedRectPath(hole, 0, 0, innerW, innerH, radius, true);
  outer.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(outer, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.045,
    bevelSegments: 2,
    curveSegments: 24
  });
  geo.translate(0, 0, -depth * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Thick chamfered 3D submarine porthole bezel (LatheGeometry rotated to XY plane).
 */
export function createPortholeBezelGeometry(
  innerR: number,
  outerR: number,
  depth = 0.48
): THREE.LatheGeometry {
  const halfD = depth * 0.5;
  const chamfer = 0.12;
  const pts = [
    new THREE.Vector2(innerR, -halfD),
    new THREE.Vector2(outerR, -halfD),
    new THREE.Vector2(outerR, halfD - chamfer),
    new THREE.Vector2(outerR - chamfer, halfD),
    new THREE.Vector2(innerR + chamfer * 1.15, halfD),
    new THREE.Vector2(innerR, halfD - chamfer * 1.15),
    new THREE.Vector2(innerR, -halfD)
  ];
  const geo = new THREE.LatheGeometry(pts, 64);
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Curved convex submarine porthole glass lens (LatheGeometry).
 */
export function createCurvedLensGeometry(radius: number, sagitta = 0.26): THREE.LatheGeometry {
  const steps = 16;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = t * radius;
    const z = sagitta * Math.cos(t * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r, z));
  }
  // Slight thickness on back face
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const r = t * radius;
    const z = sagitta * 0.45 * Math.cos(t * Math.PI * 0.5) - 0.07;
    pts.push(new THREE.Vector2(r, z));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extruded horological steel bridge spanning across Zone 01 gear pivots.
 */
export function createHorologicalBridgeGeometry(
  length: number,
  width: number,
  thickness = 0.08
): THREE.ExtrudeGeometry {
  const hw = length * 0.5;
  const hh = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh * 0.65);
  shape.quadraticCurveTo(0, -hh * 1.15, hw, -hh * 0.65);
  shape.absarc(hw, 0, hh * 0.65, -Math.PI * 0.5, Math.PI * 0.5, false);
  shape.quadraticCurveTo(0, hh * 1.15, -hw, hh * 0.65);
  shape.absarc(-hw, 0, hh * 0.65, Math.PI * 0.5, Math.PI * 1.5, false);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extruded 3D submersible clock hand (hour or minute) pointing along +Y.
 */
export function createTritiumHandGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const hw = width * 0.5;
  const tail = length * 0.22;
  const shape = new THREE.Shape();
  shape.moveTo(0, -tail);
  shape.lineTo(hw * 0.9, -tail * 0.4);
  shape.lineTo(hw * 0.65, 0);
  shape.lineTo(hw * 0.85, length * 0.68);
  shape.lineTo(0, length);
  shape.lineTo(-hw * 0.85, length * 0.68);
  shape.lineTo(-hw * 0.65, 0);
  shape.lineTo(-hw * 0.9, -tail * 0.4);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Normalized stroke polylines (in [-0.5, 0.5] x [-0.5, 0.5]) for 3D Nixie cathode
 * numeral wire geometries '0' through '9'.
 */
const DIGIT_STROKES: Record<string, Array<Array<[number, number]>>> = {
  '0': [
    [
      [-0.24, 0.42],
      [0.0, 0.48],
      [0.24, 0.42],
      [0.3, 0.0],
      [0.24, -0.42],
      [0.0, -0.48],
      [-0.24, -0.42],
      [-0.3, 0.0],
      [-0.24, 0.42]
    ]
  ],
  '1': [
    [
      [-0.14, 0.34],
      [0.04, 0.48],
      [0.04, -0.48]
    ],
    [
      [-0.16, -0.48],
      [0.2, -0.48]
    ]
  ],
  '2': [
    [
      [-0.26, 0.32],
      [-0.12, 0.48],
      [0.14, 0.48],
      [0.28, 0.32],
      [0.26, 0.1],
      [-0.28, -0.48],
      [0.3, -0.48]
    ]
  ],
  '3': [
    [
      [-0.26, 0.36],
      [-0.08, 0.48],
      [0.16, 0.48],
      [0.28, 0.3],
      [0.16, 0.04],
      [-0.06, 0.04],
      [0.2, -0.02],
      [0.3, -0.26],
      [0.14, -0.48],
      [-0.14, -0.48],
      [-0.28, -0.34]
    ]
  ],
  '4': [
    [
      [0.16, -0.48],
      [0.16, 0.48],
      [-0.3, -0.14],
      [0.32, -0.14]
    ]
  ],
  '5': [
    [
      [0.26, 0.48],
      [-0.24, 0.48],
      [-0.26, 0.08],
      [0.12, 0.12],
      [0.28, -0.06],
      [0.26, -0.34],
      [0.08, -0.48],
      [-0.18, -0.48],
      [-0.28, -0.34]
    ]
  ],
  '6': [
    [
      [0.22, 0.42],
      [0.04, 0.48],
      [-0.2, 0.38],
      [-0.28, 0.0],
      [-0.24, -0.36],
      [0.0, -0.48],
      [0.24, -0.36],
      [0.28, -0.12],
      [0.14, 0.04],
      [-0.18, 0.04],
      [-0.28, -0.08]
    ]
  ],
  '7': [
    [
      [-0.28, 0.48],
      [0.28, 0.48],
      [-0.08, -0.48]
    ]
  ],
  '8': [
    [
      [0.0, 0.04],
      [-0.22, 0.14],
      [-0.22, 0.36],
      [0.0, 0.48],
      [0.22, 0.36],
      [0.22, 0.14],
      [0.0, 0.04],
      [-0.26, -0.12],
      [-0.26, -0.36],
      [0.0, -0.48],
      [0.26, -0.36],
      [0.26, -0.12],
      [0.0, 0.04]
    ]
  ],
  '9': [
    [
      [-0.22, -0.42],
      [-0.04, -0.48],
      [0.2, -0.38],
      [0.28, 0.0],
      [0.24, 0.36],
      [0.0, 0.48],
      [-0.24, 0.36],
      [-0.28, 0.12],
      [-0.14, -0.04],
      [0.18, -0.04],
      [0.28, 0.08]
    ]
  ]
};

/**
 * Builds shared 3D TubeGeometry wire meshes for digits '0'..'9' with thick, crisp
 * bent-wire strokes and spherical end-caps so every digit is clearly legible.
 */
export function createNumeralWireGeometries(
  width = 0.56,
  height = 0.94,
  wireRadius = 0.036
): Record<string, THREE.BufferGeometry> {
  const result: Record<string, THREE.BufferGeometry> = {};
  const capGeo = new THREE.SphereGeometry(wireRadius, 8, 6);

  for (const [digit, strokes] of Object.entries(DIGIT_STROKES)) {
    const geometries: THREE.BufferGeometry[] = [];
    for (const stroke of strokes) {
      const pts = stroke.map(([nx, ny]) => new THREE.Vector3(nx * width, ny * height, 0));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
      const tubularSegments = Math.max(16, stroke.length * 6);
      const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, wireRadius, 10, false);
      geometries.push(tubeGeo);

      // Add smooth spherical end-caps at stroke endpoints
      const startCap = capGeo.clone();
      startCap.translate(pts[0].x, pts[0].y, pts[0].z);
      geometries.push(startCap);

      const endPt = pts[pts.length - 1];
      if (endPt.distanceTo(pts[0]) > 0.01) {
        const endCap = capGeo.clone();
        endCap.translate(endPt.x, endPt.y, endPt.z);
        geometries.push(endCap);
      }
    }
    const merged = mergeSimpleGeometries(geometries);
    merged.computeVertexNormals();
    result[digit] = merged;
    for (const g of geometries) g.dispose();
  }

  capGeo.dispose();
  return result;
}

function mergeSimpleGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0].clone();

  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    positions.set(pos.array as Float32Array, vOffset * 3);
    if (norm) normals.set(norm.array as Float32Array, vOffset * 3);

    if (g.index) {
      const idxArr = g.index.array;
      for (let i = 0; i < idxArr.length; i++) {
        indices[iOffset + i] = idxArr[i] + vOffset;
      }
      iOffset += idxArr.length;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += pos.count;
    }
    vOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Fine hexagonal wire-mesh anode cage cylinder surrounding stacked 3D numeral filaments.
 */
export function createAnodeMeshGeometry(radius: number, height: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, 6, 6, true);
}

/**
 * Solid machined naval-bronze bathysphere gimbal ring housing for the vertical
 * IN-13 cyan bargraph tube.
 */
export function createClinometerBobGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.56, -0.22),
    new THREE.Vector2(0.74, -0.22),
    new THREE.Vector2(0.82, -0.12),
    new THREE.Vector2(0.82, 0.12),
    new THREE.Vector2(0.74, 0.22),
    new THREE.Vector2(0.56, 0.22),
    new THREE.Vector2(0.52, 0.14),
    new THREE.Vector2(0.52, -0.14),
    new THREE.Vector2(0.56, -0.22)
  ];
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extruded rocky abyssal trench ridge silhouette for layered 3D depth inside Zone 03.
 */
export function createTrenchRidgeGeometry(
  width: number,
  maxHeight: number,
  seed: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const hw = width * 0.5;
  shape.moveTo(-hw, 0);
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = -hw + t * width;
    const edgeDrop = 0.45 + 0.55 * Math.abs(t - 0.5) * 2;
    const n1 = Math.sin(t * 9.5 + seed * 3.1) * 0.32;
    const n2 = Math.cos(t * 21.0 - seed * 1.7) * 0.16;
    const y = Math.max(0.25, maxHeight * (0.42 * edgeDrop + 0.35 + n1 + n2));
    shape.lineTo(x, y);
  }
  shape.lineTo(hw, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.35,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2
  });
  geo.computeVertexNormals();
  return geo;
}

export interface JellyfishRig {
  root: THREE.Group;
  bell: THREE.Mesh;
  core: THREE.Mesh;
  oralArms: THREE.Mesh[];
  tentacles: THREE.Mesh[];
}

/**
 * Builds an articulated 3D translucent deep-sea jellyfish with undulating bell,
 * bioluminescent core, 4 ribbon-like oral arms, and 8 delicate trailing tentacles.
 */
export function createJellyfishRig(
  bellMat: THREE.Material,
  coreMat: THREE.Material,
  tentacleMat: THREE.Material
): JellyfishRig {
  const root = new THREE.Group();

  // Undulating bell profile via LatheGeometry
  const bellPts = [
    new THREE.Vector2(0.0, 0.46),
    new THREE.Vector2(0.26, 0.43),
    new THREE.Vector2(0.46, 0.28),
    new THREE.Vector2(0.56, 0.06),
    new THREE.Vector2(0.52, -0.04),
    new THREE.Vector2(0.38, 0.10),
    new THREE.Vector2(0.0, 0.20)
  ];
  const bellGeo = new THREE.LatheGeometry(bellPts, 28);
  const bell = new THREE.Mesh(bellGeo, bellMat);
  root.add(bell);

  // Inner bioluminescent organ
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), coreMat);
  core.position.set(0, 0.20, 0);
  root.add(core);

  // 4 delicate undulating oral arms
  const oralArms: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const r = 0.11;
    const x0 = Math.cos(a) * r;
    const z0 = Math.sin(a) * r;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, 0.10, z0),
      new THREE.Vector3(x0 * 1.4 + 0.08, -0.25, z0 * 1.3),
      new THREE.Vector3(x0 * 0.8 - 0.09, -0.62, z0 * 0.8),
      new THREE.Vector3(x0 * 1.2 + 0.05, -0.98, z0 * 1.1)
    ]);
    const armGeo = new THREE.TubeGeometry(curve, 18, 0.024, 6, false);
    const armMesh = new THREE.Mesh(armGeo, tentacleMat);
    root.add(armMesh);
    oralArms.push(armMesh);
  }

  // 8 fine trailing outer tentacles
  const tentacles: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = 0.42;
    const x0 = Math.cos(angle) * r;
    const z0 = Math.sin(angle) * r;
    const len = i % 2 === 0 ? 1.48 : 1.12;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, -0.02, z0),
      new THREE.Vector3(x0 * 0.92 + 0.07, -len * 0.34, z0 * 0.95),
      new THREE.Vector3(x0 * 0.78 - 0.08, -len * 0.68, z0 * 0.85),
      new THREE.Vector3(x0 * 0.88 + 0.04, -len, z0 * 0.9)
    ]);
    const tGeo = new THREE.TubeGeometry(curve, 18, 0.011, 5, false);
    const tMesh = new THREE.Mesh(tGeo, tentacleMat);
    root.add(tMesh);
    tentacles.push(tMesh);
  }

  return { root, bell, core, oralArms, tentacles };
}

/**
 * Low-poly 3D conical volcanic barnacle shell with beveled rim and recessed inner aperture.
 */
export function createBarnacleGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.115, 0.0),
    new THREE.Vector2(0.105, 0.03),
    new THREE.Vector2(0.068, 0.095),
    new THREE.Vector2(0.048, 0.115),
    new THREE.Vector2(0.032, 0.095),
    new THREE.Vector2(0.022, 0.03),
    new THREE.Vector2(0.0, 0.025)
  ];
  const geo = new THREE.LatheGeometry(pts, 7);
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Thick twisted-rope stump TubeGeometry drooping downward from an iron hull ring.
 */
export function createRopeStumpGeometry(
  length = 0.85,
  radius = 0.075,
  swaySign = 1
): { geometry: THREE.TubeGeometry; endPoint: THREE.Vector3 } {
  const endPoint = new THREE.Vector3(swaySign * 0.14, -length, 0.12);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(swaySign * 0.05, -length * 0.35, 0.08),
    new THREE.Vector3(swaySign * 0.11, -length * 0.72, 0.11),
    endPoint
  ]);
  const geometry = new THREE.TubeGeometry(curve, 14, radius, 8, false);
  return { geometry, endPoint };
}

/**
 * Splayed, frayed hemp fiber strand emerging from the cut end of a rope stump.
 */
export function createFrayedStrandGeometry(
  length = 0.34,
  spreadX = 0.08,
  spreadZ = 0.05
): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(spreadX * 0.45, -length * 0.45, spreadZ * 0.45),
    new THREE.Vector3(spreadX, -length, spreadZ)
  ]);
  return new THREE.TubeGeometry(curve, 8, 0.016, 5, false);
}

/**
 * Tapered, ruffled 3D kelp/seaweed ribbon geometry anchored at y = 0 (top or bottom)
 * so vertex shaders can animate smooth underwater current waves along its length.
 */
export function createKelpRibbonGeometry(
  width = 0.28,
  height = 2.6
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 4, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Shift so y runs from 0 (anchor) down to -height
    const ny = y - height * 0.5;
    const t = Math.abs(ny) / height;
    const taper = Math.sin(Math.min(1, t) * Math.PI * 0.85 + 0.15);
    const ruffle = Math.sin(t * 14.0) * 0.035;
    pos.setX(i, x * taper + ruffle);
    pos.setY(i, ny);
    pos.setZ(i, Math.cos(t * 10.0 + x * 4.0) * 0.04);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Chamfered L-shaped maritime corner gusset bracket (oriented for top-left;
 * mirror/rotate for other corners).
 */
export function createCornerGussetGeometry(
  armLength = 0.78,
  armWidth = 0.24,
  thickness = 0.08
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(armLength, 0);
  shape.lineTo(armLength, -armWidth);
  shape.lineTo(armWidth, -armWidth);
  shape.lineTo(armWidth, -armLength);
  shape.lineTo(0, -armLength);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2
  });
  geo.computeVertexNormals();
  return geo;
}
