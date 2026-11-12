import * as THREE from 'three';

export interface WalnutWoodMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

/**
 * Generates procedural oiled-walnut diffuse (`map`), tangent-space `normalMap`,
 * and `roughnessMap` DataTextures so grazing light reveals 3D wood grain and pores.
 */
export function createWalnutWoodMaps(width = 256, height = 512): WalnutWoodMaps {
  const colorData = new Uint8Array(width * height * 4);
  const normalData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // Cathedral wood grain arches + fine vertical fiber striations + deep vessel pores
      const arch =
        Math.sin((nx - 0.5) * 10.5 + Math.sin(ny * 6.8) * 0.52) * 15.0 +
        Math.cos(ny * 20.0 + nx * 3.4) * 4.8;
      const ringWave = Math.sin(arch) * 0.5 + 0.5;
      const fineFiber = Math.sin(nx * 210.0 + Math.sin(ny * 44.0) * 2.8) * 0.5 + 0.5;
      const vesselPore = Math.pow(Math.cos(nx * 110.0 - ny * 180.0) * 0.5 + 0.5, 3.0);

      const grain = ringWave * 0.58 + fineFiber * 0.28 + vesselPore * 0.14;
      heightField[y * width + x] = grain;

      // Oiled dark walnut color (#1c0e07 to #4a2715)
      const r = Math.round(26 + grain * 48);
      const g = Math.round(13 + grain * 26);
      const b = Math.round(7 + grain * 15);

      const idx = (y * width + x) * 4;
      colorData[idx] = r;
      colorData[idx + 1] = g;
      colorData[idx + 2] = b;
      colorData[idx + 3] = 255;

      // Matte oiled walnut roughness map (0.86 to 1.0 multiplier on base 0.8 roughness)
      const roughVal = Math.round((1.0 - grain * 0.14) * 255);
      roughnessData[idx] = roughVal;
      roughnessData[idx + 1] = roughVal;
      roughnessData[idx + 2] = roughVal;
      roughnessData[idx + 3] = 255;
    }
  }

  // Compute tangent-space normal map from heightField using Sobel finite differences
  const strength = 3.8;
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

  const map = new THREE.DataTexture(colorData, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normalData, width, height, THREE.RGBAFormat);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughnessData, width, height, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  return { map, normalMap, roughnessMap };
}

/**
 * Backwards-compatible helper returning the walnut diffuse texture.
 */
export function createWalnutGrainTexture(width = 256, height = 512): THREE.DataTexture {
  return createWalnutWoodMaps(width, height).map;
}

export interface InvoluteGearParams {
  teeth: number;
  pitchRadius: number;
  thickness: number;
  spokes?: number;
  hubRadius?: number;
}

/**
 * Builds an extruded 3D involute-profiled brass gear with prominent beveled teeth,
 * arched spoke cutouts, and central arbor bore.
 */
export function createInvoluteGearGeometry(params: InvoluteGearParams): THREE.ExtrudeGeometry {
  const { teeth, pitchRadius, thickness, spokes = 5 } = params;
  const moduleVal = (2 * pitchRadius) / teeth;
  const addendum = moduleVal * 0.92;
  const dedendum = moduleVal * 1.12;
  const outerRadius = pitchRadius + addendum;
  const rootRadius = Math.max(0.08, pitchRadius - dedendum);
  const rimInnerRadius = rootRadius * 0.84;
  const hubRadius = params.hubRadius ?? Math.max(0.14, rootRadius * 0.3);
  const boreRadius = Math.max(0.045, hubRadius * 0.42);

  const shape = new THREE.Shape();
  const stepAngle = (Math.PI * 2) / teeth;

  for (let i = 0; i < teeth; i++) {
    const baseAngle = i * stepAngle;
    const a0 = baseAngle - stepAngle * 0.36;
    const a1 = baseAngle - stepAngle * 0.24;
    const a2 = baseAngle - stepAngle * 0.11;
    const a3 = baseAngle + stepAngle * 0.11;
    const a4 = baseAngle + stepAngle * 0.24;
    const a5 = baseAngle + stepAngle * 0.36;

    const p0x = Math.cos(a0) * rootRadius;
    const p0y = Math.sin(a0) * rootRadius;
    if (i === 0) {
      shape.moveTo(p0x, p0y);
    } else {
      shape.lineTo(p0x, p0y);
    }

    shape.lineTo(Math.cos(a1) * pitchRadius, Math.sin(a1) * pitchRadius);
    shape.lineTo(Math.cos(a2) * outerRadius, Math.sin(a2) * outerRadius);
    shape.lineTo(Math.cos(a3) * outerRadius, Math.sin(a3) * outerRadius);
    shape.lineTo(Math.cos(a4) * pitchRadius, Math.sin(a4) * pitchRadius);
    shape.lineTo(Math.cos(a5) * rootRadius, Math.sin(a5) * rootRadius);
  }
  shape.closePath();

  // Central arbor bore
  const boreHole = new THREE.Path();
  boreHole.absarc(0, 0, boreRadius, 0, Math.PI * 2, true);
  shape.holes.push(boreHole);

  // Skeletonized wheel windows between spokes
  if (rimInnerRadius > hubRadius * 1.35 && spokes >= 3) {
    const spokeSector = (Math.PI * 2) / spokes;
    const angularMargin = Math.min(0.24, spokeSector * 0.22);
    const innerR = hubRadius * 1.15;
    const outerR = rimInnerRadius * 0.94;

    for (let s = 0; s < spokes; s++) {
      const startA = s * spokeSector + angularMargin;
      const endA = (s + 1) * spokeSector - angularMargin;
      if (endA <= startA + 0.08) continue;

      const cutout = new THREE.Path();
      cutout.moveTo(Math.cos(startA) * innerR, Math.sin(startA) * innerR);
      cutout.lineTo(Math.cos(startA) * outerR, Math.sin(startA) * outerR);
      cutout.absarc(0, 0, outerR, startA, endA, false);
      cutout.lineTo(Math.cos(endA) * innerR, Math.sin(endA) * innerR);
      cutout.absarc(0, 0, innerR, endA, startA, true);
      shape.holes.push(cutout);
    }
  }

  const bevelThickness = Math.min(0.028, thickness * 0.28);
  const bevelSize = Math.min(0.024, moduleVal * 0.22);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 3,
    curveSegments: 18
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an extruded 3D skeletonized cathedral hand (hour or minute) oriented along +Y (12 o'clock).
 */
export function createCathedralHandGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const tail = length * 0.22;
  const halfW = width * 0.5;
  const spadeStart = length * 0.52;
  const spadePeak = length * 0.78;

  shape.moveTo(0, -tail);
  shape.lineTo(halfW * 0.72, -tail * 0.55);
  shape.lineTo(halfW * 0.45, 0);
  shape.lineTo(halfW * 0.58, spadeStart);
  shape.lineTo(halfW * 1.45, spadePeak);
  shape.lineTo(0, length);
  shape.lineTo(-halfW * 1.45, spadePeak);
  shape.lineTo(-halfW * 0.58, spadeStart);
  shape.lineTo(-halfW * 0.45, 0);
  shape.lineTo(-halfW * 0.72, -tail * 0.55);
  shape.closePath();

  const stemSlot = new THREE.Path();
  const slotW = halfW * 0.24;
  stemSlot.moveTo(-slotW, length * 0.14);
  stemSlot.lineTo(slotW, length * 0.14);
  stemSlot.lineTo(slotW * 0.85, spadeStart * 0.92);
  stemSlot.lineTo(-slotW * 0.85, spadeStart * 0.92);
  stemSlot.closePath();
  shape.holes.push(stemSlot);

  const spadeHole = new THREE.Path();
  spadeHole.moveTo(0, spadeStart * 1.04);
  spadeHole.lineTo(halfW * 0.82, spadePeak);
  spadeHole.lineTo(0, length * 0.91);
  spadeHole.lineTo(-halfW * 0.82, spadePeak);
  spadeHole.closePath();
  shape.holes.push(spadeHole);

  const bevel = Math.min(0.018, thickness * 0.3);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an extruded Breguet-style second hand with counterpoise ring along +Y.
 */
export function createSecondHandGeometry(length: number, thickness = 0.04): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const tail = length * 0.28;
  const w = 0.034;

  shape.moveTo(-w * 1.4, -tail);
  shape.lineTo(w * 1.4, -tail);
  shape.lineTo(w, length * 0.65);
  shape.lineTo(0, length);
  shape.lineTo(-w, length * 0.65);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.008,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a 3D multi-turn spiral Breguet hairspring coil geometry.
 */
export function createHairspringGeometry(
  innerRadius = 0.09,
  outerRadius = 0.36,
  turns = 4.5,
  wireRadius = 0.012
): THREE.TubeGeometry {
  const points: THREE.Vector3[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const r = innerRadius + (outerRadius - innerRadius) * t;
    const zLift = t > 0.85 ? ((t - 0.85) / 0.15) * 0.04 : 0;
    points.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, zLift));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 120, wireRadius, 8, false);
}

/**
 * Builds a heavy biconvex horological lens-shaped pendulum bob using LatheGeometry,
 * rotated so its broad lens faces point along +/-Z toward the viewer.
 */
export function createLensBobGeometry(radius = 1.24, halfThickness = 0.38): THREE.BufferGeometry {
  const profilePoints: THREE.Vector2[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = t * 2 - 1;
    const r = radius * Math.sqrt(Math.max(0, 1 - u * u * 0.92));
    const y = u * halfThickness;
    profilePoints.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(profilePoints, 56);
  geo.rotateX(Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a custom Fresnel edge-fade + vertical gradient volumetric light shader material
 * so the spotlight beam dissolves seamlessly into zero alpha with no hard cone borders.
 */
export function createVolumetricBeamMaterial(initialOpacity = 0.11): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffcc7a) },
      uOpacity: { value: initialOpacity },
      uTime: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        // Fresnel silhouette fade: dissolves to 0.0 at grazing edges
        float ndotv = abs(dot(normalize(vViewNormal), normalize(vViewDir)));
        float fresnel = pow(smoothstep(0.08, 0.95, ndotv), 2.6);

        // Vertical gradient fade: soft source entry at top and gradual atmospheric dissolve at bottom
        float topFade = smoothstep(1.0, 0.72, vUv.y);
        float bottomFade = smoothstep(0.0, 0.42, vUv.y);
        float verticalGrad = topFade * bottomFade;

        // Subtle volumetric light rays drifting slowly
        float ray1 = sin(vUv.x * 18.8495 + uTime * 0.35) * 0.5 + 0.5;
        float ray2 = cos(vUv.x * 31.4159 - uTime * 0.22 + vUv.y * 2.5) * 0.5 + 0.5;
        float shaftMod = 0.72 + 0.28 * (ray1 * 0.6 + ray2 * 0.4);

        float alpha = fresnel * verticalGrad * shaftMod * uOpacity;
        gl_FragColor = vec4(uColor * (1.1 + 0.35 * fresnel), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending
  });
}

/**
 * Creates a soft golden bokeh dust mote particle shader material (`THREE.Points`).
 * Color values are kept below 0.7 and opacity at 0.25 so dust motes never trigger bloom.
 */
export function createBokehDustMaterial(initialOpacity = 0.25): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0.64, 0.51, 0.34) },
      uOpacity: { value: initialOpacity },
      uTime: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aPhase;
      uniform float uTime;
      varying float vTwinkle;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // Gentle golden twinkle as dust motes tumble through the spotlight beam
        vTwinkle = 0.55 + 0.45 * sin(uTime * 1.8 + aPhase);
        gl_PointSize = aScale * (145.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTwinkle;

      void main() {
        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
        float r2 = dot(cxy, cxy);
        if (r2 > 1.0) discard;

        // Soft bokeh disc with feathered halo; peak RGB stays < 0.7
        float core = exp(-r2 * 4.2);
        float halo = smoothstep(1.0, 0.15, r2) * 0.45;
        float alpha = (core + halo) * vTwinkle * uOpacity;

        gl_FragColor = vec4(uColor * (0.65 + core * 0.35), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}
