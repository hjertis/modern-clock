import * as THREE from 'three';

export interface PlanetSurfaceMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
}

function configureDataTexture(
  data: Uint8Array,
  width: number,
  height: number,
  colorSpace: THREE.ColorSpace
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildNormalMapFromHeightField(
  heightField: Float32Array,
  width: number,
  height: number,
  strength: number
): THREE.DataTexture {
  const normalData = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const yPrev = Math.max(0, y - 1);
    const yNext = Math.min(height - 1, y + 1);
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
  return configureDataTexture(normalData, width, height, THREE.NoColorSpace);
}

/**
 * Generates procedural equirectangular Earth maps (continents, deep oceans, polar ice caps,
 * cloud wisps, and continental relief normal map) completely offline.
 */
export function createEarthPlanetMaps(width = 128, height = 64): PlanetSurfaceMaps {
  const colorData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const lat = (v - 0.5) * Math.PI;
    const absLat = Math.abs(v - 0.5) * 2.0;

    for (let x = 0; x < width; x++) {
      const u = x / width;
      const lon = u * Math.PI * 2.0;

      // Multi-octave spherical harmonics approximation for continents
      const contNoise =
        Math.sin(lon * 2.0 + Math.cos(lat * 3.0) * 1.4) * 0.42 +
        Math.cos(lon * 3.0 - lat * 4.0 + 0.7) * 0.31 +
        Math.sin(lon * 7.0 + lat * 6.0) * 0.16 +
        Math.cos(lon * 13.0 - lat * 9.0) * 0.11;

      const cloudSwirl =
        Math.sin(lon * 4.0 + Math.sin(lat * 7.0) * 2.1 + 1.2) *
        Math.cos(lat * 5.0 - lon * 2.0);
      const cloudCover = Math.max(0, (cloudSwirl - 0.34) * 1.25);

      const isPolarIce = absLat > 0.84 + Math.sin(lon * 5.0) * 0.04;
      const isLand = contNoise > 0.06;

      let r = 14;
      let g = 46;
      let b = 98;
      let elev = 0.1;

      if (isPolarIce) {
        r = 216;
        g = 228;
        b = 240;
        elev = 0.52;
      } else if (isLand) {
        const highland = Math.min(1, (contNoise - 0.06) * 2.2);
        r = Math.round(48 + highland * 88);
        g = Math.round(92 + highland * 54 - highland * highland * 26);
        b = Math.round(44 + highland * 28);
        elev = 0.45 + highland * 0.55;
      } else {
        const shallow = Math.max(0, 1 - (0.06 - contNoise) * 3.2);
        r = Math.round(12 + shallow * 18);
        g = Math.round(42 + shallow * 52);
        b = Math.round(96 + shallow * 54);
        elev = 0.1;
      }

      if (cloudCover > 0) {
        const c = Math.min(0.68, cloudCover);
        r = Math.round(r * (1 - c) + 236 * c);
        g = Math.round(g * (1 - c) + 242 * c);
        b = Math.round(b * (1 - c) + 248 * c);
      }

      heightField[y * width + x] = elev;
      const idx = (y * width + x) * 4;
      colorData[idx] = r;
      colorData[idx + 1] = g;
      colorData[idx + 2] = b;
      colorData[idx + 3] = 255;
    }
  }

  return {
    map: configureDataTexture(colorData, width, height, THREE.SRGBColorSpace),
    normalMap: buildNormalMapFromHeightField(heightField, width, height, 3.6)
  };
}

/**
 * Generates procedural lunar surface diffuse & crater bump normal maps.
 */
export function createLunarSurfaceMaps(width = 128, height = 64): PlanetSurfaceMaps {
  const colorData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  const craters: Array<{ u: number; v: number; r: number; depth: number }> = [
    { u: 0.24, v: 0.38, r: 0.11, depth: 0.45 },
    { u: 0.58, v: 0.46, r: 0.15, depth: 0.52 },
    { u: 0.78, v: 0.34, r: 0.09, depth: 0.4 },
    { u: 0.42, v: 0.66, r: 0.12, depth: 0.48 },
    { u: 0.14, v: 0.62, r: 0.08, depth: 0.35 },
    { u: 0.66, v: 0.24, r: 0.07, depth: 0.32 }
  ];

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const lon = u * Math.PI * 2.0;
      const lat = (v - 0.5) * Math.PI;

      // Broad lunar maria dark basins
      const mariaWave =
        Math.sin(lon * 2.0 + lat * 2.5) * 0.5 + Math.cos(lon * 3.0 - lat * 1.8) * 0.35;
      let shade = 0.58 + mariaWave * 0.22;
      let elev = 0.5 + mariaWave * 0.18;

      for (const c of craters) {
        let du = Math.abs(u - c.u);
        if (du > 0.5) du = 1.0 - du;
        const dv = v - c.v;
        const dist = Math.hypot(du, dv);
        if (dist < c.r) {
          const t = dist / c.r;
          // Raised rim near t=0.85, depressed bowl near center
          const rim = Math.exp(-Math.pow((t - 0.86) / 0.14, 2.0)) * 0.28;
          const bowl = (1.0 - t * t) * c.depth;
          elev += rim - bowl;
          shade += rim * 0.35 - bowl * 0.22;
        }
      }

      const micro = Math.sin(lon * 24.0 + lat * 19.0) * 0.05;
      heightField[y * width + x] = Math.max(0, Math.min(1, elev + micro));

      const lum = Math.max(48, Math.min(232, Math.round((shade + micro) * 215)));
      const idx = (y * width + x) * 4;
      colorData[idx] = lum;
      colorData[idx + 1] = Math.round(lum * 0.98);
      colorData[idx + 2] = Math.round(lum * 0.94);
      colorData[idx + 3] = 255;
    }
  }

  return {
    map: configureDataTexture(colorData, width, height, THREE.SRGBColorSpace),
    normalMap: buildNormalMapFromHeightField(heightField, width, height, 4.2)
  };
}

/**
 * Generates procedural banded atmosphere & Great Red Spot texture for Jupiter.
 */
export function createJovianBandTexture(width = 128, height = 64): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const turb = Math.sin(u * Math.PI * 6.0 + Math.cos(v * 24.0) * 1.8) * 0.03;
      const bv = v + turb;
      const band = Math.sin(bv * Math.PI * 11.0) * 0.5 + 0.5;
      const fine = Math.cos(bv * Math.PI * 23.0 + u * 8.0) * 0.5 + 0.5;
      const mix = band * 0.72 + fine * 0.28;

      let r = Math.round(138 + mix * 86);
      let g = Math.round(92 + mix * 84);
      let b = Math.round(62 + mix * 66);

      // Subtle Great Red Spot vortex
      const dSpot = Math.hypot((u - 0.62) * 1.8, (v - 0.61) * 3.4);
      if (dSpot < 0.16) {
        const spotMix = 1.0 - dSpot / 0.16;
        r = Math.round(r * (1 - spotMix) + 198 * spotMix);
        g = Math.round(g * (1 - spotMix) + 82 * spotMix);
        b = Math.round(b * (1 - spotMix) + 54 * spotMix);
      }

      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return configureDataTexture(data, width, height, THREE.SRGBColorSpace);
}

/**
 * Animated solar granulation & Fresnel coronal limb shader.
 * When `uEclipseFactor` approaches 1.0 (sleep mode), the inner disk occults
 * into dark obsidian shadow while leaving a delicate coronal ring.
 */
export function createSolarSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uCoreColor: { value: new THREE.Color(0xffb838) },
      uCoronaColor: { value: new THREE.Color(0xffe696) },
      uEmissiveIntensity: { value: 2.2 },
      uEclipseFactor: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        vLocalPos = position;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCoreColor;
      uniform vec3 uCoronaColor;
      uniform float uEmissiveIntensity;
      uniform float uEclipseFactor;

      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
        float rim = pow(1.0 - ndotv, 2.2);

        vec3 p = normalize(vLocalPos + vec3(0.0001));
        float g1 = sin(p.x * 13.0 + uTime * 1.9) * cos(p.y * 12.0 - uTime * 1.4);
        float g2 = sin(p.z * 17.0 - p.x * 9.0 + uTime * 2.6);
        float cells = smoothstep(-0.35, 0.85, g1 * 0.6 + g2 * 0.4);

        vec3 surfaceCol = mix(uCoreColor * 0.72, uCoronaColor, clamp(cells * 0.62 + rim * 0.78, 0.0, 1.0));
        float normalEnergy = (0.55 + cells * 0.58 + rim * 0.92) * uEmissiveIntensity;

        // Eclipse mode: occult center disk to deep shadow while preserving a narrow glowing rim ring
        float eclipseRing = pow(1.0 - ndotv, 5.2);
        float eclipseEnergy = eclipseRing * max(0.28, uEmissiveIntensity * 2.2);
        float finalEnergy = mix(normalEnergy, eclipseEnergy, clamp(uEclipseFactor, 0.0, 1.0));

        vec3 eclipseTint = mix(surfaceCol, uCoronaColor * 1.1, eclipseRing * uEclipseFactor);
        gl_FragColor = vec4(eclipseTint * finalEnergy, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true
  });
}

/**
 * Outer additive solar coronal flare shell that narrows into an eclipse halo when eclipsed.
 */
export function createSolarCoronaShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uColor: { value: new THREE.Color(0xffb838) },
      uIntensity: { value: 1.4 },
      uEclipseFactor: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        vLocalPos = position;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uEclipseFactor;

      varying vec3 vLocalPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;

      void main() {
        float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
        float normalHalo = pow(1.0 - ndotv, 2.6) * smoothstep(0.02, 0.35, ndotv);
        float eclipseRing = exp(-pow((ndotv - 0.16) / 0.075, 2.0));
        float shape = mix(normalHalo, eclipseRing, clamp(uEclipseFactor, 0.0, 1.0));

        float ray = 0.85 + 0.15 * sin(atan(vLocalPos.y, vLocalPos.x) * 9.0 + uTime * 2.1);
        float alpha = shape * ray * (0.55 - 0.2 * uEclipseFactor);
        gl_FragColor = vec4(uColor * uIntensity * shape * ray, clamp(alpha, 0.0, 0.95));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending
  });
}

/**
 * Deep-space sidereal starfield shader with subtle twinkling per star phase.
 */
export function createStarfieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uBrightness: { value: 1.0 },
      uTint: { value: new THREE.Color(0xdbe8ff) }
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aPhase;
      uniform float uTime;
      varying float vTwinkle;

      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vTwinkle = 0.65 + 0.35 * sin(uTime * 1.45 + aPhase);
        gl_PointSize = aScale * (115.0 / max(1.0, -mvPos.z));
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBrightness;
      uniform vec3 uTint;
      varying float vTwinkle;

      void main() {
        vec2 c = 2.0 * gl_PointCoord - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;

        float core = exp(-r2 * 5.2);
        vec3 col = uTint * (0.65 + core * 0.75) * vTwinkle * uBrightness;
        gl_FragColor = vec4(col, clamp((core * 1.1) * vTwinkle * uBrightness, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

function getAstrolabeHandPoints(length: number, width: number, inset = 0): Array<[number, number]> {
  const tail = Math.max(0.08, length * 0.22 - inset);
  const tip = Math.max(0.15, length - inset);
  const halfW = Math.max(0.025, width * 0.5 - inset);
  const ringCenterY = length * 0.58;

  return [
    [0, -tail],
    [halfW * 0.85, -tail * 0.5],
    [halfW * 0.58, 0],
    [halfW * 0.52, ringCenterY - width * 0.72],
    [halfW * 1.15, ringCenterY],
    [halfW * 0.52, ringCenterY + width * 0.72],
    [halfW * 0.28, tip * 0.86],
    [0, tip],
    [-halfW * 0.28, tip * 0.86],
    [-halfW * 0.52, ringCenterY + width * 0.72],
    [-halfW * 1.15, ringCenterY],
    [-halfW * 0.52, ringCenterY - width * 0.72],
    [-halfW * 0.58, 0],
    [-halfW * 0.85, -tail * 0.5]
  ];
}

function buildPolygonPath<T extends THREE.Path>(
  path: T,
  pts: Array<[number, number]>,
  reverse = false
): T {
  const ordered = reverse ? [...pts].reverse() : pts;
  path.moveTo(ordered[0][0], ordered[0][1]);
  for (let i = 1; i < ordered.length; i++) {
    path.lineTo(ordered[i][0], ordered[i][1]);
  }
  path.closePath();
  return path;
}

/**
 * Extrudes a skeletonized dark-obsidian astronomical astrolabe hand with an open sighting ring.
 */
export function createAstrolabeHandGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const shape = buildPolygonPath(new THREE.Shape(), getAstrolabeHandPoints(length, width));

  const ringHole = new THREE.Path();
  const holeRadius = Math.max(0.04, width * 0.34);
  ringHole.absarc(0, length * 0.58, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(ringHole);

  const bevel = Math.min(0.015, thickness * 0.25);
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
 * Extrudes a crisp gold/luminous edge trim around the astrolabe hand silhouette.
 */
export function createAstrolabeHandTrimGeometry(
  length: number,
  width: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const band = 0.024;
  const shape = buildPolygonPath(
    new THREE.Shape(),
    getAstrolabeHandPoints(length + band * 1.35, width + band * 1.35)
  );
  const innerHole = buildPolygonPath(
    new THREE.Path(),
    getAstrolabeHandPoints(length, width, 0.01),
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
 * Builds a slender comet-tail astronomical second hand oriented along +Y.
 */
export function createCometSecondHandGeometry(
  length: number,
  thickness = 0.04
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const tail = length * 0.28;
  const w = 0.02;

  shape.moveTo(0, -tail - 0.14);
  shape.lineTo(w * 2.2, -tail + 0.08);
  shape.lineTo(w * 0.8, 0);
  shape.lineTo(w * 0.62, length * 0.78);
  shape.lineTo(w * 1.65, length * 0.84);
  shape.lineTo(0, length);
  shape.lineTo(-w * 1.65, length * 0.84);
  shape.lineTo(-w * 0.62, length * 0.78);
  shape.lineTo(-w * 0.8, 0);
  shape.lineTo(-w * 2.2, -tail + 0.08);
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

