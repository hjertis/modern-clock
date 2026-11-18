import * as THREE from 'three';
import { ClockMode, ThemeManifest } from '../../types/theme';
import {
  formatSynchronizedTime,
  sharedDisplayOptions,
  SynchronizedTimeTick
} from '../../core/timeFormatter';
import {
  PhysicsData,
  TelemetryData,
  Theme,
  ThemeConfig,
  ThemeEvent,
  TimeData
} from '../types';
import { ThreeStage, ThreeStageResourceStats } from '../three/ThreeStage';
import { createInvoluteGearGeometry } from '../tourbillon_3d/geometries';
import {
  MARIANA_ABYSS_MANIFEST,
  MARIANA_COLORS,
  MARIANA_GEOMETRY,
  MARIANA_SLEEP_FILAMENT_INTENSITY,
  MARIANA_TUBE_CROSSFADE_MS
} from './constants';
import {
  CausticSwayUniforms,
  createCausticShaderMaterial,
  createCrtSonarMaterial,
  createJellyfishBellMaterial,
  createPlasmaNumeralMaterial,
  createShipwreckOakMaps,
  createSoftParticleTexture,
  createTwistedRopeMaps,
  createVolumetricConeMaterial,
  enhanceWithCausticsAndSway
} from './materials';
import {
  createAnodeMeshGeometry,
  createBarnacleGeometry,
  createBathysphereChassisGeometry,
  createClinometerBobGeometry,
  createCurvedLensGeometry,
  createFrayedStrandGeometry,
  createHorologicalBridgeGeometry,
  createJellyfishRig,
  createKelpRibbonGeometry,
  createNumeralWireGeometries,
  createPortholeBezelGeometry,
  createRopeStumpGeometry,
  createTrenchRidgeGeometry,
  createTritiumHandGeometry,
  createZoneBezelFrameGeometry,
  JellyfishRig
} from './geometries';

export * from './constants';

interface TubeSlotState {
  group: THREE.Group;
  housingGroup: THREE.Group;
  filamentsGroup: THREE.Group;
  digitMeshes: Record<string, THREE.Mesh>;
  digitMaterials: Record<string, THREE.ShaderMaterial>;
  pointLight: THREE.PointLight;
  currentChar: string;
  previousChar: string | null;
  transitionStartMs: number;
}

export interface MarianaDebugState {
  mode: ClockMode;
  targetMode: ClockMode;
  isSleepActive: boolean;
  chassisVisible: boolean;
  portholeVisible: boolean;
  aquariumVisible: boolean;
  keyLightIntensity: number;
  tubeLightIntensity: number;
  activeDigits: string[];
  activeFilamentEmissive: number;
  gearAnglesRad: [number, number, number, number];
  pendulumAngleRad: number;
  sonarSweepRad: number;
  bargraphFillRatio: number;
  jellyfishPosition: [number, number, number];
}

const TUBE_X_POSITIONS = [-3.24, -2.04, -0.60, 0.60, 2.04, 3.24];
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export class MarianaAbyssTheme implements Theme {
  public readonly id = 'mariana_abyss';
  public readonly name = 'Mariana Abyss';

  private manifest: ThemeManifest = structuredClone(MARIANA_ABYSS_MANIFEST);
  private stage: ThreeStage | null = null;
  private isMounted = false;
  private currentMode: ClockMode = 'active';
  private targetMode: ClockMode = 'active';

  // Scene groups for clean Sleep (Cat mode) visibility toggling
  private chassisGroup: THREE.Group | null = null;
  private portholeGroup: THREE.Group | null = null;
  private tubeBayHousingGroup: THREE.Group | null = null;
  private colonGroup: THREE.Group | null = null;
  private aquariumGroup: THREE.Group | null = null;

  // Lights
  private keyLight: THREE.DirectionalLight | null = null;
  private warmRimLight: THREE.DirectionalLight | null = null;
  private coolRimLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private portholeLight: THREE.PointLight | null = null;
  private aquariumSpotLight: THREE.SpotLight | null = null;

  // Zone 01: Gear train, caustics, tritium & hands
  private centerWheel: THREE.Mesh | null = null;
  private thirdWheel: THREE.Mesh | null = null;
  private fourthWheel: THREE.Mesh | null = null;
  private escapementWheel: THREE.Mesh | null = null;
  private hourHandPivot: THREE.Group | null = null;
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;
  private causticMaterial: THREE.ShaderMaterial | null = null;
  private aquariumFloorCausticMat: THREE.ShaderMaterial | null = null;
  private tritiumMaterial: THREE.MeshStandardMaterial | null = null;

  // Zone 02: 6 Pressure Tubes & Micro-bubbles
  private tubes: TubeSlotState[] = [];
  private colonMaterial: THREE.MeshStandardMaterial | null = null;
  private tubeBubbles: THREE.Points | null = null;
  private tubeBubbleSpeeds: Float32Array | null = null;
  private lastActiveDigits: string[] = ['0', '0', '0', '0', '0', '0'];

  // Zone 03: Aquarium, Clinometer Pendulum, Jellyfish, Plankton, CRT Sonar
  private pendulumPivotGroup: THREE.Group | null = null;
  private frayedRopeGroups: THREE.Group[] = [];
  private bargraphFillMesh: THREE.Mesh | null = null;
  private bargraphMaterial: THREE.MeshStandardMaterial | null = null;
  private pendulumBubbles: THREE.Points | null = null;
  private pendulumBubbleVel: Float32Array | null = null;
  private planktonPoints: THREE.Points | null = null;
  private planktonPhase: Float32Array | null = null;
  private volumetricShaftMats: THREE.ShaderMaterial[] = [];
  private jellyfish: JellyfishRig | null = null;
  private jellyBellMat: THREE.ShaderMaterial | null = null;
  private jellyCoreMat: THREE.MeshStandardMaterial | null = null;
  private sonarMaterial: THREE.ShaderMaterial | null = null;
  private sonarSweepRad = 0;
  private lastBargraphRatio = 0;

  // Timing, Camera Parallax & Reactive Pulses
  private simTimeSec = 0;
  private lastTickTimestampMs: number | null = null;
  private lastSleepRenderTimeMs = -10000;
  private alertPulse = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerSmoothX = 0;
  private pointerSmoothY = 0;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private causticUniforms: CausticSwayUniforms = {
    uTime: { value: 0 },
    uCausticStrength: { value: 0.42 }
  };

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getThreeStage(): ThreeStage | null {
    return this.stage;
  }

  public getResourceStats(): ThreeStageResourceStats | null {
    return this.stage ? this.stage.getResourceStats() : null;
  }

  public getDebugState(): MarianaDebugState {
    const firstTube = this.tubes[0];
    const activeChar = firstTube?.currentChar ?? '0';
    const activeMat = firstTube?.digitMaterials[activeChar];
    const activeEmissive = activeMat
      ? activeMat.uniforms.uIntensity.value * activeMat.uniforms.uActiveWeight.value
      : 0;
    const jp = this.jellyfish?.root.position;
    return {
      mode: this.currentMode,
      targetMode: this.targetMode,
      isSleepActive: this.currentMode === 'sleep',
      chassisVisible: this.chassisGroup?.visible ?? false,
      portholeVisible: this.portholeGroup?.visible ?? false,
      aquariumVisible: this.aquariumGroup?.visible ?? false,
      keyLightIntensity: this.keyLight?.intensity ?? 0,
      tubeLightIntensity: firstTube?.pointLight.intensity ?? 0,
      activeDigits: [...this.lastActiveDigits],
      activeFilamentEmissive: activeEmissive,
      gearAnglesRad: [
        this.centerWheel?.rotation.z ?? 0,
        this.thirdWheel?.rotation.z ?? 0,
        this.fourthWheel?.rotation.z ?? 0,
        this.escapementWheel?.rotation.z ?? 0
      ],
      pendulumAngleRad: this.pendulumPivotGroup?.rotation.z ?? 0,
      sonarSweepRad: this.sonarSweepRad,
      bargraphFillRatio: this.lastBargraphRatio,
      jellyfishPosition: jp ? [jp.x, jp.y, jp.z] : [0, 0, 0]
    };
  }

  public async mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): Promise<void> {
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }

    this.manifest = config?.manifest
      ? structuredClone(config.manifest)
      : structuredClone(MARIANA_ABYSS_MANIFEST);

    this.isMounted = true;
    this.lastTickTimestampMs = null;
    this.lastSleepRenderTimeMs = -10000;
    this.alertPulse = 0;

    const stage = new ThreeStage({
      width: config?.width ?? ThreeStage.DEFAULT_WIDTH,
      height: config?.height ?? ThreeStage.DEFAULT_HEIGHT,
      fov: 36,
      chamberDepth: 5.5,
      stageElement: config?.stageElement,
      bloomThreshold: 0.92,
      bloomStrength: 0.65,
      bloomRadius: 0.55
    });
    await stage.init();
    stage.scene.background = new THREE.Color(0x030508);
    stage.setEnvironmentIntensity(0.85);
    this.stage = stage;

    this.setupPointerParallax();
    this.buildScene(stage);
    stage.clearCameraViewOffset();
  }

  private setupPointerParallax(): void {
    this.cleanupPointerParallax();
    if (typeof window === 'undefined') return;

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (this.targetMode === 'sleep') return;
      const w = window.innerWidth || 1080;
      const h = window.innerHeight || 1920;
      this.pointerTargetX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1));
      this.pointerTargetY = Math.max(-1, Math.min(1, -((e.clientY / h) * 2 - 1)));
    };
    window.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
  }

  private cleanupPointerParallax(): void {
    if (this.boundOnPointerMove && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.boundOnPointerMove);
    }
    this.boundOnPointerMove = null;
  }

  private buildScene(stage: ThreeStage): void {
    const oakMaps = createShipwreckOakMaps(512, 1024);
    const ropeMaps = createTwistedRopeMaps(128, 128);
    const particleTex = createSoftParticleTexture(64);

    // Weathered, waterlogged sunken ship-timber oak with live GLSL underwater caustic projection
    const waterloggedOakMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        map: oakMaps.map,
        normalMap: oakMaps.normalMap,
        normalScale: new THREE.Vector2(1.45, 1.45),
        roughnessMap: oakMaps.roughnessMap,
        metalness: 0.06,
        roughness: 0.84,
        envMapIntensity: 0.72
      }),
      this.causticUniforms
    );

    const timberBeamMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        map: oakMaps.map,
        normalMap: oakMaps.normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughnessMap: oakMaps.roughnessMap,
        color: 0x8a7562,
        metalness: 0.05,
        roughness: 0.86,
        envMapIntensity: 0.65
      }),
      this.causticUniforms
    );

    // Dark charcoal/espresso interior wall material (#0A0B0D)
    const castIronMat = new THREE.MeshStandardMaterial({
      color: 0x0a0b0d,
      metalness: 0.35,
      roughness: 0.75,
      envMapIntensity: 0.55
    });

    // Weathered corroded iron for hull rings, pad-eyes & corner gussets
    const corrodedIronMat = new THREE.MeshStandardMaterial({
      color: 0x4b3a2f,
      metalness: 0.78,
      roughness: 0.48,
      envMapIntensity: 1.1
    });

    // Smooth dark machined naval-bronze chamfered frame material with live caustic spill
    const bronzeMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        color: 0x6b5233,
        metalness: 0.85,
        roughness: 0.35,
        envMapIntensity: 0.95
      }),
      this.causticUniforms
    );

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x76808a,
      metalness: 0.85,
      roughness: 0.34,
      envMapIntensity: 0.9
    });

    const barnacleMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        color: 0x635d52,
        roughness: 0.88,
        metalness: 0.04,
        envMapIntensity: 0.5
      }),
      this.causticUniforms
    );

    // Kelp/seaweed & frayed rope materials driven by GLSL vertex-shader underwater current wave
    const kelpMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        color: 0x1b3b24,
        roughness: 0.36,
        metalness: 0.04,
        side: THREE.DoubleSide,
        envMapIntensity: 0.75
      }),
      this.causticUniforms,
      { swayAmplitude: 0.22, swaySpeed: 1.05 }
    );

    const ropeMat = enhanceWithCausticsAndSway(
      new THREE.MeshStandardMaterial({
        map: ropeMaps.map,
        normalMap: ropeMaps.normalMap,
        normalScale: new THREE.Vector2(1.4, 1.4),
        roughnessMap: ropeMaps.roughnessMap,
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.5
      }),
      this.causticUniforms,
      { swayAmplitude: 0.075, swaySpeed: 1.25 }
    );

    // Zone 01 curved porthole glass lens (transparent, low-opacity specular glaze with depthWrite: false)
    const portholeLensMat = new THREE.MeshPhysicalMaterial({
      color: 0xbbeeff,
      roughness: 0.04,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.14,
      depthWrite: false
    });

    // Zone 02 & 03 glass envelopes (depthWrite: false so internal HDR plasma digits never cull)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xaad8e6,
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });

    // -----------------------------------------------------------------------
    // Lighting (Cool top-left directional key + hemisphere + local lights)
    // -----------------------------------------------------------------------
    const keyLight = new THREE.DirectionalLight(MARIANA_COLORS.KEY_LIGHT, 2.8);
    keyLight.position.set(-7.5, 11.5, 13.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = ThreeStage.SHADOW_MAP_SIZE;
    keyLight.shadow.mapSize.height = ThreeStage.SHADOW_MAP_SIZE;
    keyLight.shadow.camera.near = 2.0;
    keyLight.shadow.camera.far = 36.0;
    keyLight.shadow.camera.left = -6.5;
    keyLight.shadow.camera.right = 6.5;
    keyLight.shadow.camera.top = 10.5;
    keyLight.shadow.camera.bottom = -10.5;
    keyLight.shadow.bias = -0.0005;
    stage.scene.add(keyLight);
    this.keyLight = keyLight;

    const hemiLight = new THREE.HemisphereLight(0x3a7ca5, 0x071018, 0.65);
    stage.scene.add(hemiLight);
    this.hemiLight = hemiLight;

    // Warm-cool rim lights so extruded gears, bridges, and riveted chassis catch sharp metallic speculars
    const warmRimLight = new THREE.DirectionalLight(0xffb86c, 1.35);
    warmRimLight.position.set(9.0, 4.0, 5.5);
    stage.scene.add(warmRimLight);
    this.warmRimLight = warmRimLight;

    const coolRimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    coolRimLight.position.set(-8.0, -7.0, 5.0);
    stage.scene.add(coolRimLight);
    this.coolRimLight = coolRimLight;

    // -----------------------------------------------------------------------
    // 1. Sunken Shipwreck Timber Bulkhead, Barnacles, Algae & Frayed Rope
    // -----------------------------------------------------------------------
    const chassisGroup = new THREE.Group();
    const surroundBacking = new THREE.Mesh(
      new THREE.BoxGeometry(44.0, 36.0, 0.3),
      waterloggedOakMat
    );
    surroundBacking.position.set(0, 0, -1.65);
    surroundBacking.receiveShadow = true;
    chassisGroup.add(surroundBacking);

    const chassisMesh = new THREE.Mesh(createBathysphereChassisGeometry(), waterloggedOakMat);
    chassisMesh.castShadow = true;
    chassisMesh.receiveShadow = true;
    chassisGroup.add(chassisMesh);

    // Heavy 3D outer timber perimeter beams & overhanging top cornice casting real shadows
    const leftStile = new THREE.Mesh(new THREE.BoxGeometry(0.95, 19.2, 0.72), timberBeamMat);
    leftStile.position.set(-4.92, 0, 0.22);
    leftStile.castShadow = true;
    leftStile.receiveShadow = true;
    chassisGroup.add(leftStile);

    const rightStile = new THREE.Mesh(new THREE.BoxGeometry(0.95, 19.2, 0.72), timberBeamMat);
    rightStile.position.set(4.92, 0, 0.22);
    rightStile.castShadow = true;
    rightStile.receiveShadow = true;
    chassisGroup.add(rightStile);

    const bottomSill = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.82, 0.78), timberBeamMat);
    bottomSill.position.set(0, -9.18, 0.26);
    bottomSill.castShadow = true;
    bottomSill.receiveShadow = true;
    chassisGroup.add(bottomSill);

    const topOverhang = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.96, 0.52), timberBeamMat);
    topOverhang.position.set(0, 9.12, -0.26);
    topOverhang.castShadow = true;
    topOverhang.receiveShadow = true;
    chassisGroup.add(topOverhang);

    const zone2Frame = new THREE.Mesh(
      createZoneBezelFrameGeometry(8.2, 1.92, 0.22, 0.22, 0.2),
      bronzeMat
    );
    zone2Frame.position.set(0, -0.05, 0.04);
    zone2Frame.castShadow = true;
    zone2Frame.receiveShadow = true;
    chassisGroup.add(zone2Frame);

    const zone3Frame = new THREE.Mesh(
      createZoneBezelFrameGeometry(8.1, 6.55, 0.24, 0.26, 0.22),
      bronzeMat
    );
    zone3Frame.position.set(0, -4.97, 0.04);
    zone3Frame.castShadow = true;
    zone3Frame.receiveShadow = true;
    chassisGroup.add(zone3Frame);

    // Corroded iron bolt heads around timber stiles, porthole, and zone seams
    const boltPositions: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      boltPositions.push([Math.cos(a) * 3.36, 5.1 + Math.sin(a) * 3.36, 0.25]);
    }
    for (const bx of [-4.22, -2.1, 0, 2.1, 4.22]) {
      boltPositions.push([bx, 1.0, 0.14], [bx, -1.1, 0.14]);
    }
    for (const by of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) {
      boltPositions.push([-4.7, by, 0.6], [4.7, by, 0.6]);
    }
    const boltGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.12, 6);
    boltGeo.rotateX(Math.PI * 0.5);
    const boltInst = new THREE.InstancedMesh(boltGeo, corrodedIronMat, boltPositions.length);
    boltInst.castShadow = true;
    boltInst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    boltPositions.forEach(([x, y, z], idx) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, idx * 0.35);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      boltInst.setMatrixAt(idx, dummy.matrix);
    });
    chassisGroup.add(boltInst);

    // Individual beveled, warped 3D oak planks along the side stiles & cross-rails
    const plankSpecs: Array<[number, number, number, number, number, number]> = [
      [-4.25, 5.1, 0.08, 0.62, 7.8, 0.018],
      [4.25, 5.1, 0.06, 0.62, 7.8, -0.015],
      [-4.28, -4.97, 0.09, 0.58, 7.2, -0.02],
      [4.28, -4.97, 0.05, 0.58, 7.2, 0.016],
      [0, 1.05, 0.08, 8.6, 0.34, 0.008],
      [0, -1.25, 0.07, 8.6, 0.34, -0.007]
    ];
    for (const [px, py, pz, pw, ph, rotZ] of plankSpecs) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.14), waterloggedOakMat);
      plank.position.set(px, py, pz);
      plank.rotation.z = rotZ;
      plank.castShadow = true;
      plank.receiveShadow = true;
      chassisGroup.add(plank);
    }

    // Scattered 3D conical barnacles (~210 instances) along plank seams, corners & bezels
    const barnacleSpots: Array<[number, number, number, number]> = [];
    // Zone 01 porthole rim clusters
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + (i % 3) * 0.06;
      const r = 3.64 + (i % 5) * 0.12;
      barnacleSpots.push([Math.cos(a) * r, 5.1 + Math.sin(a) * r, 0.13, 0.55 + (i % 4) * 0.28]);
    }
    // Zone 02 & 03 seam clusters
    for (let i = 0; i < 40; i++) {
      const x = -4.0 + (i / 39) * 8.0;
      barnacleSpots.push([x, 1.06 + Math.sin(i * 1.7) * 0.12, 0.16, 0.5 + (i % 3) * 0.25]);
      barnacleSpots.push([x, -1.24 + Math.cos(i * 1.9) * 0.12, 0.16, 0.48 + (i % 3) * 0.22]);
    }
    // Corner & stile barnacle clusters
    const clusterCenters: Array<[number, number, number]> = [
      [-4.2, 8.2, 0.45],
      [4.1, 8.1, 0.45],
      [-4.35, 2.1, 0.45],
      [4.35, 1.6, 0.45],
      [-4.3, -1.6, 0.45],
      [4.3, -1.8, 0.45],
      [-4.3, -8.3, 0.45],
      [4.2, -8.35, 0.45],
      [-2.1, -8.6, 0.45],
      [2.3, -8.6, 0.45],
      [-4.4, 5.0, 0.55],
      [4.4, 5.0, 0.55]
    ];
    clusterCenters.forEach(([cx, cy, cz], cIdx) => {
      for (let k = 0; k < 7; k++) {
        const ox = Math.sin(cIdx * 2.3 + k * 1.7) * 0.46;
        const oy = Math.cos(cIdx * 1.9 + k * 2.1) * 0.4;
        barnacleSpots.push([cx + ox, cy + oy, cz, 0.55 + (k % 4) * 0.3]);
      }
    });

    const barnacleInst = new THREE.InstancedMesh(
      createBarnacleGeometry(),
      barnacleMat,
      barnacleSpots.length
    );
    barnacleInst.castShadow = true;
    barnacleInst.receiveShadow = true;
    barnacleSpots.forEach(([x, y, z, sc], idx) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(
        Math.sin(idx * 1.3) * 0.22,
        Math.cos(idx * 1.7) * 0.22,
        idx * 0.8
      );
      dummy.scale.set(sc, sc, sc * (0.85 + (idx % 3) * 0.2));
      dummy.updateMatrix();
      barnacleInst.setMatrixAt(idx, dummy.matrix);
    });
    chassisGroup.add(barnacleInst);

    // 3D swaying kelp/seaweed ribbons driven by vertex-shader underwater current wave
    const kelpSpots: Array<[number, number, number, number, number]> = [
      [-4.42, 8.5, 0.56, 0.28, 2.6],
      [-4.15, 8.3, 0.52, 0.22, 2.0],
      [4.38, 8.4, 0.56, 0.26, 2.4],
      [-4.45, -1.4, 0.56, 0.24, 2.2],
      [4.42, -1.8, 0.56, 0.28, 2.5],
      [4.12, -5.8, 0.48, 0.22, 2.1]
    ];
    for (const [kx, ky, kz, kw, kh] of kelpSpots) {
      const kelpMesh = new THREE.Mesh(createKelpRibbonGeometry(kw, kh), kelpMat);
      kelpMesh.position.set(kx, ky, kz);
      kelpMesh.castShadow = true;
      chassisGroup.add(kelpMesh);
    }

    // 3 Corroded iron hull rings with waterlogged twisted-rope stumps & swaying frayed fibers
    this.frayedRopeGroups = [];
    const ropeAnchors: Array<{ x: number; y: number; z: number; sign: number }> = [
      { x: -4.46, y: 6.2, z: 0.58, sign: 1 },
      { x: -4.46, y: -2.6, z: 0.58, sign: 1 },
      { x: 4.46, y: 1.8, z: 0.58, sign: -1 }
    ];
    for (const anchor of ropeAnchors) {
      // Bolted cast-iron pad-eye mounting plate + 4 rivets + forged hull ring
      const padPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.1), corrodedIronMat);
      padPlate.position.set(anchor.x, anchor.y, anchor.z - 0.02);
      padPlate.castShadow = true;
      padPlate.receiveShadow = true;
      chassisGroup.add(padPlate);

      for (const [ox, oy] of [
        [-0.13, -0.17],
        [0.13, -0.17],
        [-0.13, 0.17],
        [0.13, 0.17]
      ]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.07, 6), corrodedIronMat);
        bolt.rotation.x = Math.PI * 0.5;
        bolt.position.set(anchor.x + ox, anchor.y + oy, anchor.z + 0.04);
        chassisGroup.add(bolt);
      }

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.048, 10, 20), corrodedIronMat);
      ring.position.set(anchor.x, anchor.y, anchor.z + 0.04);
      ring.rotation.y = anchor.sign * 0.35;
      ring.castShadow = true;
      chassisGroup.add(ring);

      const ropeStump = createRopeStumpGeometry(0.88, 0.072, anchor.sign);
      const stumpMesh = new THREE.Mesh(ropeStump.geometry, ropeMat);
      stumpMesh.position.set(anchor.x, anchor.y - 0.14, anchor.z + 0.04);
      stumpMesh.castShadow = true;
      chassisGroup.add(stumpMesh);

      const frayGroup = new THREE.Group();
      frayGroup.position.set(
        anchor.x + ropeStump.endPoint.x,
        anchor.y - 0.14 + ropeStump.endPoint.y,
        anchor.z + 0.04 + ropeStump.endPoint.z
      );
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * Math.PI * 2;
        const strandGeo = createFrayedStrandGeometry(
          0.32 + (s % 2) * 0.08,
          Math.cos(a) * 0.12,
          Math.sin(a) * 0.07
        );
        const strandMesh = new THREE.Mesh(strandGeo, ropeMat);
        frayGroup.add(strandMesh);
      }
      chassisGroup.add(frayGroup);
      this.frayedRopeGroups.push(frayGroup);
    }

    stage.scene.add(chassisGroup);
    this.chassisGroup = chassisGroup;

    // -----------------------------------------------------------------------
    // 2. Zone 01: Oil-Filled Porthole, Caustics, Gear Train & Tritium Hands
    // -----------------------------------------------------------------------
    const portholeGroup = new THREE.Group();
    portholeGroup.position.set(0, 5.1, 0);

    const portholeBezel = new THREE.Mesh(
      createPortholeBezelGeometry(3.16, 3.55, 0.52),
      bronzeMat
    );
    portholeBezel.position.z = 0.02;
    portholeBezel.castShadow = true;
    portholeBezel.receiveShadow = true;
    portholeGroup.add(portholeBezel);

    // Oil-filled cavity barrel & animated caustic backplate
    const cavityWall = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.2, 1.8, 48, 1, true),
      castIronMat
    );
    cavityWall.rotation.x = Math.PI * 0.5;
    cavityWall.position.z = -0.9;
    cavityWall.receiveShadow = true;
    portholeGroup.add(cavityWall);

    this.causticMaterial = createCausticShaderMaterial(0x03111a, 0x00e5ff, 0.48);
    const causticBack = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), this.causticMaterial);
    causticBack.position.z = -1.78;
    portholeGroup.add(causticBack);

    // Steel horological bridges + Ruby jewel bearings
    const bridgeGeo = createHorologicalBridgeGeometry(3.8, 0.55, 0.08);
    const mainBridge = new THREE.Mesh(bridgeGeo, steelMat);
    mainBridge.position.set(-0.35, -1.05, -0.86);
    mainBridge.rotation.z = 0.34;
    mainBridge.castShadow = true;
    mainBridge.receiveShadow = true;
    portholeGroup.add(mainBridge);

    const rubyMat = new THREE.MeshPhysicalMaterial({
      color: MARIANA_COLORS.RUBY_JEWEL,
      emissive: 0x3b0414,
      emissiveIntensity: 0.45,
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 1.0
    });
    const jewelCoords: Array<[number, number, number]> = [
      [0, 0, -0.82],
      [-1.6, -1.58, -0.82],
      [-0.18, -2.24, -0.82],
      [1.45, -1.25, -0.82]
    ];
    for (const [jx, jy, jz] of jewelCoords) {
      const chaton = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 10, 20), bronzeMat);
      chaton.position.set(jx, jy, jz);
      portholeGroup.add(chaton);

      const ruby = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), rubyMat);
      ruby.scale.set(1, 1, 0.55);
      ruby.position.set(jx, jy, jz + 0.015);
      portholeGroup.add(ruby);
    }

    // Meshing Extruded 3D Gear Train
    this.centerWheel = new THREE.Mesh(
      createInvoluteGearGeometry({ teeth: 48, pitchRadius: 1.35, thickness: 0.12, spokes: 6 }),
      bronzeMat
    );
    this.centerWheel.position.set(0, 0, -1.16);
    this.centerWheel.castShadow = true;
    this.centerWheel.receiveShadow = true;
    portholeGroup.add(this.centerWheel);

    this.thirdWheel = new THREE.Mesh(
      createInvoluteGearGeometry({ teeth: 32, pitchRadius: 0.9, thickness: 0.11, spokes: 5 }),
      steelMat
    );
    this.thirdWheel.position.set(-1.6, -1.58, -1.06);
    this.thirdWheel.castShadow = true;
    this.thirdWheel.receiveShadow = true;
    portholeGroup.add(this.thirdWheel);

    this.fourthWheel = new THREE.Mesh(
      createInvoluteGearGeometry({ teeth: 24, pitchRadius: 0.675, thickness: 0.1, spokes: 4 }),
      bronzeMat
    );
    this.fourthWheel.position.set(-0.18, -2.24, -0.96);
    this.fourthWheel.castShadow = true;
    this.fourthWheel.receiveShadow = true;
    portholeGroup.add(this.fourthWheel);

    this.escapementWheel = new THREE.Mesh(
      createInvoluteGearGeometry({ teeth: 18, pitchRadius: 0.52, thickness: 0.09, spokes: 3 }),
      steelMat
    );
    this.escapementWheel.position.set(1.45, -1.25, -1.08);
    this.escapementWheel.castShadow = true;
    this.escapementWheel.receiveShadow = true;
    portholeGroup.add(this.escapementWheel);

    // Glowing cyan-green tritium dial indices
    const tritiumMat = new THREE.MeshStandardMaterial({
      color: MARIANA_COLORS.TRITIUM_GREEN,
      emissive: MARIANA_COLORS.TRITIUM_GREEN,
      emissiveIntensity: 1.45,
      roughness: 0.25
    });
    this.tritiumMaterial = tritiumMat;

    const chapterRing = new THREE.Mesh(new THREE.RingGeometry(2.58, 3.04, 64), castIronMat);
    chapterRing.position.z = -0.62;
    chapterRing.receiveShadow = true;
    portholeGroup.add(chapterRing);

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const isHour = i % 5 === 0;
      const tickGeo = new THREE.BoxGeometry(isHour ? 0.085 : 0.032, isHour ? 0.34 : 0.14, 0.04);
      const tick = new THREE.Mesh(tickGeo, isHour ? tritiumMat : steelMat);
      const r = isHour ? 2.74 : 2.86;
      tick.position.set(Math.sin(angle) * r, Math.cos(angle) * r, -0.58);
      tick.rotation.z = -angle;
      portholeGroup.add(tick);
    }

    // 3D Extruded Hands + Central Cap
    this.hourHandPivot = new THREE.Group();
    this.hourHandPivot.position.z = -0.40;
    const hourMesh = new THREE.Mesh(createTritiumHandGeometry(1.78, 0.22, 0.06), bronzeMat);
    hourMesh.castShadow = true;
    const hourInlay = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.05, 0.072), tritiumMat);
    hourInlay.position.y = 0.72;
    this.hourHandPivot.add(hourMesh, hourInlay);
    portholeGroup.add(this.hourHandPivot);

    this.minuteHandPivot = new THREE.Group();
    this.minuteHandPivot.position.z = -0.30;
    const minMesh = new THREE.Mesh(createTritiumHandGeometry(2.45, 0.17, 0.05), steelMat);
    minMesh.castShadow = true;
    const minInlay = new THREE.Mesh(new THREE.BoxGeometry(0.042, 1.65, 0.062), tritiumMat);
    minInlay.position.y = 0.95;
    this.minuteHandPivot.add(minMesh, minInlay);
    portholeGroup.add(this.minuteHandPivot);

    this.secondHandPivot = new THREE.Group();
    this.secondHandPivot.position.z = -0.20;
    const secMesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.85, 0.03), tritiumMat);
    secMesh.position.y = 0.85;
    this.secondHandPivot.add(secMesh);
    portholeGroup.add(this.secondHandPivot);

    const centerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.14, 24), bronzeMat);
    centerCap.rotation.x = Math.PI * 0.5;
    centerCap.position.z = -0.16;
    portholeGroup.add(centerCap);

    // Subtle convex glass porthole lens positioned behind the hands so hands stay crisp and unobstructed
    const lensMesh = new THREE.Mesh(createCurvedLensGeometry(3.16, 0.06), portholeLensMat);
    lensMesh.position.z = -0.51;
    portholeGroup.add(lensMesh);

    const portholeLight = new THREE.PointLight(MARIANA_COLORS.BIOLUM_CYAN, 2.1, 6.5, 1.6);
    portholeLight.position.set(0, 0, 0.75);
    portholeGroup.add(portholeLight);
    this.portholeLight = portholeLight;

    stage.scene.add(portholeGroup);
    this.portholeGroup = portholeGroup;

    // -----------------------------------------------------------------------
    // 3. Zone 02: 6 Submerged Pressure Tubes & Stacked 3D Numeral Filaments
    // -----------------------------------------------------------------------
    const tubeBayHousingGroup = new THREE.Group();
    const tubeBayBack = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.92, 0.2), castIronMat);
    tubeBayBack.position.set(0, -0.05, -1.2);
    tubeBayBack.receiveShadow = true;
    tubeBayHousingGroup.add(tubeBayBack);
    stage.scene.add(tubeBayHousingGroup);
    this.tubeBayHousingGroup = tubeBayHousingGroup;

    const numeralGeos = createNumeralWireGeometries(0.56, 0.96, 0.035);
    const anodeGeo = createAnodeMeshGeometry(0.35, 1.08);
    const anodeMat = new THREE.MeshStandardMaterial({
      color: 0x1a2026,
      wireframe: true,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0.7
    });
    const ceramicMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e24,
      roughness: 0.85,
      metalness: 0.1
    });
    const tubeGlassGeo = new THREE.CylinderGeometry(
      MARIANA_GEOMETRY.TUBE_RADIUS,
      MARIANA_GEOMETRY.TUBE_RADIUS,
      MARIANA_GEOMETRY.TUBE_HEIGHT,
      24,
      1,
      true
    );

    this.tubes = TUBE_X_POSITIONS.map((tx, idx) => {
      const group = new THREE.Group();
      group.position.set(tx, -0.05, -0.52);

      const housingGroup = new THREE.Group();
      // Machined-bronze collar socket
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.22, 24), bronzeMat);
      collar.position.y = -0.68;
      collar.castShadow = true;
      collar.receiveShadow = true;
      housingGroup.add(collar);

      // Ceramic base + gold pin ring
      const ceramic = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.14, 20), ceramicMat);
      ceramic.position.y = -0.54;
      housingGroup.add(ceramic);

      // Anode wire-mesh cage
      const anode = new THREE.Mesh(anodeGeo, anodeMat);
      anode.position.y = 0.04;
      anode.renderOrder = 1;
      housingGroup.add(anode);

      // Cylindrical glass pressure tube + dome cap (depthWrite: false, renderOrder: 2)
      const glassCyl = new THREE.Mesh(tubeGlassGeo, glassMat);
      glassCyl.position.y = 0.08;
      glassCyl.renderOrder = 2;
      housingGroup.add(glassCyl);

      const domeCap = new THREE.Mesh(
        new THREE.SphereGeometry(MARIANA_GEOMETRY.TUBE_RADIUS, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        glassMat
      );
      domeCap.position.y = 0.77;
      domeCap.renderOrder = 2;
      housingGroup.add(domeCap);

      group.add(housingGroup);

      // Stacked 3D numeral wire geometries '0'..'9' using custom HDR plasma shader
      const filamentsGroup = new THREE.Group();
      filamentsGroup.position.set(0, 0.08, 0.08);
      const digitMeshes: Record<string, THREE.Mesh> = {};
      const digitMaterials: Record<string, THREE.ShaderMaterial> = {};

      DIGITS.forEach((d, dIdx) => {
        const mat = createPlasmaNumeralMaterial();
        const mesh = new THREE.Mesh(numeralGeos[d], mat);
        // Stagger depth inside tube
        mesh.position.z = (dIdx - 4.5) * 0.016;
        filamentsGroup.add(mesh);
        digitMeshes[d] = mesh;
        digitMaterials[d] = mat;
      });
      group.add(filamentsGroup);

      // Localized point light casting cyan spill onto wet wood, barnacles & collars
      const pointLight = new THREE.PointLight(MARIANA_COLORS.BIOLUM_CYAN, 1.15, 3.2, 1.8);
      pointLight.position.set(0, -0.35, 0.45);
      group.add(pointLight);

      stage.scene.add(group);
      return {
        group,
        housingGroup,
        filamentsGroup,
        digitMeshes,
        digitMaterials,
        pointLight,
        currentChar: '0',
        previousChar: null,
        transitionStartMs: -1000 + idx * 10
      };
    });

    // Colon separator plasma pods
    const colonGroup = new THREE.Group();
    this.colonMaterial = new THREE.MeshStandardMaterial({
      color: MARIANA_COLORS.BIOLUM_CYAN,
      emissive: MARIANA_COLORS.BIOLUM_CYAN,
      emissiveIntensity: 1.5
    });
    for (const cx of [-1.32, 1.32]) {
      for (const cy of [0.16, -0.22]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), this.colonMaterial);
        dot.position.set(cx, cy, -0.48);
        colonGroup.add(dot);
      }
    }
    stage.scene.add(colonGroup);
    this.colonGroup = colonGroup;

    // Rising micro-bubbles inside Zone 02 tube bay
    const bubbleCount = 65;
    const bPos = new Float32Array(bubbleCount * 3);
    this.tubeBubbleSpeeds = new Float32Array(bubbleCount);
    for (let i = 0; i < bubbleCount; i++) {
      bPos[i * 3] = (Math.random() - 0.5) * 7.6;
      bPos[i * 3 + 1] = -0.9 + Math.random() * 1.7;
      bPos[i * 3 + 2] = -0.8 + Math.random() * 0.55;
      this.tubeBubbleSpeeds[i] = 0.22 + Math.random() * 0.38;
    }
    const bubbleGeo = new THREE.BufferGeometry();
    bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    const bubbleMat = new THREE.PointsMaterial({
      map: particleTex,
      color: 0x7ef2ff,
      size: 0.075,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.tubeBubbles = new THREE.Points(bubbleGeo, bubbleMat);
    stage.scene.add(this.tubeBubbles);

    // -----------------------------------------------------------------------
    // 4. Zone 03: Deep Abyssal Aquarium, Trench Ridges, Gimbal Pendulum, Jellyfish & CRT Sonar
    // -----------------------------------------------------------------------
    const aquariumGroup = new THREE.Group();

    // Ribbed cast-iron pressure hull backplate
    const hullBackMat = new THREE.MeshStandardMaterial({
      color: 0x05111b,
      roughness: 0.78,
      metalness: 0.45
    });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 6.8), hullBackMat);
    backWall.position.set(0, -4.97, -4.1);
    backWall.receiveShadow = true;
    aquariumGroup.add(backWall);

    for (let rx = -3.6; rx <= 3.6; rx += 1.2) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.8, 0.24), castIronMat);
      rib.position.set(rx, -4.97, -3.96);
      rib.receiveShadow = true;
      aquariumGroup.add(rib);
    }

    // Layered depth-of-field rocky trench ridges in the abyssal background
    const ridgeSpecs: Array<{ z: number; h: number; color: number; seed: number }> = [
      { z: -3.65, h: 3.1, color: 0x030e17, seed: 1.2 },
      { z: -3.15, h: 2.3, color: 0x051624, seed: 4.7 },
      { z: -2.55, h: 1.55, color: 0x071e2f, seed: 8.3 }
    ];
    for (const rs of ridgeSpecs) {
      const ridgeMat = new THREE.MeshStandardMaterial({
        color: rs.color,
        roughness: 0.92,
        metalness: 0.08
      });
      const ridge = new THREE.Mesh(createTrenchRidgeGeometry(8.4, rs.h, rs.seed), ridgeMat);
      ridge.position.set(0, -8.28, rs.z);
      ridge.receiveShadow = true;
      aquariumGroup.add(ridge);
    }

    this.aquariumFloorCausticMat = createCausticShaderMaterial(0x020c14, 0x00c8e8, 0.35);
    const tankFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 4.0),
      this.aquariumFloorCausticMat
    );
    tankFloor.rotation.x = -Math.PI * 0.5;
    tankFloor.position.set(0, -8.24, -2.0);
    aquariumGroup.add(tankFloor);

    // Front thick beveled aquarium glass
    const tankGlass = new THREE.Mesh(new THREE.BoxGeometry(8.0, 6.45, 0.06), glassMat);
    tankGlass.position.set(0, -4.97, -0.15);
    aquariumGroup.add(tankGlass);

    // Top-down 3D Brass Floodlight Bezel + Soft Feathered Volumetric Light Shafts
    const floodBezel = new THREE.Mesh(
      createPortholeBezelGeometry(0.42, 0.62, 0.24),
      bronzeMat
    );
    floodBezel.rotation.x = Math.PI * 0.5;
    floodBezel.position.set(0, -1.78, -1.55);
    aquariumGroup.add(floodBezel);

    const floodLensMat = new THREE.MeshStandardMaterial({
      color: 0xb2ffff,
      emissive: 0x00e5ff,
      emissiveIntensity: 1.6
    });
    const floodLens = new THREE.Mesh(new THREE.CircleGeometry(0.41, 24), floodLensMat);
    floodLens.rotation.x = Math.PI * 0.5;
    floodLens.position.set(0, -1.86, -1.55);
    aquariumGroup.add(floodLens);

    const spotLight = new THREE.SpotLight(MARIANA_COLORS.BIOLUM_CYAN, 11.0, 15.0, 0.62, 0.78, 1.2);
    spotLight.position.set(0, -1.85, -1.55);
    spotLight.target.position.set(0, -7.8, -1.85);
    spotLight.castShadow = true;
    aquariumGroup.add(spotLight);
    aquariumGroup.add(spotLight.target);
    this.aquariumSpotLight = spotLight;

    this.volumetricShaftMats = [];
    const shaftConfigs: Array<{ topR: number; botR: number; tiltZ: number; opacity: number }> = [
      { topR: 0.36, botR: 2.8, tiltZ: 0.0, opacity: 0.14 },
      { topR: 0.26, botR: 2.1, tiltZ: -0.14, opacity: 0.1 },
      { topR: 0.24, botR: 1.9, tiltZ: 0.16, opacity: 0.09 }
    ];
    for (const sc of shaftConfigs) {
      const mat = createVolumetricConeMaterial();
      mat.uniforms.uOpacity.value = sc.opacity;
      const shaftMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(sc.topR, sc.botR, 6.2, 32, 1, true),
        mat
      );
      shaftMesh.position.set(Math.sin(sc.tiltZ) * 1.4, -4.92, -1.72);
      shaftMesh.rotation.z = sc.tiltZ;
      aquariumGroup.add(shaftMesh);
      this.volumetricShaftMats.push(mat);
    }

    // 1,800 soft bokeh marine-snow & bioluminescent plankton particles drifting in 3D space
    const planktonCount = 1800;
    const pPos = new Float32Array(planktonCount * 3);
    this.planktonPhase = new Float32Array(planktonCount);
    for (let i = 0; i < planktonCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 7.8;
      pPos[i * 3 + 1] = -8.1 + Math.random() * 6.2;
      pPos[i * 3 + 2] = -3.7 + Math.random() * 3.3;
      this.planktonPhase[i] = Math.random() * Math.PI * 2;
    }
    const planktonGeo = new THREE.BufferGeometry();
    planktonGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const planktonMat = new THREE.PointsMaterial({
      map: particleTex,
      color: 0x5eead4,
      size: 0.048,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.planktonPoints = new THREE.Points(planktonGeo, planktonMat);
    aquariumGroup.add(this.planktonPoints);

    // Brass-and-Iron Clinometer Pendulum + Glowing Cyan Bargraph Tube
    const pendulumPivot = new THREE.Group();
    pendulumPivot.position.set(
      MARIANA_GEOMETRY.PENDULUM_PIVOT_WORLD.x,
      MARIANA_GEOMETRY.PENDULUM_PIVOT_WORLD.y,
      -1.65
    );

    const trunnion = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 18), bronzeMat);
    trunnion.rotation.x = Math.PI * 0.5;
    pendulumPivot.add(trunnion);

    const rodLen = MARIANA_GEOMETRY.PENDULUM_LENGTH_WORLD;
    for (const rx of [-0.075, 0.075]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, rodLen, 10), steelMat);
      rail.position.set(rx, -rodLen * 0.5, 0);
      rail.castShadow = true;
      pendulumPivot.add(rail);
    }

    const bobGroup = new THREE.Group();
    bobGroup.position.set(0, -rodLen, 0);

    const bobBody = new THREE.Mesh(createClinometerBobGeometry(), bronzeMat);
    bobBody.castShadow = true;
    bobBody.receiveShadow = true;
    bobGroup.add(bobBody);

    // 4 cardinal trunnion bolts on the machined bathysphere gimbal ring
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2;
      const trunBolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 6), steelMat);
      trunBolt.rotation.x = Math.PI * 0.5;
      trunBolt.position.set(Math.cos(a) * 0.68, Math.sin(a) * 0.68, 0.18);
      bobGroup.add(trunBolt);
    }

    // Inner cast-iron cradle + bronze end-caps housing a clean vertical cyan IN-13 bargraph tube
    const cradlePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.14, 28), castIronMat);
    cradlePlate.rotation.x = Math.PI * 0.5;
    cradlePlate.position.z = -0.04;
    bobGroup.add(cradlePlate);

    for (const capY of [-0.52, 0.52]) {
      const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 16), bronzeMat);
      endCap.position.set(0, capY, 0.14);
      bobGroup.add(endCap);
    }

    const barGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.96, 16), glassMat);
    barGlass.position.z = 0.14;
    bobGroup.add(barGlass);

    this.bargraphMaterial = new THREE.MeshStandardMaterial({
      color: 0xb2ffff,
      emissive: MARIANA_COLORS.BIOLUM_CYAN,
      emissiveIntensity: 2.1
    });
    const barGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.88, 14);
    barGeo.translate(0, 0.44, 0);
    this.bargraphFillMesh = new THREE.Mesh(barGeo, this.bargraphMaterial);
    this.bargraphFillMesh.position.set(0, -0.44, 0.14);
    bobGroup.add(this.bargraphFillMesh);

    pendulumPivot.add(bobGroup);
    aquariumGroup.add(pendulumPivot);
    this.pendulumPivotGroup = pendulumPivot;

    // Bubbles shed from swinging clinometer bob
    const pBubbleCount = 36;
    const pbPos = new Float32Array(pBubbleCount * 3);
    this.pendulumBubbleVel = new Float32Array(pBubbleCount * 2);
    for (let i = 0; i < pBubbleCount; i++) {
      pbPos[i * 3] = (Math.random() - 0.5) * 0.9;
      pbPos[i * 3 + 1] = -6.5 + Math.random() * 3.5;
      pbPos[i * 3 + 2] = -1.65 + (Math.random() - 0.5) * 0.25;
      this.pendulumBubbleVel[i * 2] = (Math.random() - 0.5) * 0.15;
      this.pendulumBubbleVel[i * 2 + 1] = 0.35 + Math.random() * 0.45;
    }
    const pbGeo = new THREE.BufferGeometry();
    pbGeo.setAttribute('position', new THREE.BufferAttribute(pbPos, 3));
    this.pendulumBubbles = new THREE.Points(pbGeo, bubbleMat);
    aquariumGroup.add(this.pendulumBubbles);

    // Articulated 3D Translucent Deep-Sea Jellyfish with Fresnel rim-lighting
    this.jellyBellMat = createJellyfishBellMaterial();
    this.jellyCoreMat = new THREE.MeshStandardMaterial({
      color: 0xb2ffff,
      emissive: MARIANA_COLORS.BIOLUM_CYAN,
      emissiveIntensity: 1.45
    });
    this.jellyfish = createJellyfishRig(this.jellyBellMat, this.jellyCoreMat, this.jellyBellMat);
    this.jellyfish.root.position.set(1.8, -4.4, -2.75);
    this.jellyfish.root.scale.setScalar(1.05);
    aquariumGroup.add(this.jellyfish.root);

    // Recessed 3D CRT Sonar Gauge in bottom-left corner
    const sonarGroup = new THREE.Group();
    sonarGroup.position.set(
      MARIANA_GEOMETRY.SONAR_CENTER_WORLD.x,
      MARIANA_GEOMETRY.SONAR_CENTER_WORLD.y,
      -0.32
    );
    const sonarR = MARIANA_GEOMETRY.SONAR_RADIUS_WORLD;
    const sonarBezel = new THREE.Mesh(
      createPortholeBezelGeometry(sonarR * 0.88, sonarR * 1.06, 0.24),
      bronzeMat
    );
    sonarBezel.castShadow = true;
    sonarGroup.add(sonarBezel);

    this.sonarMaterial = createCrtSonarMaterial();
    const sonarScreen = new THREE.Mesh(new THREE.CircleGeometry(sonarR * 0.88, 36), this.sonarMaterial);
    sonarScreen.position.z = -0.04;
    sonarGroup.add(sonarScreen);

    const sonarGlass = new THREE.Mesh(createCurvedLensGeometry(sonarR * 0.88, 0.08), glassMat);
    sonarGlass.position.z = 0.05;
    sonarGroup.add(sonarGlass);

    aquariumGroup.add(sonarGroup);
    stage.scene.add(aquariumGroup);
    this.aquariumGroup = aquariumGroup;

    stage.registerObjectTree(stage.scene);
  }

  public renderPendulum(_ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted || !this.stage) return;

    if (this.currentMode === 'sleep' || physicsData.dampingFactor <= 0.001) {
      if (this.pendulumPivotGroup) {
        this.pendulumPivotGroup.rotation.z = 0;
      }
      return;
    }

    if (this.pendulumPivotGroup) {
      // Smooth hydrodynamic drag feel via slight easing
      const targetAngle = physicsData.angleRad * physicsData.dampingFactor;
      this.pendulumPivotGroup.rotation.z += (targetAngle - this.pendulumPivotGroup.rotation.z) * 0.35;
    }
  }

  public renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted || !this.stage) return;

    const dtSec =
      this.lastTickTimestampMs !== null
        ? Math.max(0.001, Math.min(0.1, (timeData.realTimeMs - this.lastTickTimestampMs) / 1000))
        : Math.max(0.001, Math.min(0.1, timeData.deltaTimeSec || 0.016));
    this.lastTickTimestampMs = timeData.realTimeMs;

    const isSleep = this.targetMode === 'sleep';
    const isNight = this.targetMode === 'night';
    this.currentMode = this.targetMode;

    if (!isSleep) {
      this.simTimeSec += dtSec;
    }

    // 1. Update synchronized digital time & ~100 ms tube filament crossfade
    const tick: SynchronizedTimeTick =
      timeData.digitalTick ??
      formatSynchronizedTime(timeData.date, sharedDisplayOptions.getOptions());
    const digits = [
      tick.hourDigits[0],
      tick.hourDigits[1],
      tick.minuteDigits[0],
      tick.minuteDigits[1],
      tick.secondDigits[0],
      tick.secondDigits[1]
    ];
    this.lastActiveDigits = digits;

    const nowMs = timeData.realTimeMs;
    const activeIntensity = isSleep
      ? MARIANA_SLEEP_FILAMENT_INTENSITY
      : (isNight ? 0.45 : 1.22) + this.alertPulse * 0.45;
    const tubeLightTarget = isSleep ? 0 : isNight ? 0.42 : 1.15 + this.alertPulse * 0.7;

    for (let i = 0; i < this.tubes.length; i++) {
      const tube = this.tubes[i];
      const nextChar = digits[i] ?? '0';
      if (nextChar !== tube.currentChar) {
        tube.previousChar = tube.currentChar;
        tube.currentChar = nextChar;
        tube.transitionStartMs = nowMs;
      }

      const elapsed = nowMs - tube.transitionStartMs;
      const linearT = Math.min(1, Math.max(0, elapsed / MARIANA_TUBE_CROSSFADE_MS));
      // Exponential gas crossfade + brief ignition surge on digit change
      const blend = 1 - Math.exp(-4.5 * linearT);
      const ignitionSurge = Math.exp(-6.0 * linearT) * (linearT < 0.99 ? 1.0 : 0.0);
      if (linearT >= 1) {
        tube.previousChar = null;
      }

      tube.housingGroup.visible = !isSleep;
      tube.pointLight.intensity = tubeLightTarget;

      for (const d of DIGITS) {
        const mesh = tube.digitMeshes[d];
        const mat = tube.digitMaterials[d];
        const isCurrent = d === tube.currentChar;
        const isPrev = d === tube.previousChar;
        const weight = isCurrent ? blend : isPrev ? 1 - blend : 0;

        if (isSleep) {
          mesh.visible = isCurrent || isPrev;
          mat.uniforms.uIntensity.value = MARIANA_SLEEP_FILAMENT_INTENSITY;
          mat.uniforms.uActiveWeight.value = weight;
          mat.uniforms.uIgnitionSurge.value = 0;
          mat.uniforms.uOpacity.value = weight;
        } else {
          mesh.visible = true;
          mat.uniforms.uIntensity.value = activeIntensity;
          mat.uniforms.uActiveWeight.value = weight;
          mat.uniforms.uIgnitionSurge.value = isCurrent ? ignitionSurge : 0;
          mat.uniforms.uOpacity.value = isCurrent || isPrev ? 1.0 : 0.28;
        }
      }
    }

    // 2. Sleep (Cat Mode) vs Active/Night visibility, caustics & camera parallax
    if (this.chassisGroup) this.chassisGroup.visible = !isSleep;
    if (this.portholeGroup) this.portholeGroup.visible = !isSleep;
    if (this.tubeBayHousingGroup) this.tubeBayHousingGroup.visible = !isSleep;
    if (this.colonGroup) this.colonGroup.visible = !isSleep;
    if (this.aquariumGroup) this.aquariumGroup.visible = !isSleep;
    if (this.tubeBubbles) this.tubeBubbles.visible = !isSleep;

    if (isSleep) {
      this.stage.scene.background = new THREE.Color(MARIANA_COLORS.SLEEP_BLACK);
      this.causticUniforms.uCausticStrength.value = 0.0;
      if (this.keyLight) this.keyLight.intensity = 0;
      if (this.warmRimLight) this.warmRimLight.intensity = 0;
      if (this.coolRimLight) this.coolRimLight.intensity = 0;
      if (this.hemiLight) this.hemiLight.intensity = 0;
      if (this.portholeLight) this.portholeLight.intensity = 0;
      if (this.aquariumSpotLight) this.aquariumSpotLight.intensity = 0;

      if (timeData.realTimeMs - this.lastSleepRenderTimeMs < 950) {
        return;
      }
      this.lastSleepRenderTimeMs = timeData.realTimeMs;
      if (this.portholeGroup) {
      const offset = ThreeStage.dialCenterToOffsetWorld(
        this.manifest.dial.center.x,
        this.manifest.dial.center.y
      );
      this.portholeGroup.position.x = offset.x;
      this.portholeGroup.position.y = 5.1 + offset.y;
    }
    this.stage.render();
      return;
    }

    // Multi-harmonic camera drift + subtle mouse/pointer parallax
    this.pointerSmoothX += (this.pointerTargetX - this.pointerSmoothX) * 0.06;
    this.pointerSmoothY += (this.pointerTargetY - this.pointerSmoothY) * 0.06;
    const driftX = Math.sin(this.simTimeSec * 0.23) * 0.14 + Math.sin(this.simTimeSec * 0.41) * 0.05;
    const driftY = Math.cos(this.simTimeSec * 0.17) * 0.1 + Math.cos(this.simTimeSec * 0.37) * 0.04;
    this.stage.camera.position.set(
      driftX + this.pointerSmoothX * 0.45,
      driftY + this.pointerSmoothY * 0.35,
      this.stage.baseCameraZ
    );
    this.stage.camera.lookAt(0, 0, -1.8);

    // Active / Night lighting, subtle Voronoi caustics (~17%) & scene atmosphere
    this.stage.scene.background = new THREE.Color(0x030508);
    this.causticUniforms.uTime.value = this.simTimeSec;
    this.causticUniforms.uCausticStrength.value = isNight ? 0.06 : 0.17;
    const modeScale = isNight ? 0.28 : 1.0;
    if (this.keyLight) this.keyLight.intensity = 1.65 * modeScale;
    if (this.warmRimLight) this.warmRimLight.intensity = 0.75 * modeScale;
    if (this.coolRimLight) this.coolRimLight.intensity = 0.65 * modeScale;
    if (this.hemiLight) this.hemiLight.intensity = 0.45 * modeScale;
    if (this.portholeLight) this.portholeLight.intensity = 2.1 * modeScale;
    if (this.aquariumSpotLight) this.aquariumSpotLight.intensity = 11.0 * modeScale;
    if (this.tritiumMaterial) this.tritiumMaterial.emissiveIntensity = isNight ? 0.55 : 1.45;
    if (this.colonMaterial) {
      const pulse = 0.75 + 0.25 * Math.sin(this.simTimeSec * Math.PI * 2);
      this.colonMaterial.emissiveIntensity = (isNight ? 0.45 : 1.5) * pulse;
    }

    // 3. Zone 01: Hands & Meshing Gear-Train Kinematics
    const hourRad = THREE.MathUtils.degToRad(timeData.angles.hour);
    const minuteRad = THREE.MathUtils.degToRad(timeData.angles.minute);
    const secondRad = THREE.MathUtils.degToRad(timeData.angles.second);

    if (this.hourHandPivot) this.hourHandPivot.rotation.z = -hourRad;
    if (this.minuteHandPivot) this.minuteHandPivot.rotation.z = -minuteRad;
    if (this.secondHandPivot) this.secondHandPivot.rotation.z = -secondRad;

    const baseGearAngle = -secondRad;
    if (this.centerWheel) this.centerWheel.rotation.z = baseGearAngle;
    if (this.thirdWheel) this.thirdWheel.rotation.z = -baseGearAngle * (48 / 32) + 0.1;
    if (this.fourthWheel) this.fourthWheel.rotation.z = baseGearAngle * (48 / 24);
    if (this.escapementWheel) this.escapementWheel.rotation.z = -baseGearAngle * (48 / 18);

    if (this.causticMaterial) this.causticMaterial.uniforms.uTime.value = this.simTimeSec;
    if (this.aquariumFloorCausticMat) {
      this.aquariumFloorCausticMat.uniforms.uTime.value = this.simTimeSec * 0.75;
    }

    // 4. Zone 02 & 03 Particle Animations (Micro-bubbles, Plankton, Pendulum Shed)
    this.updateParticles(dtSec);

    // 5. Zone 03: Clinometer Bargraph, Jellyfish & CRT Sonar Sweep
    const secFraction = (timeData.seconds + timeData.milliseconds / 1000) / 60;
    this.lastBargraphRatio = Math.max(0.05, Math.min(1, secFraction));
    if (this.bargraphFillMesh) {
      this.bargraphFillMesh.scale.y = this.lastBargraphRatio;
    }
    if (this.bargraphMaterial) {
      this.bargraphMaterial.emissiveIntensity = isNight ? 0.7 : 2.0 + this.alertPulse;
    }

    this.volumetricShaftMats.forEach((mat, idx) => {
      mat.uniforms.uTime.value = this.simTimeSec;
      const baseOp = idx === 0 ? 0.14 : idx === 1 ? 0.1 : 0.09;
      mat.uniforms.uOpacity.value = isNight ? baseOp * 0.35 : baseOp;
    });

    if (this.jellyfish) {
      const jt = this.simTimeSec;
      const pulse = Math.sin(jt * 2.1);
      if (this.jellyBellMat) {
        this.jellyBellMat.uniforms.uTime.value = jt;
        this.jellyBellMat.uniforms.uPulse.value = pulse * 0.5 + 0.5;
        this.jellyBellMat.uniforms.uOpacity.value = isNight ? 0.35 : 0.62;
      }
      if (this.jellyCoreMat) {
        this.jellyCoreMat.emissiveIntensity = (isNight ? 0.5 : 1.45) + pulse * 0.4;
      }
      this.jellyfish.root.position.set(
        Math.sin(jt * 0.16) * 2.55,
        -4.45 + Math.sin(jt * 0.42) * 0.75 + pulse * 0.08,
        -2.75 + Math.cos(jt * 0.16) * 0.35
      );
      this.jellyfish.root.rotation.z = Math.cos(jt * 0.16) * 0.16;
      this.jellyfish.bell.scale.set(1 + pulse * 0.09, 1 - pulse * 0.12, 1 + pulse * 0.09);
      this.jellyfish.oralArms.forEach((arm, idx) => {
        arm.rotation.z = Math.sin(jt * 1.9 - idx * 0.8) * 0.16;
      });
      this.jellyfish.tentacles.forEach((t, idx) => {
        t.rotation.z = Math.sin(jt * 2.1 - idx * 0.5) * 0.12;
      });
    }

    // Slow underwater current harmonic on frayed hemp rope strands
    this.frayedRopeGroups.forEach((fg, idx) => {
      fg.rotation.z = Math.sin(this.simTimeSec * 0.95 + idx * 1.4) * 0.085;
      fg.rotation.x = Math.cos(this.simTimeSec * 0.72 + idx * 0.9) * 0.045;
    });

    this.sonarSweepRad = (this.sonarSweepRad - dtSec * 1.35) % (Math.PI * 2);
    if (this.sonarMaterial) {
      this.sonarMaterial.uniforms.uTime.value = this.simTimeSec;
      this.sonarMaterial.uniforms.uSweepAngle.value = this.sonarSweepRad;
      this.sonarMaterial.uniforms.uIntensity.value = isNight ? 0.42 : 1.0;
      this.sonarMaterial.uniforms.uPingPulse.value = this.alertPulse;
    }

    if (this.alertPulse > 0) {
      this.alertPulse = Math.max(0, this.alertPulse - dtSec * 1.4);
    }

    if (this.portholeGroup) {
      const offset = ThreeStage.dialCenterToOffsetWorld(
        this.manifest.dial.center.x,
        this.manifest.dial.center.y
      );
      this.portholeGroup.position.x = offset.x;
      this.portholeGroup.position.y = 5.1 + offset.y;
    }
    this.stage.render();
  }

  private updateParticles(dtSec: number): void {
    if (this.tubeBubbles && this.tubeBubbleSpeeds) {
      const pos = this.tubeBubbles.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + this.tubeBubbleSpeeds[i] * dtSec;
        if (y > 0.85) y = -0.92;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }

    if (this.planktonPoints && this.planktonPhase) {
      const pos = this.planktonPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const ph = this.planktonPhase[i];
        const x = pos.getX(i) + Math.sin(this.simTimeSec * 0.4 + ph) * 0.06 * dtSec;
        let y = pos.getY(i) + Math.cos(this.simTimeSec * 0.3 + ph) * 0.04 * dtSec;
        if (y > -1.9) y = -8.0;
        if (y < -8.0) y = -1.9;
        pos.setX(i, x);
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }

    if (this.pendulumBubbles && this.pendulumBubbleVel && this.pendulumPivotGroup) {
      const pos = this.pendulumBubbles.geometry.attributes.position as THREE.BufferAttribute;
      const theta = this.pendulumPivotGroup.rotation.z;
      const bobX = Math.sin(theta) * MARIANA_GEOMETRY.PENDULUM_LENGTH_WORLD;
      const bobY =
        MARIANA_GEOMETRY.PENDULUM_PIVOT_WORLD.y -
        Math.cos(theta) * MARIANA_GEOMETRY.PENDULUM_LENGTH_WORLD;

      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + this.pendulumBubbleVel[i * 2] * dtSec;
        let y = pos.getY(i) + this.pendulumBubbleVel[i * 2 + 1] * dtSec;
        if (y > -2.1) {
          x = bobX + (Math.random() - 0.5) * 0.45;
          y = bobY + (Math.random() - 0.5) * 0.25;
        }
        pos.setX(i, x);
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    if (telemetryData.mode && telemetryData.mode !== this.targetMode) {
      this.targetMode = telemetryData.mode;
    }

    if (telemetryData.isSleeping || this.targetMode === 'sleep') {
      return;
    }

    if (!telemetryData.showDebugGrid) {
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(2, 10, 16, 0.78)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(720, 1740, 240, 60, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00E5FF';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ABYSS ${telemetryData.fps.toFixed(0)} FPS`, 840, 1776);
    ctx.restore();
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;

    if (event.type === 'mode_change' && event.payload) {
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload.mode === 'string') {
        const nextMode = payload.mode as ClockMode;
        if (nextMode === 'active' || nextMode === 'silent' || nextMode === 'night' || nextMode === 'sleep') {
          this.targetMode = nextMode;
        }
      }
      return;
    }

    if (
      event.type === 'notification' ||
      event.type === 'priority_alert' ||
      event.type === 'mqtt_pulse' ||
      event.type === 'chime'
    ) {
      this.alertPulse = event.priority === 'urgent' ? 1.0 : 0.65;
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.cleanupPointerParallax();
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
    this.tubes = [];
    this.frayedRopeGroups = [];
    this.volumetricShaftMats = [];
    this.chassisGroup = null;
    this.portholeGroup = null;
    this.tubeBayHousingGroup = null;
    this.colonGroup = null;
    this.aquariumGroup = null;
    this.jellyfish = null;
  }
}
