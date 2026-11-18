import * as THREE from 'three';

export interface MetalPBRMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

/** Deterministic fast hash for procedural texture synthesis */
function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Smooth 2D value noise in [0, 1] */
function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2D(x: number, y: number, seed: number, octaves = 3): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise2D(x * freq, y * freq, seed + i * 19);
    freq *= 2.07;
    amp *= 0.5;
  }
  return value;
}

function buildNormalTextureFromHeight(
  heightField: Float32Array,
  width: number,
  height: number,
  strength: number
): THREE.DataTexture {
  const normalData = new Uint8Array(width * height * 4);
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

  const normalMap = new THREE.DataTexture(normalData, width, height, THREE.RGBAFormat);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.needsUpdate = true;
  return normalMap;
}

/**
 * Generates procedural PBR maps for pitted cast iron with salt residue specks
 * and damp condensation sheen streaks.
 */
export function createCastIronMaps(width = 256, height = 256): MetalPBRMaps {
  const colorData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      const castGrain = fbm2D(nx * 24, ny * 24, 11, 3);
      const pitNoise = hash2D(x, y, 37);
      const pit = pitNoise > 0.94 ? -0.35 : 0.0;
      const saltCluster = Math.max(0, fbm2D(nx * 14, ny * 14, 71, 2) - 0.64) * 2.5;
      const condensation = Math.max(0, fbm2D(nx * 6, ny * 18, 93, 2) - 0.52) * 2.0;

      const h = Math.max(0, Math.min(1, castGrain * 0.72 + pit + saltCluster * 0.15));
      heightField[y * width + x] = h;

      // Dark pitted iron (#242c36) + pale salt crust so PMREM & rim lights catch bevels
      const baseR = 36 + castGrain * 34 + saltCluster * 72;
      const baseG = 44 + castGrain * 38 + saltCluster * 78;
      const baseB = 54 + castGrain * 42 + saltCluster * 82;

      const idx = (y * width + x) * 4;
      colorData[idx] = Math.min(255, Math.round(baseR));
      colorData[idx + 1] = Math.min(255, Math.round(baseG));
      colorData[idx + 2] = Math.min(255, Math.round(baseB));
      colorData[idx + 3] = 255;

      // Wet condensation drops roughness down sharply for crisp metallic speculars
      const rough = Math.max(0.16, Math.min(0.88, 0.68 - condensation * 0.45 + saltCluster * 0.18));
      const roughByte = Math.round(rough * 255);
      roughnessData[idx] = roughByte;
      roughnessData[idx + 1] = roughByte;
      roughnessData[idx + 2] = roughByte;
      roughnessData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughnessData, width, height, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  const normalMap = buildNormalTextureFromHeight(heightField, width, height, 3.2);
  return { map, normalMap, roughnessMap };
}

/**
 * Generates procedural PBR maps for oxidized naval bronze with verdigris/salt patina
 * and wet condensation sheen.
 */
export function createOxidizedBronzeMaps(width = 256, height = 256): MetalPBRMaps {
  const colorData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      const brushed = fbm2D(nx * 36, ny * 8, 23, 3);
      const patina = Math.max(0, fbm2D(nx * 10, ny * 10, 53, 3) - 0.56) * 2.1;
      const condensation = Math.max(0, fbm2D(nx * 7, ny * 22, 83, 2) - 0.5) * 1.9;

      heightField[y * width + x] = brushed * 0.75 + patina * 0.25;

      // Tarnished naval bronze (#7b5d38) blended with subtle sea-verdigris (#2e6f68)
      const bronzeR = 96 + brushed * 62;
      const bronzeG = 72 + brushed * 48;
      const bronzeB = 42 + brushed * 28;

      const patinaMix = Math.min(0.65, patina * 0.75);
      const r = bronzeR * (1 - patinaMix) + 46 * patinaMix;
      const g = bronzeG * (1 - patinaMix) + 114 * patinaMix;
      const b = bronzeB * (1 - patinaMix) + 105 * patinaMix;

      const idx = (y * width + x) * 4;
      colorData[idx] = Math.min(255, Math.round(r));
      colorData[idx + 1] = Math.min(255, Math.round(g));
      colorData[idx + 2] = Math.min(255, Math.round(b));
      colorData[idx + 3] = 255;

      const rough = Math.max(0.16, Math.min(0.92, 0.44 + patinaMix * 0.42 - condensation * 0.28));
      const roughByte = Math.round(rough * 255);
      roughnessData[idx] = roughByte;
      roughnessData[idx + 1] = roughByte;
      roughnessData[idx + 2] = roughByte;
      roughnessData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughnessData, width, height, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  const normalMap = buildNormalTextureFromHeight(heightField, width, height, 2.8);
  return { map, normalMap, roughnessMap };
}

/**
 * Animated underwater caustic ShaderMaterial for the oil-filled porthole cavity
 * and deep aquarium floor.
 */
export function createCausticShaderMaterial(
  baseColorHex = 0x03111a,
  causticColorHex = 0x00e5ff,
  intensity = 0.45
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(baseColorHex) },
      uCausticColor: { value: new THREE.Color(causticColorHex) },
      uIntensity: { value: intensity }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uCausticColor;
      uniform float uIntensity;
      varying vec2 vUv;

      float causticPattern(vec2 uv, float t) {
        vec2 p = uv * 5.5;
        float c = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i) + 1.0;
          vec2 q = p + vec2(
            sin(p.y * 1.4 + t * (0.55 + fi * 0.14)),
            cos(p.x * 1.3 - t * (0.48 + fi * 0.11))
          ) * 0.55;
          float wave = abs(sin(q.x + q.y * 1.2 + t * 0.35));
          c += pow(1.0 - wave, 5.0) * (0.55 / fi);
          p *= 1.38;
        }
        return clamp(c, 0.0, 1.0);
      }

      void main() {
        float radial = 1.0 - smoothstep(0.15, 0.95, length(vUv - 0.5) * 1.7);
        float c = causticPattern(vUv, uTime) * radial;
        vec3 col = uBaseColor + uCausticColor * c * uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

/**
 * Custom HDR plasma ShaderMaterial for 3D bent-wire Nixie cathode numerals:
 * ice-cyan core (#B8FFFF) with a deep cyan halo (#00B8D4), exponential gas crossfade,
 * and ignition surge on digit transitions, tuned for UnrealBloomPass (threshold 0.92).
 */
export function createPlasmaNumeralMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color(0x6ef6ff) },
      uHaloColor: { value: new THREE.Color(0x00e5ff) },
      uUnlitColor: { value: new THREE.Color(0x101820) },
      uIntensity: { value: 0.0 },
      uActiveWeight: { value: 0.0 },
      uIgnitionSurge: { value: 0.0 },
      uOpacity: { value: 1.0 }
    },
    toneMapped: false,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCoreColor;
      uniform vec3 uHaloColor;
      uniform vec3 uUnlitColor;
      uniform float uIntensity;
      uniform float uActiveWeight;
      uniform float uIgnitionSurge;
      uniform float uOpacity;
      varying vec3 vNormalView;
      varying vec3 vViewDir;

      void main() {
        float ndotv = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
        float coreMask = pow(ndotv, 2.35);
        float surge = 1.0 + uIgnitionSurge * 0.45;
        vec3 litColor = mix(uHaloColor * 1.12, uCoreColor * 1.65, coreMask) * uIntensity * surge;
        vec3 finalColor = mix(uUnlitColor, litColor, uActiveWeight);
        gl_FragColor = vec4(finalColor, uOpacity);
      }
    `
  });
}

export interface CausticSwayUniforms {
  uTime: { value: number };
  uCausticStrength: { value: number };
}

/**
 * Injects live animated GLSL underwater caustics (and optional vertex-shader
 * underwater current wave) into a MeshStandardMaterial via onBeforeCompile.
 */
export function enhanceWithCausticsAndSway(
  material: THREE.MeshStandardMaterial,
  sharedUniforms: CausticSwayUniforms,
  options?: { swayAmplitude?: number; swaySpeed?: number }
): THREE.MeshStandardMaterial {
  const swayAmp = options?.swayAmplitude ?? 0.0;
  const swaySpd = options?.swaySpeed ?? 1.2;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = sharedUniforms.uTime;
    shader.uniforms.uCausticStrength = sharedUniforms.uCausticStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uCausticTime;
         varying vec3 vAbyssWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         ${
           swayAmp > 0
             ? `float swayMask = clamp(1.0 - uv.y, 0.0, 1.0);
                float wave1 = sin(uCausticTime * ${swaySpd.toFixed(2)} + position.y * 2.4 + position.x * 1.3);
                float wave2 = cos(uCausticTime * ${(swaySpd * 0.73).toFixed(2)} - position.y * 3.1);
                transformed.x += (wave1 * 0.7 + wave2 * 0.3) * ${swayAmp.toFixed(4)} * swayMask;
                transformed.z += (wave2 * 0.6 + wave1 * 0.4) * ${(swayAmp * 0.65).toFixed(4)} * swayMask;`
             : ''
         }`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vAbyssWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uCausticTime;
         uniform float uCausticStrength;
         varying vec3 vAbyssWorldPos;

         vec2 hash2Voronoi(vec2 p) {
           return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
         }

         float voronoiCausticLayer(vec2 x, float t) {
           vec2 n = floor(x);
           vec2 f = fract(x);
           float md = 8.0;
           for (int j = -1; j <= 1; j++) {
             for (int i = -1; i <= 1; i++) {
               vec2 g = vec2(float(i), float(j));
               vec2 o = hash2Voronoi(n + g);
               o = 0.5 + 0.45 * sin(t * 0.85 + 6.2831 * o);
               vec2 r = g + o - f;
               float d = dot(r, r);
               md = min(md, d);
             }
           }
           return pow(clamp(sqrt(md), 0.0, 1.0), 3.2);
         }

         float abyssCaustic(vec2 p, float t) {
           float c1 = voronoiCausticLayer(p * 0.72 + vec2(t * 0.06, -t * 0.04), t);
           float c2 = voronoiCausticLayer(p * 1.08 - vec2(t * 0.05, t * 0.07), t * 1.15);
           return clamp(c1 * 0.65 + c2 * 0.55, 0.0, 1.0);
         }`
      )
      .replace(
        '#include <dithering_fragment>',
        `float cVal = abyssCaustic(vAbyssWorldPos.xy + vAbyssWorldPos.z * 0.35, uCausticTime);
         gl_FragColor.rgb += vec3(0.05, 0.52, 0.62) * cVal * uCausticStrength;
         #include <dithering_fragment>`
      );
  };
  material.customProgramCacheKey = () =>
    `abyss_caustic_${swayAmp.toFixed(3)}_${swaySpd.toFixed(2)}`;
  return material;
}

/**
 * Soft, feathered volumetric light-shaft ShaderMaterial with Fresnel edge fade,
 * vertical depth attenuation, and animated caustic dust motes.
 */
export function createVolumetricConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x00d8ff) },
      uOpacity: { value: 0.16 }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 mvPos = viewMatrix * worldPos;
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        // Feathered top & bottom fade
        float verticalFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.08, vUv.y);
        // Soft Fresnel silhouette falloff so cone edges never look hard
        float ndotv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
        float edgeFeather = pow(ndotv, 2.6);

        // Subtle longitudinal light rays
        float ray1 = 0.72 + 0.28 * sin(vUv.x * 31.4159 + uTime * 0.45);
        float ray2 = 0.8 + 0.2 * cos(vUv.x * 50.265 - uTime * 0.32);

        // Animated caustic dust motes drifting inside the beam
        vec2 moteGrid = vWorldPos.xy * 2.8 + vec2(sin(uTime * 0.25) * 0.4, -uTime * 0.22);
        vec2 cell = floor(moteGrid);
        vec2 f = fract(moteGrid) - 0.5;
        float rnd = hash(cell);
        float mote = smoothstep(0.22, 0.02, length(f)) * step(0.72, rnd) * (0.5 + 0.5 * sin(uTime * 2.0 + rnd * 12.0));

        float alpha = uOpacity * verticalFade * edgeFeather * ray1 * ray2 + mote * verticalFade * edgeFeather * 0.22;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  });
}

/**
 * Translucent Fresnel rim-lit bioluminescent jellyfish bell ShaderMaterial.
 */
export function createJellyfishBellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uBaseColor: { value: new THREE.Color(0x0b3b54) },
      uRimColor: { value: new THREE.Color(0x5ef2ff) },
      uOpacity: { value: 0.62 }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float undulate = sin(uTime * 2.1 - pos.y * 5.2) * 0.045 * (1.0 - smoothstep(0.15, 0.45, pos.y));
        pos.x += pos.x * undulate * 2.2;
        pos.z += pos.z * undulate * 2.2;
        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPulse;
      uniform vec3 uBaseColor;
      uniform vec3 uRimColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDir;

      void main() {
        float ndotv = clamp(abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.2);
        float pulseWave = 0.65 + 0.35 * sin(vUv.y * 12.0 - uTime * 3.0);
        vec3 col = mix(uBaseColor, uRimColor * (1.1 + uPulse * 0.55), fresnel * pulseWave);
        float alpha = clamp(uOpacity * (0.32 + fresnel * 0.85), 0.15, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `
  });
}

/**
 * Recessed 3D CRT Sonar Gauge ShaderMaterial with rotating phosphor-cyan sweep beam,
 * concentric range rings, and reactive blip pulse.
 */
export function createCrtSonarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSweepAngle: { value: 0 },
      uIntensity: { value: 1.0 },
      uPingPulse: { value: 0.0 },
      uColor: { value: new THREE.Color(0x00f0ff) }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSweepAngle;
      uniform float uIntensity;
      uniform float uPingPulse;
      uniform vec3 uColor;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        vec3 col = vec3(0.008, 0.028, 0.042);

        // Concentric range rings
        float rings = smoothstep(0.025, 0.0, abs(fract(r * 3.0) - 0.5) - 0.475);
        col += uColor * rings * 0.22;

        // Crosshair axes
        float crossX = smoothstep(0.014, 0.0, abs(p.x));
        float crossY = smoothstep(0.014, 0.0, abs(p.y));
        col += uColor * max(crossX, crossY) * 0.14;

        // Rotating phosphor sweep beam with exponential persistence tail
        float angle = atan(p.y, p.x);
        float delta = mod(uSweepAngle - angle + 6.2831853, 6.2831853);
        float sweepTail = exp(-delta * 2.4) * step(delta, 2.2);
        float sweepLead = smoothstep(0.045, 0.0, delta);
        col += uColor * (sweepTail * 0.55 + sweepLead * 0.95) * (1.0 - r * 0.25);

        // Target contact blips illuminated when the sweep passes over them
        vec2 blipA = vec2(0.42, 0.34);
        vec2 blipB = vec2(-0.52, -0.22);
        float dA = length(p - blipA);
        float dB = length(p - blipB);
        float blipGlow = smoothstep(0.075, 0.01, dA) * (0.35 + 0.65 * sweepTail)
                       + smoothstep(0.065, 0.01, dB) * (0.25 + 0.75 * sweepTail);
        col += uColor * blipGlow * (1.1 + uPingPulse * 1.4);

        // CRT vignette + subtle scanlines
        float scanline = 0.92 + 0.08 * sin(vUv.y * 120.0);
        float vignette = smoothstep(1.0, 0.78, r);
        gl_FragColor = vec4(col * scanline * vignette * uIntensity, 1.0);
      }
    `
  });
}

/**
 * Generates a soft circular radial-gradient sprite texture for bubbles & plankton.
 */
export function createSoftParticleTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const dist = Math.hypot(dx, dy);
      const alpha = Math.max(0, Math.pow(1 - Math.min(1, dist), 1.8));
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates procedural PBR maps for weathered, waterlogged ship-timber oak planks
 * with dark water-stained seams, deep wood grain, and olive/teal marine algae patches.
 */
export function createShipwreckOakMaps(width = 256, height = 512): MetalPBRMaps {
  const colorData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  const plankCount = 6;
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;

      // Vertical plank seams
      const plankCoord = nx * plankCount;
      const plankIdx = Math.floor(plankCoord);
      const plankLocalX = plankCoord - plankIdx;
      const seamDist = Math.min(plankLocalX, 1 - plankLocalX);
      const seamFactor = seamDist < 0.045 ? 1.0 - seamDist / 0.045 : 0.0;

      // Deep oak grain + knots
      const grain = fbm2D(nx * 28 + plankIdx * 3.7, ny * 6.5 + plankIdx * 1.9, 17, 3);
      const fineFiber = Math.sin(nx * 190 + grain * 6.0) * 0.5 + 0.5;
      const waterStain = fbm2D(nx * 4.5, ny * 5.2, 41, 2);

      // Olive-green & deep-teal algae/moss patches concentrated near seams and damp pockets
      const algaeNoise = fbm2D(nx * 8.0, ny * 11.0, 67, 3);
      const algaeMask = Math.max(0, Math.min(1, (algaeNoise + seamFactor * 0.28 - 0.54) * 3.2));

      const h = Math.max(0, Math.min(1, (grain * 0.65 + fineFiber * 0.35) * (1 - seamFactor * 0.85)));
      heightField[y * width + x] = h;

      // Waterlogged dark oak (#261c14 to #453324) darkened at water stains & seams
      const stainDarken = 0.65 + waterStain * 0.35 - seamFactor * 0.52;
      let r = (36 + grain * 34 + fineFiber * 10) * stainDarken;
      let g = (27 + grain * 25 + fineFiber * 8) * stainDarken;
      let b = (19 + grain * 16 + fineFiber * 6) * stainDarken;

      // Blend dark olive-green / deep-teal marine algae
      const tealShift = fbm2D(nx * 12, ny * 12, 101, 2);
      const algaeR = 16 + tealShift * 12;
      const algaeG = 42 + tealShift * 18;
      const algaeB = 28 + tealShift * 22;

      r = r * (1 - algaeMask) + algaeR * algaeMask;
      g = g * (1 - algaeMask) + algaeG * algaeMask;
      b = b * (1 - algaeMask) + algaeB * algaeMask;

      const idx = (y * width + x) * 4;
      colorData[idx] = Math.max(0, Math.min(255, Math.round(r)));
      colorData[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      colorData[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      colorData[idx + 3] = 255;

      // Variable wet/matte roughness: wet seams & algae are glossier (~0.28), weathered oak matte (~0.82)
      const wetPatch = Math.max(algaeMask, seamFactor * 0.7, Math.max(0, waterStain - 0.55) * 1.6);
      const rough = Math.max(0.26, Math.min(0.88, 0.82 - wetPatch * 0.52));
      const roughByte = Math.round(rough * 255);
      roughnessData[idx] = roughByte;
      roughnessData[idx + 1] = roughByte;
      roughnessData[idx + 2] = roughByte;
      roughnessData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughnessData, width, height, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  const normalMap = buildNormalTextureFromHeight(heightField, width, height, 3.6);
  return { map, normalMap, roughnessMap };
}

/**
 * Generates procedural PBR maps for waterlogged twisted hemp rope.
 */
export function createTwistedRopeMaps(width = 128, height = 128): MetalPBRMaps {
  const colorData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);
  const heightField = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const helix = Math.sin((nx * 6.0 + ny * 14.0) * Math.PI * 2) * 0.5 + 0.5;
      const fiber = fbm2D(nx * 24, ny * 48, 31, 2);
      const h = helix * 0.7 + fiber * 0.3;
      heightField[y * width + x] = h;

      const idx = (y * width + x) * 4;
      colorData[idx] = Math.round(42 + h * 36);
      colorData[idx + 1] = Math.round(35 + h * 28);
      colorData[idx + 2] = Math.round(24 + h * 18);
      colorData[idx + 3] = 255;

      const roughByte = Math.round((0.55 + (1 - h) * 0.3) * 255);
      roughnessData[idx] = roughByte;
      roughnessData[idx + 1] = roughByte;
      roughnessData[idx + 2] = roughByte;
      roughnessData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, width, height, THREE.RGBAFormat);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughnessData, width, height, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  const normalMap = buildNormalTextureFromHeight(heightField, width, height, 3.0);
  return { map, normalMap, roughnessMap };
}
