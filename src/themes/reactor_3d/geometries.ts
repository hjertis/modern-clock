import * as THREE from 'three';

export interface TitaniumBulkheadMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

/**
 * Generates brushed gunmetal titanium diffuse (#161920 to #272b35), tangent-space normal,
 * and roughness DataTextures with recessed seam grooves so grazing cyan rim lighting casts crisp highlights.
 */
export function createTitaniumBulkheadMaps(width = 256, height = 512): TitaniumBulkheadMaps {
  const colorData = new Uint8Array(width * height * 4);
  const normalData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    const seamY = Math.abs(((ny * 4.0) % 1.0) - 0.5);
    const grooveY = seamY < 0.015 ? -0.45 : 0.0;

    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const seamX = Math.abs(((nx * 2.0) % 1.0) - 0.5);
      const grooveX = seamX < 0.014 ? -0.42 : 0.0;

      // Fine vertical brushed titanium grain + subtle micro-machining ripples
      const brushFine = Math.sin(nx * 320.0 + Math.sin(ny * 36.0) * 1.4) * 0.5 + 0.5;
      const brushBroad = Math.sin(nx * 54.0 + ny * 18.0) * 0.5 + 0.5;
      const microPit = Math.pow(Math.cos(nx * 140.0 + ny * 210.0) * 0.5 + 0.5, 4.0);

      const grain = Math.max(
        0,
        Math.min(1, brushFine * 0.52 + brushBroad * 0.34 + microPit * 0.14 + grooveX + grooveY)
      );
      heightField[y * width + x] = grain;

      // Dark brushed gunmetal titanium (#161920 to #272b35)
      const r = Math.round(22 + grain * 18);
      const g = Math.round(25 + grain * 20);
      const b = Math.round(32 + grain * 24);

      const idx = (y * width + x) * 4;
      colorData[idx] = r;
      colorData[idx + 1] = g;
      colorData[idx + 2] = b;
      colorData[idx + 3] = 255;

      // Roughness variation (0.72 to 1.0 multiplier)
      const roughVal = Math.round((1.0 - grain * 0.28) * 255);
      roughnessData[idx] = roughVal;
      roughnessData[idx + 1] = roughVal;
      roughnessData[idx + 2] = roughVal;
      roughnessData[idx + 3] = 255;
    }
  }

  // Sobel tangent-space normal map
  const strength = 3.2;
  for (let y = 0; y < height; y++) {
    const yPrev = (y - 1 + height) % height;
    const yNext = (y + 1) % height;
    for (let x = 0; x < width; x++) {
      const xPrev = (x - 1 + width) % width;
      const xNext = (x + 1) % width;

      const dX = (heightField[y * width + xNext] - heightField[y * width + xPrev]) * strength;
      const dY = (heightField[yNext * width + x] - heightField[yPrev * width + x]) * strength;

      let nx = -dX;
      let ny = -dY;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * width + x) * 4;
      normalData[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  const configureTex = (data: Uint8Array, colorSpace: THREE.ColorSpace): THREE.DataTexture => {
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = colorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    map: configureTex(colorData, THREE.SRGBColorSpace),
    normalMap: configureTex(normalData, THREE.NoColorSpace),
    roughnessMap: configureTex(roughnessData, THREE.NoColorSpace)
  };
}

/**
 * Custom animated Fresnel + multi-layer turbulence plasma shader for the Tokamak reactor core.
 */
export function createPlasmaCoreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uCoreColor: { value: new THREE.Color(0x00e5ff) },
      uRimColor: { value: new THREE.Color(0x52f6ff) },
      uEmissiveIntensity: { value: 2.0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        vLocalPos = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCoreColor;
      uniform vec3 uRimColor;
      uniform float uEmissiveIntensity;

      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.8);

        // High-contrast helical magnetic filament ridges with dark containment troughs
        vec3 p = normalize(vLocalPos + vec3(0.0001));
        float ridge1 = pow(abs(sin(p.x * 10.0 + p.y * 7.5 - uTime * 3.1)), 2.6);
        float ridge2 = pow(abs(cos(p.y * 12.0 - p.z * 9.0 + uTime * 2.4)), 2.8);
        float ridge3 = pow(abs(sin((p.x - p.z) * 15.0 + uTime * 4.2)), 2.4);
        float filaments = smoothstep(0.16, 0.88, ridge1 * 0.48 + ridge2 * 0.34 + ridge3 * 0.18);

        // Preserve deep dark magnetic troughs inside the core so filaments stay distinct
        vec3 darkTrough = uCoreColor * 0.14;
        vec3 brightFilament = mix(uCoreColor, uRimColor, clamp(filaments * 0.55 + fresnel * 0.65, 0.0, 1.0));
        vec3 coreCol = mix(darkTrough, brightFilament, clamp(filaments * 0.88 + fresnel * 0.72, 0.0, 1.0));

        float energy = (0.14 + filaments * 0.92 + fresnel * 0.95) * uEmissiveIntensity;
        gl_FragColor = vec4(coreCol * energy, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true
  });
}

/**
 * Rising Cherenkov coolant bubble/particle shader material (`THREE.Points`) inside glass tubes.
 */
export function createCoolantParticleMaterial(initialOpacity = 0.85): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(0x00f0ff) },
      uIntensity: { value: 1.95 },
      uOpacity: { value: initialOpacity }
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aPhase;
      uniform float uTime;
      varying float vPulse;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vPulse = 0.6 + 0.4 * sin(uTime * 3.2 + aPhase);
        gl_PointSize = aScale * (135.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uOpacity;
      varying float vPulse;

      void main() {
        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
        float r2 = dot(cxy, cxy);
        if (r2 > 1.0) discard;

        float core = exp(-r2 * 4.5);
        float halo = smoothstep(1.0, 0.1, r2) * 0.5;
        float alpha = (core + halo) * vPulse * uOpacity;
        vec3 col = uColor * uIntensity * (0.75 + core * 0.65);

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

function getReactorHandPoints(length: number, width: number, inset = 0): Array<[number, number]> {
  const tail = Math.max(0.05, length * 0.2 - inset);
  const tip = Math.max(0.1, length - inset);
  const halfW = Math.max(0.02, width * 0.5 - inset);
  const shoulderY = length * 0.62;
  const peakY = length * 0.78;

  return [
    [0, -tail],
    [halfW * 0.95, -tail * 0.55],
    [halfW * 0.78, 0],
    [halfW * 0.68, shoulderY],
    [halfW, peakY],
    [0, tip],
    [-halfW, peakY],
    [-halfW * 0.68, shoulderY],
    [-halfW * 0.78, 0],
    [-halfW * 0.95, -tail * 0.55]
  ];
}

function buildPolygonPath<T extends THREE.Path>(path: T, pts: Array<[number, number]>, reverse = false): T {
  const ordered = reverse ? [...pts].reverse() : pts;
  path.moveTo(ordered[0][0], ordered[0][1]);
  for (let i = 1; i < ordered.length; i++) {
    path.lineTo(ordered[i][0], ordered[i][1]);
  }
  path.closePath();
  return path;
}

/**
 * Builds an extruded 3D skeletonized industrial truss hand oriented along +Y (12 o'clock).
 */
export function createReactorHandGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const shape = buildPolygonPath(new THREE.Shape(), getReactorHandPoints(length, width));
  const halfW = width * 0.5;
  const shoulderY = length * 0.62;

  // Skeletonized truss cutout along the main beam
  const slot = new THREE.Path();
  const slotW = halfW * 0.24;
  slot.moveTo(-slotW, length * 0.16);
  slot.lineTo(slotW, length * 0.16);
  slot.lineTo(slotW * 0.78, shoulderY * 0.92);
  slot.lineTo(-slotW * 0.78, shoulderY * 0.92);
  slot.closePath();
  shape.holes.push(slot);

  const bevel = Math.min(0.016, thickness * 0.28);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a crisp perimeter luminous edge-trim frame matching the reactor hand silhouette.
 */
export function createReactorHandEdgeTrimGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const trimBand = 0.028;
  const shape = buildPolygonPath(
    new THREE.Shape(),
    getReactorHandPoints(length + trimBand * 1.4, width + trimBand * 1.4)
  );
  const innerHole = buildPolygonPath(
    new THREE.Path(),
    getReactorHandPoints(length, width, 0.012),
    true
  );
  shape.holes.push(innerHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a razor-thin counterpoised needle geometry oriented along +Y for the glowing cyan second hand.
 */
export function createReactorSecondHandGeometry(
  length: number,
  thickness = 0.042
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const tail = length * 0.26;
  const w = 0.024;

  shape.moveTo(-w * 1.6, -tail);
  shape.lineTo(w * 1.6, -tail);
  shape.lineTo(w * 0.75, length * 0.72);
  shape.lineTo(0, length);
  shape.lineTo(-w * 0.75, length * 0.72);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a 3D helical copper winding geometry for the induction pendulum bob and flanking stator coils.
 */
export function createInductionCoilGeometry(
  radius = 0.56,
  height = 1.35,
  turns = 12,
  wireRadius = 0.038
): THREE.TubeGeometry {
  const points: THREE.Vector3[] = [];
  const steps = Math.max(48, Math.round(turns * 18));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const y = (t - 0.5) * height;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, steps, wireRadius, 8, false);
}

/**
 * Allocates a reusable multi-segment 3D tube BufferGeometry whose vertex positions
 * can be updated in-place every frame for dynamic air-gap plasma arcs.
 */
export function createDynamicArcBoltGeometry(
  segments = 10,
  radialSides = 6
): THREE.BufferGeometry {
  const ringCount = segments + 1;
  const positions = new Float32Array(ringCount * radialSides * 3);
  const indices: number[] = [];

  for (let i = 0; i < segments; i++) {
    const rowA = i * radialSides;
    const rowB = (i + 1) * radialSides;
    for (let s = 0; s < radialSides; s++) {
      const nextS = (s + 1) % radialSides;
      const a = rowA + s;
      const b = rowA + nextS;
      const c = rowB + s;
      const d = rowB + nextS;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setIndex(indices);
  return geo;
}

/**
 * Updates a dynamic plasma arc bolt geometry in-place between two 3D endpoints
 * with procedural jagged transverse displacement (zero heap allocations).
 */
export function updateDynamicArcBoltGeometry(
  geometry: THREE.BufferGeometry,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  radius: number,
  segments: number,
  radialSides: number,
  phase: number,
  seedOffset: number,
  jitterAmp: number
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;

  const dx = endX - startX;
  const dy = endY - startY;
  const dz = endZ - startZ;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const tx = dx / len;
  const ty = dy / len;
  const tz = dz / len;

  // Compute orthonormal transverse basis (u1, u2) perpendicular to chord tangent t
  const refX = Math.abs(tz) < 0.9 ? 0 : 1;
  const refZ = Math.abs(tz) < 0.9 ? 1 : 0;
  const c1x = ty * refZ;
  const c1y = tz * refX - tx * refZ;
  const c1z = -ty * refX;
  const c1Len = Math.hypot(c1x, c1y, c1z) || 1e-4;
  const u1x = c1x / c1Len;
  const u1y = c1y / c1Len;
  const u1z = c1z / c1Len;

  const u2x = ty * u1z - tz * u1y;
  const u2y = tz * u1x - tx * u1z;
  const u2z = tx * u1y - ty * u1x;

  let writeIdx = 0;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const env = Math.sin(u * Math.PI);
    const j1 =
      (Math.sin(i * 2.71 + phase + seedOffset) +
        0.58 * Math.cos(i * 5.43 - phase * 1.37 + seedOffset * 1.9)) *
      0.65;
    const j2 =
      (Math.cos(i * 3.19 - phase * 1.15 + seedOffset * 2.3) +
        0.52 * Math.sin(i * 6.17 + phase * 0.89 - seedOffset)) *
      0.65;

    const offsetScale = env * jitterAmp;
    const cx = startX + dx * u + (u1x * j1 + u2x * j2) * offsetScale;
    const cy = startY + dy * u + (u1y * j1 + u2y * j2) * offsetScale;
    const cz = startZ + dz * u + (u1z * j1 + u2z * j2) * offsetScale;
    const r = radius * (0.55 + 0.45 * env);

    for (let s = 0; s < radialSides; s++) {
      const ang = (s / radialSides) * Math.PI * 2;
      const cosA = Math.cos(ang) * r;
      const sinA = Math.sin(ang) * r;
      arr[writeIdx++] = cx + u1x * cosA + u2x * sinA;
      arr[writeIdx++] = cy + u1y * cosA + u2y * sinA;
      arr[writeIdx++] = cz + u1z * cosA + u2z * sinA;
    }
  }

  posAttr.needsUpdate = true;
}


