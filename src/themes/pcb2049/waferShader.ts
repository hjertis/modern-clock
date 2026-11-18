import * as THREE from 'three';
import { PcbThemeVariant } from './constants';

/**
 * Custom GLSL Thin-Film Interference & Diffraction Grating ShaderMaterial
 * for the Zone 03 Diced Monocrystalline Silicon Wafer Pendulum Bob.
 *
 * Computes view-dependent and light-incidence spectral iridescence across
 * microscopic photolithography die grids, scribe streets, and sub-micron
 * grating pitches keyed to the pendulum's real-time swing angle θ(t).
 */

const WAFER_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    // Map standard CircleGeometry UVs [0, 1] -> [-1, 1]
    vUv = uv * 2.0 - 1.0;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WAFER_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  uniform float uSwingAngleRad;
  uniform float uAngularVel;
  uniform float uTimeSec;
  uniform float uVariant;
  uniform float uDimFactor;
  uniform vec3 uLightDir;

  // Physical thin-film interference spectral rainbow
  vec3 spectralRainbow(float t) {
    vec3 c = 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.00, 0.33, 0.67)));
    return pow(c, vec3(0.88));
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float r = length(uv);

    if (r > 0.995) {
      discard;
    }

    // SEMI standard wafer orientation notch at bottom (uv.y ~ -0.975, uv.x ~ 0.0)
    vec2 notchPos = vec2(0.0, -0.975);
    if (length(uv - notchPos) < 0.055) {
      discard;
    }

    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);

    // View-dependent Fresnel & grazing angle terms
    float ndotv = max(dot(N, V), 0.0);
    float ndoth = max(dot(N, H), 0.0);
    float fresnel = pow(1.0 - ndotv, 3.0);

    // Light incidence projected onto wafer plane modulated by pendulum swing angle
    vec2 swingAxis = vec2(cos(uSwingAngleRad), sin(uSwingAngleRad));
    float incidenceShift = dot(H.xy, swingAxis) * 1.45 + (1.0 - ndotv) * 1.8;

    // Wafer edge exclusion zone (outer 4% bevel ring)
    float edgeZone = smoothstep(0.91, 0.94, r);

    // Photolithography die grid (8.5 x 8.5 dies across radius)
    float gridScale = 8.5;
    vec2 dieCoord = uv * gridScale;
    vec2 dieId = floor(dieCoord);
    vec2 dieUv = fract(dieCoord);

    float streetWidth = 0.058;
    float inStreetX = step(dieUv.x, streetWidth) + step(1.0 - streetWidth, dieUv.x);
    float inStreetY = step(dieUv.y, streetWidth) + step(1.0 - streetWidth, dieUv.y);
    float majorCross = step(abs(uv.x), 0.011) + step(abs(uv.y), 0.011);
    float isStreet = clamp(inStreetX + inStreetY + majorCross, 0.0, 1.0);

    vec2 innerUv = clamp((dieUv - streetWidth) / (1.0 - 2.0 * streetWidth), 0.0, 1.0);
    vec2 subBlockId = floor(innerUv * vec2(3.0, 3.0));
    float subHash = hash21(dieId * 9.17 + subBlockId);
    float dieHash = hash21(dieId + vec2(13.7, 29.3));

    // Sub-micron diffraction grating pitch per IC sub-block
    float gratingFreq = 38.0 + floor(subHash * 4.0) * 16.0;
    bool horizontalGrating = mod(subBlockId.x + subBlockId.y, 2.0) < 0.5;
    float gratingAxis = horizontalGrating ? innerUv.x : innerUv.y;
    vec2 gratingDir = horizontalGrating ? vec2(1.0, 0.15) : vec2(0.15, 1.0);
    float microGrating = 0.5 + 0.5 * sin(gratingAxis * gratingFreq * 6.283185);

    // Polished monocrystalline dark silicon base
    vec3 baseSilicon = vec3(0.045, 0.068, 0.115) + vec3(0.018, 0.025, 0.04) * subHash;
    baseSilicon *= (0.80 + 0.20 * microGrating);

    // Thin-film diffraction grating phase keyed to swing angle, view vector & light incidence
    float swingPhase = uSwingAngleRad * 4.5 + uAngularVel * 0.22;
    float spatialPhase = dot(uv, normalize(gratingDir)) * 0.85 + subHash * 0.72 + dieHash * 0.45;
    float diffractionPhase = spatialPhase + swingPhase + incidenceShift;

    vec3 rainbow = spectralRainbow(diffractionPhase);
    vec3 secondaryRainbow = spectralRainbow(diffractionPhase * 1.35 + 0.28);

    // Diagonal specular diffraction lobe sweeping across the wafer
    vec2 diagPerp = normalize(vec2(-0.7071, 0.7071));
    float dPerp = dot(uv, diagPerp) - sin(uSwingAngleRad * 3.2) * 0.16 - H.x * 0.25;
    float primaryLobe = exp(-abs(dPerp) * 4.8);
    float sharpLobe = exp(-abs(dPerp) * 16.0);

    float activeMask = (1.0 - isStreet * 0.84) * (1.0 - edgeZone);

    vec3 color = baseSilicon;

    // Blend vivid thin-film rainbow interference across active die sub-blocks
    float rainbowStrength = (0.36 + 0.42 * microGrating + 0.22 * fresnel) * activeMask;
    color = mix(color, rainbow * 0.76, rainbowStrength);

    // Add emerald variant diagonal cyan/magenta flare accent when enabled, or gold-cyan-violet flare
    if (uVariant > 0.5) {
      vec3 cyanFlare = vec3(0.18, 0.84, 0.88);
      vec3 magentaFlare = vec3(0.76, 0.22, 0.86);
      color += mix(magentaFlare, cyanFlare, 0.5 + 0.5 * sin(diffractionPhase * 6.283185)) * primaryLobe * activeMask * 0.45;
      color += vec3(0.70, 0.86, 0.88) * sharpLobe * 0.35 * (1.0 - edgeZone);
    } else {
      color += secondaryRainbow * primaryLobe * activeMask * (0.42 + 0.22 * microGrating);
      color += vec3(0.74, 0.82, 0.86) * sharpLobe * pow(ndoth, 18.0) * 0.42 * (1.0 - edgeZone);
    }

    // Crisp dark metallic scribe streets between diced dies
    vec3 streetColor = vec3(0.025, 0.032, 0.042) + vec3(0.06, 0.07, 0.09) * primaryLobe;
    color = mix(color, streetColor, isStreet * 0.72 * (1.0 - edgeZone));

    // Outer silicon bevel & specular edge sheen
    vec3 bevelColor = vec3(0.16, 0.19, 0.24) + rainbow * 0.18;
    color = mix(color, bevelColor, edgeZone * 0.85);
    color += vec3(0.22, 0.28, 0.34) * fresnel * 0.45;

    // Keep below 0.92 bloom threshold so iridescent die detail stays razor-sharp
    color = min(color, vec3(0.86)) * uDimFactor;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createThreeWaferShaderMaterial(
  variant: PcbThemeVariant = 'standard'
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WAFER_VERTEX_SHADER,
    fragmentShader: WAFER_FRAGMENT_SHADER,
    uniforms: {
      uSwingAngleRad: { value: 0 },
      uAngularVel: { value: 0 },
      uTimeSec: { value: 0 },
      uVariant: { value: variant === 'emerald' ? 1.0 : 0.0 },
      uDimFactor: { value: 1.0 },
      uLightDir: { value: new THREE.Vector3(0.35, 0.65, 0.85).normalize() }
    },
    side: THREE.FrontSide
  });
}
