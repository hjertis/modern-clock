/**
 * WebGL Specular & Thin-Film Diffraction Grating Shader for the
 * Monocrystalline Silicon Wafer Pendulum Bob (PCB-2049 Theme).
 *
 * Simulates photolithography microchip die grids with sub-micron grating pitches
 * that shift spectral rainbow interference hues across die boundaries as the
 * pendulum sweeps through its harmonic arc θ(t).
 */

const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec2 v_uv;

  uniform float u_swingAngleRad;
  uniform float u_angularVel;
  uniform float u_timeSec;

  // Spectral rainbow conversion (physical thin-film interference approximation)
  vec3 spectralRainbow(float t) {
    vec3 c = 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.00, 0.33, 0.67)));
    // Boost cyan/magenta/emerald/gold silicon interference saturation
    return pow(c, vec3(0.85));
  }

  // Deterministic pseudo-random per die coordinate
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    // Flip Y so +Y is up, -Y is bottom SEMI notch
    vec2 uv = vec2(v_uv.x, -v_uv.y);
    float r = length(uv);

    // Outside wafer disc -> transparent
    if (r > 0.98) {
      discard;
    }

    // SEMI standard wafer orientation notch at bottom (uv.y ~ -0.96, uv.x ~ 0.0)
    vec2 notchPos = vec2(0.0, -0.975);
    if (length(uv - notchPos) < 0.055) {
      discard;
    }

    // Wafer edge exclusion zone (outer 4% bevel ring)
    float edgeZone = smoothstep(0.91, 0.94, r);

    // 1. Lithography Die Grid (11x11 dies across wafer diameter)
    float gridScale = 5.5;
    vec2 dieCoord = uv * gridScale;
    vec2 dieId = floor(dieCoord);
    vec2 dieUv = fract(dieCoord);

    // Scribe lines (dicing streets between dies)
    float streetWidth = 0.055;
    float inStreetX = step(dieUv.x, streetWidth) + step(1.0 - streetWidth, dieUv.x);
    float inStreetY = step(dieUv.y, streetWidth) + step(1.0 - streetWidth, dieUv.y);
    float isStreet = clamp(inStreetX + inStreetY, 0.0, 1.0);

    // Internal die floorplan sub-blocks (SRAM cache banks vs logic blocks vs I/O pad ring)
    vec2 innerUv = (dieUv - streetWidth) / (1.0 - 2.0 * streetWidth);
    float isIoRing = step(innerUv.x, 0.08) + step(0.92, innerUv.x) +
                     step(innerUv.y, 0.08) + step(0.92, innerUv.y);
    isIoRing = clamp(isIoRing, 0.0, 1.0);

    // Sub-block quadrant inside each die
    vec2 subBlockId = floor(innerUv * vec2(3.0, 4.0));
    float subBlockHash = hash21(dieId * 7.13 + subBlockId);
    float dieHash = hash21(dieId + vec2(19.7, 41.3));

    // Micro-circuit high-frequency grating lines inside each die sub-block
    float gratingFreq = 36.0 + floor(subBlockHash * 4.0) * 16.0;
    float gratingDir = mod( subBlockId.x + subBlockId.y, 2.0 ) < 0.5 ? innerUv.x : innerUv.y;
    float microGrating = 0.5 + 0.5 * sin(gratingDir * gratingFreq * 6.283185);

    // 2. Base monocrystalline <100> dark mirror silicon substrate
    vec3 baseSilicon = vec3(0.065, 0.082, 0.115);
    // Subtle dark variation per die & sub-block
    baseSilicon += vec3(0.018, 0.024, 0.032) * (0.5 + 0.5 * subBlockHash);
    baseSilicon *= (0.85 + 0.15 * microGrating);

    // 3. Specular & Diffraction Grating Pass shifting across die boundaries with θ(t)
    // Incident light shifts dynamically as pendulum sweeps through u_swingAngleRad
    float swingShift = u_swingAngleRad * 7.5 + u_angularVel * 0.35;

    // Optical path difference varies continuously across wafer AND jumps across die boundaries
    float diePhaseOffset = dieHash * 0.65 + subBlockHash * 0.28;
    float spatialPhase = dot(uv, vec2(cos(swingShift * 0.4), sin(swingShift * 0.4))) * 1.35;
    float angleDiff = uv.x * cos(u_swingAngleRad * 3.0) * 1.4 + uv.y * sin(u_swingAngleRad * 3.0) * 0.9;

    float wavelengthPhase = angleDiff + spatialPhase + swingShift * 0.55 + diePhaseOffset;
    vec3 rainbow = spectralRainbow(wavelengthPhase);

    // Anisotropic specular lobe that sweeps across the wafer surface as θ(t) oscillates
    vec2 lightDir = normalize(vec2(sin(u_swingAngleRad * 4.2) * 0.75, 0.55));
    float specBand = 1.0 - abs(dot(uv, lightDir) - sin(u_swingAngleRad * 3.2) * 0.35);
    specBand = pow(clamp(specBand, 0.0, 1.0), 3.2);

    // Secondary cross-axis diffraction flare
    vec2 orthoDir = vec2(-lightDir.y, lightDir.x);
    float crossBand = 1.0 - abs(dot(uv, orthoDir));
    crossBand = pow(clamp(crossBand, 0.0, 1.0), 4.5);

    // Diffraction intensity is strongest inside the active lithography gratings, masked out in streets
    float diffractionMask = (1.0 - isStreet) * (1.0 - edgeZone) * (0.32 + 0.68 * specBand);
    vec3 diffractedColor = mix(baseSilicon, rainbow, diffractionMask * (0.52 + 0.25 * microGrating));

    // Add crisp specular mirror sheen
    diffractedColor += vec3(0.95, 0.92, 0.85) * pow(specBand, 7.0) * 0.38 * (1.0 - edgeZone);
    diffractedColor += rainbow * crossBand * 0.22 * (1.0 - isStreet) * (1.0 - edgeZone);

    // 4. Scribe streets & bond pad rings in immersion gold / copper
    vec3 copperStreet = vec3(0.45, 0.33, 0.16);
    vec3 enigGold = vec3(0.957, 0.769, 0.384);

    // Street intersection fiducial cross
    float isIntersection = inStreetX * inStreetY;
    vec3 streetColor = mix(copperStreet * 0.65, enigGold, isIntersection * 0.85);

    if (isIoRing > 0.5 && isStreet < 0.5) {
      // Gold micro-bond-pads along die perimeter
      float padPulse = step(0.45, fract((innerUv.x + innerUv.y) * 14.0));
      diffractedColor = mix(diffractedColor, enigGold * 0.75, padPulse * 0.55);
    }

    vec3 color = mix(diffractedColor, streetColor, isStreet * (1.0 - edgeZone));

    // 5. Outer wafer edge exclusion bevel & ENIG retaining ring
    if (edgeZone > 0.0) {
      vec3 edgeMetal = mix(vec3(0.12, 0.15, 0.20), enigGold * 0.85, smoothstep(0.94, 0.975, r));
      color = mix(color, edgeMetal, edgeZone);
    }

    // Subtle radial vignette for 3D wafer depth
    color *= 1.0 - 0.18 * r * r;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class WaferShaderRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexShader: WebGLShader | null = null;
  private fragmentShader: WebGLShader | null = null;
  private positionBuffer: WebGLBuffer | null = null;

  private uSwingAngleLoc: WebGLUniformLocation | null = null;
  private uAngularVelLoc: WebGLUniformLocation | null = null;
  private uTimeSecLoc: WebGLUniformLocation | null = null;

  private readonly resolution = 300;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.resolution;
    this.canvas.height = this.resolution;
  }

  public init(): void {
    try {
      const gl = (this.canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false
      }) || this.canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;

      if (!gl) {
        return;
      }

      const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
      if (!vs || !fs) {
        return;
      }

      const program = gl.createProgram();
      if (!program) return;

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[WaferShaderRenderer] Shader link failed:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return;
      }

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Fullscreen quad
      const vertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      this.gl = gl;
      this.program = program;
      this.vertexShader = vs;
      this.fragmentShader = fs;
      this.positionBuffer = buffer;

      this.uSwingAngleLoc = gl.getUniformLocation(program, 'u_swingAngleRad');
      this.uAngularVelLoc = gl.getUniformLocation(program, 'u_angularVel');
      this.uTimeSecLoc = gl.getUniformLocation(program, 'u_timeSec');
    } catch (err) {
      console.warn('[WaferShaderRenderer] WebGL initialization fallback to 2D:', err);
      this.gl = null;
    }
  }

  /**
   * Renders the monocrystalline silicon wafer pass for the current pendulum swing state
   * and returns the offscreen canvas ready to be composited onto the pendulum bob.
   */
  public render(swingAngleRad: number, angularVelocityNorm: number, timeSec: number): HTMLCanvasElement {
    if (this.gl && this.program) {
      const gl = this.gl;
      gl.viewport(0, 0, this.resolution, this.resolution);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.program);
      if (this.uSwingAngleLoc) gl.uniform1f(this.uSwingAngleLoc, swingAngleRad);
      if (this.uAngularVelLoc) gl.uniform1f(this.uAngularVelLoc, angularVelocityNorm);
      if (this.uTimeSecLoc) gl.uniform1f(this.uTimeSecLoc, timeSec % 3600);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      this.renderFallback2D(swingAngleRad);
    }
    return this.canvas;
  }

  public destroy(): void {
    if (this.gl) {
      if (this.positionBuffer) {
        this.gl.deleteBuffer(this.positionBuffer);
        this.positionBuffer = null;
      }
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }
      if (this.vertexShader) {
        this.gl.deleteShader(this.vertexShader);
        this.vertexShader = null;
      }
      if (this.fragmentShader) {
        this.gl.deleteShader(this.fragmentShader);
        this.fragmentShader = null;
      }
      this.gl = null;
    }
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[WaferShaderRenderer] Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * 2D Canvas diffraction fallback if WebGL is disabled
   */
  private renderFallback2D(swingAngleRad: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const size = this.resolution;
    const half = size / 2;
    const r = half * 0.96;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    ctx.clip();

    // Silicon dark base
    ctx.fillStyle = '#111622';
    ctx.fillRect(0, 0, size, size);

    // Die grid with shifting rainbow hues
    const dieSize = 24;
    const hueBase = (swingAngleRad * 650) % 360;
    for (let gx = 0; gx < size; gx += dieSize) {
      for (let gy = 0; gy < size; gy += dieSize) {
        const dieShift = ((gx * 7 + gy * 13) % 180);
        const hue = (hueBase + dieShift + 360) % 360;
        ctx.fillStyle = `hsla(${hue}, 78%, 48%, 0.42)`;
        ctx.fillRect(gx + 1.5, gy + 1.5, dieSize - 3, dieSize - 3);
      }
    }

    ctx.restore();
  }
}

