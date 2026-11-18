import * as THREE from 'three';
import { ThemeManifest, ClockMode } from '../../types/theme';
import {
  Theme,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent,
  ThemeNotificationStyle
} from '../types';
import { ThreeStage, ThreeStageResourceStats } from '../three/ThreeStage';
import {
  PCB_2049_MANIFEST,
  PCB_2049_EMERALD_MANIFEST,
  PCB_EMERALD_COLORS,
  PCB_GEOMETRY,
  LEFT_LATERAL_BUS_PATHS,
  RIGHT_LATERAL_BUS_PATHS,
  EMERALD_LOWER_LEFT_BUS_PATHS,
  EMERALD_LOWER_RIGHT_BUS_PATHS,
  PcbThemeVariant
} from './constants';
import {
  pxToWorld,
  createSteppedPcbBoardGeometry,
  createDialRadialBusPaths,
  createTraceRibbonGeometry,
  createPcbLpiReliefTextures,
  createBoardSilkscreenTexture,
  createDialSilkscreenTexture,
  createKaptonRibbonGeometry,
  updateKaptonRibbonFlex,
  createMilledClockHand,
  createQfnPackageGroup,
  createMachinedWaferBezelGeometry
} from './geometries';
import { createThreeWaferShaderMaterial } from './waferShader';
import { PcbHudOverlay } from './hudOverlay';

export const PCB_SLEEP_EMISSIVE_INTENSITY = 0.135;

export interface Pcb2049DebugState {
  variant: PcbThemeVariant;
  mode: ClockMode;
  isSleepActive: boolean;
  boardVisible: boolean;
  pendulumVisible: boolean;
  keyLightIntensity: number;
  handPointLightIntensity: number;
  handEmissiveIntensity: number;
  pendulumAngleRad: number;
  cameraPosition: [number, number, number];
  bloomThreshold: number;
  bloomStrength: number;
}

export class Pcb2049Theme implements Theme {
  public readonly id: string;
  public readonly name: string;

  private readonly variant: PcbThemeVariant;
  private manifest: ThemeManifest;
  private stage: ThreeStage | null = null;
  private hudOverlay: PcbHudOverlay;

  private isMounted = false;
  private currentMode: ClockMode = 'active';
  private lastSleepRenderTimeMs = -10000;
  private lastPendulumAngleRad = 0;

  // Multi-harmonic camera drift & pointer parallax
  private cameraPhaseSec = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerCurrentX = 0;
  private pointerCurrentY = 0;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;

  // Scene visibility groups for Sleep (Cat mode)
  private boardGroup: THREE.Group | null = null;
  private dialGroup: THREE.Group | null = null;
  private dialBoardGroup: THREE.Group | null = null;
  private smdNonEmissiveGroup: THREE.Group | null = null;
  private pendulumPivotGroup: THREE.Group | null = null;
  private handsGroup: THREE.Group | null = null;
  private handBodyMeshes: THREE.Object3D[] = [];
  private statusLedMeshes: THREE.Object3D[] = [];
  private emissiveIndicatorMeshes: THREE.Object3D[] = [];

  // Lights
  private ambientLight: THREE.AmbientLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private handPointLight: THREE.PointLight | null = null;
  private waferAccentLight: THREE.PointLight | null = null;

  // Dynamic materials & geometries
  private handEmissiveMaterial: THREE.MeshBasicMaterial | null = null;
  private statusLedEmissiveMaterial: THREE.MeshStandardMaterial | null = null;
  private cyanLedEmissiveMaterial: THREE.MeshStandardMaterial | null = null;
  private waferShaderMaterial: THREE.ShaderMaterial | null = null;
  private kaptonRibbonGeo: THREE.BufferGeometry | null = null;
  private kaptonCopperGeo: THREE.BufferGeometry | null = null;
  private kaptonRibbonLength = 3.2;

  // Clock hand pivots
  private hourHandPivot: THREE.Group | null = null;
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;

  // Alert pulse boost
  private alertPulseBoost = 0;

  constructor(variant: PcbThemeVariant = 'standard') {
    this.variant = variant;
    this.id = variant === 'emerald' ? 'pcb_2049_emerald' : 'pcb_2049';
    this.name =
      variant === 'emerald' ? 'Silicon Master // Rev B' : 'PCB-2049 / Industrial Silicon';
    this.manifest = structuredClone(
      variant === 'emerald' ? PCB_2049_EMERALD_MANIFEST : PCB_2049_MANIFEST
    );
    this.hudOverlay = new PcbHudOverlay(variant);
  }

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getNotificationStyle(): Partial<ThemeNotificationStyle> {
    const isEmerald = this.variant === 'emerald';
    return {
      background: isEmerald ? 'rgba(9, 30, 21, 0.90)' : 'rgba(12, 14, 18, 0.88)',
      borderColor: isEmerald ? 'rgba(244, 196, 98, 0.65)' : 'rgba(244, 196, 98, 0.55)',
      borderWidth: '1.5px',
      borderRadius: '4px',
      textColor: '#e8e2d0',
      mutedTextColor: 'rgba(232, 226, 208, 0.62)',
      accentColor: '#f4c462',
      doorbellAccent: isEmerald ? '#ff8533' : '#ffb838',
      alertAccent: '#ff3b30',
      boxShadow: isEmerald
        ? '0 18px 44px rgba(4, 9, 7, 0.9), 0 0 24px rgba(244, 196, 98, 0.22), inset 0 0 18px rgba(19, 61, 43, 0.45)'
        : '0 18px 44px rgba(0, 0, 0, 0.85), 0 0 24px rgba(244, 196, 98, 0.24), inset 0 0 18px rgba(200, 150, 62, 0.08)',
      cornerStyle: 'chamfered'
    };
  }

  public getThreeStage(): ThreeStage | null {
    return this.stage;
  }

  public getResourceStats(): ThreeStageResourceStats | null {
    return this.stage ? this.stage.getResourceStats() : null;
  }

  public getDebugState(): Pcb2049DebugState {
    const camPos = this.stage?.camera.position;
    const handEmissiveLevel = !this.handEmissiveMaterial
      ? 0
      : this.currentMode === 'sleep'
        ? PCB_SLEEP_EMISSIVE_INTENSITY
        : this.currentMode === 'night'
          ? 0.65
          : 2.5;
    return {
      variant: this.variant,
      mode: this.currentMode,
      isSleepActive: this.currentMode === 'sleep',
      boardVisible: this.boardGroup?.visible ?? false,
      pendulumVisible: this.pendulumPivotGroup?.visible ?? false,
      keyLightIntensity: this.keyLight?.intensity ?? 0,
      handPointLightIntensity: this.handPointLight?.intensity ?? 0,
      handEmissiveIntensity: handEmissiveLevel,
      pendulumAngleRad: this.lastPendulumAngleRad,
      cameraPosition: camPos ? [camPos.x, camPos.y, camPos.z] : [0, 0, 0],
      bloomThreshold: 0.92,
      bloomStrength: 0.6
    };
  }

  public async mount(_canvasContext: CanvasRenderingContext2D, config?: ThemeConfig): Promise<void> {
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }

    if (config?.manifest) {
      this.manifest = structuredClone(config.manifest);
    } else {
      this.manifest = structuredClone(
        this.variant === 'emerald' ? PCB_2049_EMERALD_MANIFEST : PCB_2049_MANIFEST
      );
    }

    this.isMounted = true;
    this.currentMode = 'active';
    this.lastSleepRenderTimeMs = -10000;
    this.lastPendulumAngleRad = 0;
    this.alertPulseBoost = 0;
    this.handBodyMeshes = [];
    this.statusLedMeshes = [];
    this.emissiveIndicatorMeshes = [];

    const stage = new ThreeStage({
      width: config?.width ?? PCB_GEOMETRY.WIDTH,
      height: config?.height ?? PCB_GEOMETRY.HEIGHT,
      fov: 35,
      chamberDepth: 4.0,
      stageElement: config?.stageElement,
      bloomThreshold: 0.92,
      bloomStrength: 0.6,
      bloomRadius: 0.35
    });
    this.stage = stage;

    await stage.init();
    if (!this.isMounted || this.stage !== stage) {
      stage.dispose();
      return;
    }

    this.setupPointerParallax();
    this.buildSceneGraph(stage);
    this.applyModeLighting();
    stage.clearCameraViewOffset();
    this.syncDialGroupPosition();
    this.hudOverlay.spawnElectronPacketWave(false);
    stage.render();
  }

  private setupPointerParallax(): void {
    this.cleanupPointerParallax();
    if (typeof window === 'undefined') return;

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (this.currentMode === 'sleep') return;
      const w = window.innerWidth || PCB_GEOMETRY.WIDTH;
      const h = window.innerHeight || PCB_GEOMETRY.HEIGHT;
      const nx = (e.clientX / w) * 2 - 1;
      const ny = (e.clientY / h) * 2 - 1;
      this.pointerTargetX = Math.max(-1, Math.min(1, nx));
      this.pointerTargetY = Math.max(-1, Math.min(1, -ny));
    };

    window.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
  }

  private cleanupPointerParallax(): void {
    if (this.boundOnPointerMove && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.boundOnPointerMove);
    }
    this.boundOnPointerMove = null;
  }

  private buildStudioEnvironmentScene(): THREE.Scene {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x060a08);

    // Dimmed overhead warm-white studio softbox
    const overheadPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 6),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.5, 1.38, 1.15),
        side: THREE.DoubleSide
      })
    );
    overheadPanel.position.set(0, 12, 10);
    overheadPanel.lookAt(0, 0, 0);
    envScene.add(overheadPanel);

    // Subtle front-angled warm-white softbox for clean metallic gold reflections without haze
    const frontCenterPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.05, 0.96, 0.82),
        side: THREE.DoubleSide
      })
    );
    frontCenterPanel.position.set(0, 1.5, 16);
    frontCenterPanel.lookAt(0, 0, 0);
    envScene.add(frontCenterPanel);

    // Front-left warm gold accent strip
    const frontLeftPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.25, 1.05, 0.72),
        side: THREE.DoubleSide
      })
    );
    frontLeftPanel.position.set(-9, 2, 12);
    frontLeftPanel.lookAt(0, 0, 0);
    envScene.add(frontLeftPanel);

    // Front-right cool-white fill strip for crisp metallic contrast
    const frontRightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.95, 1.05, 1.2),
        side: THREE.DoubleSide
      })
    );
    frontRightPanel.position.set(9, -1, 12);
    frontRightPanel.lookAt(0, 0, 0);
    envScene.add(frontRightPanel);

    return envScene;
  }

  private buildSceneGraph(stage: ThreeStage): void {
    const scene = stage.scene;
    scene.background = new THREE.Color(0x020604);
    stage.setEnvironmentFromScene(this.buildStudioEnvironmentScene());
    scene.environmentIntensity = 0.35;

    // --- 1. Studio Lighting Rig ---
    const ambientLight = new THREE.AmbientLight(0xd8f0e4, 0.35);
    scene.add(ambientLight);
    this.ambientLight = ambientLight;

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.85);
    keyLight.position.set(3.8, 6.2, 11.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 26;
    keyLight.shadow.camera.left = -6.5;
    keyLight.shadow.camera.right = 6.5;
    keyLight.shadow.camera.top = 10.5;
    keyLight.shadow.camera.bottom = -10.5;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);
    this.keyLight = keyLight;

    const rimLight = new THREE.DirectionalLight(0x88d4ff, 0.75);
    rimLight.position.set(-5.5, -3.5, 8.0);
    scene.add(rimLight);
    this.rimLight = rimLight;

    const dialCenterW = ThreeStage.canvasToWorldXY(
      PCB_GEOMETRY.DIAL_CENTER.x,
      PCB_GEOMETRY.DIAL_CENTER.y
    );

    // Dynamic warm neon-orange point light from glowing hands casting shadows across gold & QFN chips
    const handPointLight = new THREE.PointLight(0xff7324, 2.6, 8.5, 1.6);
    handPointLight.position.set(dialCenterW.x, dialCenterW.y, 0.85);
    handPointLight.castShadow = true;
    handPointLight.shadow.mapSize.set(1024, 1024);
    handPointLight.shadow.bias = -0.0005;
    scene.add(handPointLight);
    this.handPointLight = handPointLight;

    const waferCenterW = ThreeStage.canvasToWorldXY(
      PCB_GEOMETRY.PENDULUM_PIVOT.x,
      PCB_GEOMETRY.PENDULUM_PIVOT.y + PCB_GEOMETRY.PENDULUM_LENGTH
    );
    const waferAccentLight = new THREE.PointLight(0x90e8ff, 0.9, 6.0, 1.8);
    waferAccentLight.position.set(waferCenterW.x + 1.2, waferCenterW.y + 1.4, 2.2);
    scene.add(waferAccentLight);
    this.waferAccentLight = waferAccentLight;

    // --- 2. Shared PBR Materials ---
    const chassisAnodizedMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x050a08,
        metalness: 0.72,
        roughness: 0.42
      })
    );

    const fr4CoreMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x091c12,
        metalness: 0.08,
        roughness: 0.65
      })
    );

    const buriedCopperMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xc8963e,
        metalness: 0.95,
        roughness: 0.28
      })
    );

    const { bumpMap: lpiBump, roughnessMap: lpiRough } = createPcbLpiReliefTextures();
    stage.trackTexture(lpiBump);
    stage.trackTexture(lpiRough);

    // Rich deep-emerald LPI soldermask (MeshPhysicalMaterial)
    const lpiSoldermaskMat = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0x052918,
        metalness: 0.05,
        roughness: 0.24,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        bumpMap: lpiBump,
        bumpScale: 0.018,
        roughnessMap: lpiRough
      })
    );

    // Crisp non-blooming metallic ENIG gold (zero emissive)
    const enigGoldMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.82,
        roughness: 0.26,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0
      })
    );

    const drillHoleMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x020403,
        metalness: 0.1,
        roughness: 0.95
      })
    );

    const qfnBodyMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x111316,
        metalness: 0.08,
        roughness: 0.74
      })
    );

    const solderFilletMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xd8dce2,
        metalness: 0.96,
        roughness: 0.16,
        envMapIntensity: 0.8
      })
    );

    const ceramicBodyMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x8b6743,
        metalness: 0.05,
        roughness: 0.55
      })
    );

    // Dark gunmetal / anodized black precision-milled outer hand frames
    const milledHandBodyMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x1a1d20,
        metalness: 0.8,
        roughness: 0.3
      })
    );

    // Emissive materials (>0.92 luminance threshold in active mode so ONLY these bloom)
    const handEmissiveMat = stage.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.0, 0.45, 0.08),
        toneMapped: false
      })
    );
    this.handEmissiveMaterial = handEmissiveMat;

    const statusLedMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xff8533,
        emissive: new THREE.Color(PCB_EMERALD_COLORS.BEAM_ORANGE_BLOOM),
        emissiveIntensity: 1.8,
        roughness: 0.2
      })
    );
    this.statusLedEmissiveMaterial = statusLedMat;

    const cyanLedMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x38f8ff,
        emissive: new THREE.Color(PCB_EMERALD_COLORS.CYAN_LED),
        emissiveIntensity: 1.6,
        roughness: 0.2
      })
    );
    this.cyanLedEmissiveMaterial = cyanLedMat;

    // --- 3. Multi-Layer PCB Chassis & Circular Dial Stackup ---
    const boardGroup = new THREE.Group();
    scene.add(boardGroup);
    this.boardGroup = boardGroup;

    // Outer anodized chassis backing (extended >= ±600px beyond 1080x1920 viewport)
    const chassisGeo = stage.trackGeometry(new THREE.BoxGeometry(24.0, 32.0, 0.2));
    const chassisMesh = new THREE.Mesh(chassisGeo, chassisAnodizedMat);
    chassisMesh.position.set(0, 0, -0.32);
    chassisMesh.receiveShadow = true;
    boardGroup.add(chassisMesh);

    // Stepped FR-4 Core Board (z = -0.20 to -0.08)
    const boardCoreGeo = stage.trackGeometry(createSteppedPcbBoardGeometry(0.12, true));
    const boardCoreMesh = new THREE.Mesh(boardCoreGeo, fr4CoreMat);
    boardCoreMesh.position.set(0, 0, -0.20);
    boardCoreMesh.receiveShadow = true;
    boardGroup.add(boardCoreMesh);

    // Buried copper trace geometry beneath the glossy emerald LPI soldermask (z = -0.065 to -0.050)
    const buriedPaths = [...LEFT_LATERAL_BUS_PATHS, ...RIGHT_LATERAL_BUS_PATHS];
    const buriedTracesGeo = stage.trackGeometry(createTraceRibbonGeometry(buriedPaths, 5.5, 0.015));
    const buriedTracesMesh = new THREE.Mesh(buriedTracesGeo, buriedCopperMat);
    buriedTracesMesh.position.set(0, 0, -0.065);
    boardGroup.add(buriedTracesMesh);

    // Glossy emerald LPI soldermask layer over the FR-4 core & buried copper traces (z = -0.045 to -0.015)
    const maskBoardGeo = stage.trackGeometry(createSteppedPcbBoardGeometry(0.030, false));
    const maskBoardMesh = new THREE.Mesh(maskBoardGeo, lpiSoldermaskMat);
    maskBoardMesh.position.set(0, 0, -0.045);
    maskBoardMesh.receiveShadow = true;
    boardGroup.add(maskBoardMesh);

    // Exposed ENIG Gold Traces (Lateral Buses + Lower Wafer Buses) (z = -0.005 to +0.013)
    const exposedBusPaths = [
      ...LEFT_LATERAL_BUS_PATHS,
      ...RIGHT_LATERAL_BUS_PATHS,
      ...EMERALD_LOWER_LEFT_BUS_PATHS,
      ...EMERALD_LOWER_RIGHT_BUS_PATHS
    ];
    const exposedGoldTracesGeo = stage.trackGeometry(
      createTraceRibbonGeometry(exposedBusPaths, 3.2, 0.018)
    );
    const exposedGoldTracesMesh = new THREE.Mesh(exposedGoldTracesGeo, enigGoldMat);
    exposedGoldTracesMesh.position.set(0, 0, -0.005);
    exposedGoldTracesMesh.receiveShadow = true;
    boardGroup.add(exposedGoldTracesMesh);

    // Bottom PCIe-style ENIG Gold Edge-Connector Fingers (z = +0.005 to +0.021)
    const fingerGeo = stage.trackGeometry(new THREE.BoxGeometry(0.13, 0.72, 0.016));
    for (let i = 0; i < 24; i++) {
      const fx = 252 + i * 24;
      if (fx > 515 && fx < 565) continue; // Center key slot gap
      const fw = ThreeStage.canvasToWorldXY(fx, 1876);
      const fingerMesh = new THREE.Mesh(fingerGeo, enigGoldMat);
      fingerMesh.position.set(fw.x, fw.y, 0.013);
      fingerMesh.receiveShadow = true;
      boardGroup.add(fingerMesh);
    }

    // 3 Asymmetric Global Fiducial Marks (top-left, top-right, bottom-left)
    const fiducialCoords = [
      { px: 86, py: 86 },
      { px: PCB_GEOMETRY.WIDTH - 86, py: 86 },
      { px: 86, py: 1784 }
    ];
    const fidCenterGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.065, 0.065, 0.016, 24));
    fidCenterGeo.rotateX(Math.PI * 0.5);
    const fidClearGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24));
    fidClearGeo.rotateX(Math.PI * 0.5);
    const fidGuardGeo = stage.trackGeometry(new THREE.TorusGeometry(0.135, 0.014, 8, 28));
    for (const fc of fiducialCoords) {
      const fw = ThreeStage.canvasToWorldXY(fc.px, fc.py);
      const clearMesh = new THREE.Mesh(fidClearGeo, drillHoleMat);
      clearMesh.position.set(fw.x, fw.y, 0.004);
      boardGroup.add(clearMesh);

      const centerMesh = new THREE.Mesh(fidCenterGeo, enigGoldMat);
      centerMesh.position.set(fw.x, fw.y, 0.008);
      boardGroup.add(centerMesh);

      const guardMesh = new THREE.Mesh(fidGuardGeo, enigGoldMat);
      guardMesh.position.set(fw.x, fw.y, 0.012);
      boardGroup.add(guardMesh);
    }

    // Board-level Silkscreen Overlay Plane (z = +0.026)
    const boardSilkTex = stage.trackTexture(createBoardSilkscreenTexture());
    const boardSilkMat = stage.trackMaterial(
      new THREE.MeshBasicMaterial({
        map: boardSilkTex,
        transparent: true,
        depthWrite: false
      })
    );
    const silkBoardMesh = new THREE.Mesh(
      stage.trackGeometry(new THREE.PlaneGeometry(10.8, 19.2)),
      boardSilkMat
    );
    silkBoardMesh.position.set(0, 0, 0.026);
    boardGroup.add(silkBoardMesh);

    // Zone 01 Dial Group (moves independently when Dial Center X/Y sliders change)
    const dialGroup = new THREE.Group();
    dialGroup.visible = true;
    scene.add(dialGroup);
    this.dialGroup = dialGroup;

    const dialBoardGroup = new THREE.Group();
    dialGroup.add(dialBoardGroup);
    this.dialBoardGroup = dialBoardGroup;

    // Circular FR-4 + LPI Soldermask Dial Plate at (540, 520) (z = +0.035 to +0.115)
    const dialRadius = pxToWorld(PCB_GEOMETRY.DIAL_OUTER_RADIUS);
    const dialPlateGeo = stage.trackGeometry(
      new THREE.CylinderGeometry(dialRadius, dialRadius + 0.03, 0.08, 96)
    );
    dialPlateGeo.rotateX(Math.PI * 0.5);
    const dialPlateMesh = new THREE.Mesh(dialPlateGeo, lpiSoldermaskMat);
    dialPlateMesh.position.set(dialCenterW.x, dialCenterW.y, 0.075);
    dialPlateMesh.receiveShadow = true;
    dialPlateMesh.castShadow = true;
    dialBoardGroup.add(dialPlateMesh);

    // Crisp ENIG Gold Radial Bus Traces inside the Dial (z = +0.122 to +0.134)
    const dialRadialGeo = stage.trackGeometry(
      createTraceRibbonGeometry(createDialRadialBusPaths(), 2.8, 0.012)
    );
    const dialRadialMesh = new THREE.Mesh(dialRadialGeo, enigGoldMat);
    dialRadialMesh.position.set(0, 0, 0.122);
    dialRadialMesh.receiveShadow = true;
    dialBoardGroup.add(dialRadialMesh);

    // Dial Concentric ENIG Gold Rings (z = +0.128)
    const outerGuardRingGeo = stage.trackGeometry(
      new THREE.TorusGeometry(pxToWorld(436), 0.036, 12, 96)
    );
    const outerGuardRingMesh = new THREE.Mesh(outerGuardRingGeo, enigGoldMat);
    outerGuardRingMesh.position.set(dialCenterW.x, dialCenterW.y, 0.128);
    outerGuardRingMesh.receiveShadow = true;
    dialBoardGroup.add(outerGuardRingMesh);

    const innerChapterRingGeo = stage.trackGeometry(
      new THREE.TorusGeometry(pxToWorld(285), 0.022, 10, 96)
    );
    const innerChapterRingMesh = new THREE.Mesh(innerChapterRingGeo, enigGoldMat);
    innerChapterRingMesh.position.set(dialCenterW.x, dialCenterW.y, 0.128);
    innerChapterRingMesh.receiveShadow = true;
    dialBoardGroup.add(innerChapterRingMesh);

    // Real 3D Recessed Via Holes (board ground-plane vias on boardGroup, dial vias on dialBoardGroup)
    this.buildRecessedViaInstances(stage, boardGroup, dialBoardGroup, enigGoldMat, drillHoleMat, dialCenterW);

    // Dedicated Dial Silkscreen Plane (z = +0.142, cleanly separated from dial gold traces)
    const dialSilkTex = stage.trackTexture(createDialSilkscreenTexture());
    const dialSilkMat = stage.trackMaterial(
      new THREE.MeshBasicMaterial({
        map: dialSilkTex,
        transparent: true,
        depthWrite: false
      })
    );
    const dialSilkMesh = new THREE.Mesh(
      stage.trackGeometry(new THREE.PlaneGeometry(pxToWorld(900), pxToWorld(900))),
      dialSilkMat
    );
    dialSilkMesh.position.set(dialCenterW.x, dialCenterW.y, 0.142);
    dialBoardGroup.add(dialSilkMesh);

    // --- 4. 3D Populated SMD Hardware (QFN ICs, Solder Fillets, Passives, Micro-LEDs, ZIF-16) ---
    const smdNonEmissiveGroup = new THREE.Group();
    scene.add(smdNonEmissiveGroup);
    this.smdNonEmissiveGroup = smdNonEmissiveGroup;

    this.buildPopulatedSmdHardware(
      stage,
      smdNonEmissiveGroup,
      dialBoardGroup,
      scene,
      qfnBodyMat,
      solderFilletMat,
      ceramicBodyMat,
      enigGoldMat,
      statusLedMat,
      cyanLedMat,
      dialCenterW
    );

    // --- 5. Zone 02: Flexible Translucent Kapton Ribbon + Zone 03: Diced Silicon Wafer ---
    this.buildPendulumAssembly(stage, scene, chassisAnodizedMat, buriedCopperMat);

    // --- 6. Precision-Milled 3D Clock Hands + Central ENIG Gold Hub Cap ---
    this.buildClockHands(stage, dialGroup, milledHandBodyMat, handEmissiveMat, enigGoldMat, dialCenterW);
  }

  private buildRecessedViaInstances(
    stage: ThreeStage,
    boardParent: THREE.Group,
    dialParent: THREE.Group,
    enigGoldMat: THREE.Material,
    drillHoleMat: THREE.Material,
    dialCenterW: { x: number; y: number }
  ): void {
    const dialViaPositions: Array<{ x: number; y: number; z: number; scale: number }> = [];
    const boardViaPositions: Array<{ x: number; y: number; z: number; scale: number }> = [];

    // 72 stitched vias around outer dial guard ring
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const r = pxToWorld(436);
      dialViaPositions.push({
        x: dialCenterW.x + Math.cos(rad) * r,
        y: dialCenterW.y + Math.sin(rad) * r,
        z: 0.128,
        scale: 1.0
      });
    }

    // 36 stitched vias around inner chapter ring
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = (deg * Math.PI) / 180;
      const r = pxToWorld(285);
      dialViaPositions.push({
        x: dialCenterW.x + Math.cos(rad) * r,
        y: dialCenterW.y + Math.sin(rad) * r,
        z: 0.128,
        scale: 0.85
      });
    }

    // Gold via-stitched ground-plane grids on upper corners, mid-board flanks, and lower bay
    const gridZones = [
      { xMin: 82, xMax: 242, yMin: 82, yMax: 242, stepX: 40, stepY: 40 },
      { xMin: 92, xMax: 252, yMin: 1040, yMax: 1280, stepX: 40, stepY: 48 },
      { xMin: 140, xMax: 300, yMin: 1340, yMax: 1580, stepX: 40, stepY: 48 }
    ];
    for (const gz of gridZones) {
      for (let gx = gz.xMin; gx <= gz.xMax; gx += gz.stepX) {
        for (let gy = gz.yMin; gy <= gz.yMax; gy += gz.stepY) {
          const wL = ThreeStage.canvasToWorldXY(gx, gy);
          const wR = ThreeStage.canvasToWorldXY(1080 - gx, gy);
          boardViaPositions.push({ x: wL.x, y: wL.y, z: 0.004, scale: 0.88 });
          boardViaPositions.push({ x: wR.x, y: wR.y, z: 0.004, scale: 0.88 });
        }
      }
    }

    const ringGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.038, 0.038, 0.014, 14));
    ringGeo.rotateX(Math.PI * 0.5);
    const holeGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.018, 0.018, 0.022, 12));
    holeGeo.rotateX(Math.PI * 0.5);

    const populateVias = (
      positions: Array<{ x: number; y: number; z: number; scale: number }>,
      target: THREE.Group
    ) => {
      const ringInst = new THREE.InstancedMesh(ringGeo, enigGoldMat, positions.length);
      const holeInst = new THREE.InstancedMesh(holeGeo, drillHoleMat, positions.length);
      const dummy = new THREE.Object3D();
      positions.forEach((v, idx) => {
        dummy.position.set(v.x, v.y, v.z);
        dummy.scale.set(v.scale, v.scale, 1);
        dummy.updateMatrix();
        ringInst.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(v.x, v.y, v.z + 0.002);
        dummy.updateMatrix();
        holeInst.setMatrixAt(idx, dummy.matrix);
      });
      ringInst.instanceMatrix.needsUpdate = true;
      holeInst.instanceMatrix.needsUpdate = true;
      target.add(ringInst);
      target.add(holeInst);
    };

    populateVias(boardViaPositions, boardParent);
    populateVias(dialViaPositions, dialParent);
  }

  private buildPopulatedSmdHardware(
    stage: ThreeStage,
    nonEmissiveParent: THREE.Group,
    dialParent: THREE.Group,
    scene: THREE.Scene,
    qfnBodyMat: THREE.Material,
    solderFilletMat: THREE.Material,
    ceramicBodyMat: THREE.Material,
    enigGoldMat: THREE.Material,
    statusLedMat: THREE.Material,
    cyanLedMat: THREE.Material,
    dialCenterW: { x: number; y: number }
  ): void {
    // 1. 12 Hour Marker QFN IC Packages + Micro-LEDs around the dial
    const hourR = pxToWorld(388);
    const ledGeo = stage.trackGeometry(new THREE.BoxGeometry(0.08, 0.045, 0.032));

    for (let h = 0; h < 12; h++) {
      const deg = h * 30 - 90;
      const rad = (-deg * Math.PI) / 180;
      const isCardinal = h % 3 === 0;
      const qfnSize = isCardinal ? 0.34 : 0.22;
      const qfnHeight = isCardinal ? 0.07 : 0.048;
      const pins = isCardinal ? 6 : 4;

      const qfn = createQfnPackageGroup(qfnSize, qfnHeight, pins, qfnBodyMat, solderFilletMat);
      qfn.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          stage.trackGeometry(child.geometry);
        }
      });
      qfn.position.set(
        dialCenterW.x + Math.cos(rad) * hourR,
        dialCenterW.y + Math.sin(rad) * hourR,
        0.148
      );
      qfn.rotation.z = rad;
      dialParent.add(qfn);

      // Glowing SMD Micro-LED indicator inboard of each hour QFN
      const ledR = pxToWorld(330);
      const ledMesh = new THREE.Mesh(ledGeo, statusLedMat);
      ledMesh.position.set(
        dialCenterW.x + Math.cos(rad) * ledR,
        dialCenterW.y + Math.sin(rad) * ledR,
        0.165
      );
      ledMesh.rotation.z = rad;
      dialParent.add(ledMesh);
      this.statusLedMeshes.push(ledMesh);
    }

    // 2. Perimeter QFN Controller ICs on left/right flanks
    const perimeterQfns = [
      { px: 165, py: 180, size: 0.44, pins: 7 },
      { px: 915, py: 180, size: 0.44, pins: 7 },
      { px: 190, py: 1080, size: 0.48, pins: 8 },
      { px: 890, py: 1080, size: 0.48, pins: 8 }
    ];
    for (const cfg of perimeterQfns) {
      const w = ThreeStage.canvasToWorldXY(cfg.px, cfg.py);
      const qfn = createQfnPackageGroup(cfg.size, 0.075, cfg.pins, qfnBodyMat, solderFilletMat);
      qfn.traverse((child) => {
        if (child instanceof THREE.Mesh) stage.trackGeometry(child.geometry);
      });
      qfn.position.set(w.x, w.y, 0.02);
      nonEmissiveParent.add(qfn);
    }

    // 3. 0402/0603 Passive SMD Components (InstancedMesh) around dial perimeter
    const passivePositions: Array<{ x: number; y: number; z: number; rot: number }> = [];
    const passiveR = pxToWorld(414);
    for (let i = 0; i < 60; i++) {
      if (i % 5 === 0) continue;
      const rad = ((-i * 6 + 90) * Math.PI) / 180;
      passivePositions.push({
        x: dialCenterW.x + Math.cos(rad) * passiveR,
        y: dialCenterW.y + Math.sin(rad) * passiveR,
        z: 0.165,
        rot: rad
      });
    }

    const bodyGeo = stage.trackGeometry(new THREE.BoxGeometry(0.08, 0.042, 0.032));
    const capGeo = stage.trackGeometry(new THREE.BoxGeometry(0.022, 0.046, 0.036));
    const bodyInst = new THREE.InstancedMesh(bodyGeo, ceramicBodyMat, passivePositions.length);
    const capInst = new THREE.InstancedMesh(capGeo, solderFilletMat, passivePositions.length * 2);

    const dummy = new THREE.Object3D();
    passivePositions.forEach((p, idx) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, p.rot);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(idx, dummy.matrix);

      const dx = Math.cos(p.rot) * 0.042;
      const dy = Math.sin(p.rot) * 0.042;
      dummy.position.set(p.x + dx, p.y + dy, p.z);
      dummy.updateMatrix();
      capInst.setMatrixAt(idx * 2, dummy.matrix);

      dummy.position.set(p.x - dx, p.y - dy, p.z);
      dummy.updateMatrix();
      capInst.setMatrixAt(idx * 2 + 1, dummy.matrix);
    });
    bodyInst.instanceMatrix.needsUpdate = true;
    capInst.instanceMatrix.needsUpdate = true;
    dialParent.add(bodyInst);
    dialParent.add(capInst);

    // 4. ZIF-16 Mezzanine FPC Connector Shroud at Pendulum Pivot (540, 990)
    const pivotW = ThreeStage.canvasToWorldXY(
      PCB_GEOMETRY.PENDULUM_PIVOT.x,
      PCB_GEOMETRY.PENDULUM_PIVOT.y
    );
    const zifBody = new THREE.Mesh(
      stage.trackGeometry(new THREE.BoxGeometry(1.48, 0.34, 0.14)),
      qfnBodyMat
    );
    zifBody.position.set(pivotW.x, pivotW.y, 0.09);
    zifBody.castShadow = true;
    nonEmissiveParent.add(zifBody);

    const pinGeo = stage.trackGeometry(new THREE.BoxGeometry(0.04, 0.44, 0.04));
    for (let i = 0; i < 16; i++) {
      const px = -0.6 + i * 0.08;
      const pinMesh = new THREE.Mesh(pinGeo, enigGoldMat);
      pinMesh.position.set(pivotW.x + px, pivotW.y, 0.05);
      nonEmissiveParent.add(pinMesh);
    }

    // 5. Lower-chamber diagnostic status micro-LEDs
    const diagCoords = [
      { px: 165, py: 1350, mat: cyanLedMat },
      { px: 915, py: 1350, mat: cyanLedMat },
      { px: 165, py: 1750, mat: statusLedMat },
      { px: 915, py: 1750, mat: statusLedMat }
    ];
    for (const d of diagCoords) {
      const w = ThreeStage.canvasToWorldXY(d.px, d.py);
      const led = new THREE.Mesh(ledGeo, d.mat);
      led.position.set(w.x, w.y, 0.04);
      scene.add(led);
      this.statusLedMeshes.push(led);
    }
  }

  private buildPendulumAssembly(
    stage: ThreeStage,
    scene: THREE.Scene,
    anodizedMat: THREE.Material,
    copperMat: THREE.Material
  ): void {
    const pivotW = ThreeStage.canvasToWorldXY(
      PCB_GEOMETRY.PENDULUM_PIVOT.x,
      PCB_GEOMETRY.PENDULUM_PIVOT.y
    );
    const bobDistW = pxToWorld(PCB_GEOMETRY.PENDULUM_LENGTH);
    const waferR = pxToWorld(this.variant === 'emerald' ? 150 : 128);
    const ribbonLength = bobDistW - waferR * 0.85;
    this.kaptonRibbonLength = ribbonLength;

    const pendulumPivotGroup = new THREE.Group();
    pendulumPivotGroup.position.set(pivotW.x, pivotW.y, 0.22);
    scene.add(pendulumPivotGroup);
    this.pendulumPivotGroup = pendulumPivotGroup;

    // Translucent Amber Kapton Polyimide Ribbon (MeshPhysicalMaterial)
    const kaptonMat = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xd97706,
        transmission: 0.6,
        roughness: 0.25,
        metalness: 0.02,
        thickness: 0.08,
        ior: 1.5,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide
      })
    );

    const ribbonGeo = stage.trackGeometry(createKaptonRibbonGeometry(0.54, ribbonLength, 0.018, 24));
    ribbonGeo.translate(0, -ribbonLength * 0.5, 0);
    const ribbonMesh = new THREE.Mesh(ribbonGeo, kaptonMat);
    ribbonMesh.castShadow = true;
    pendulumPivotGroup.add(ribbonMesh);
    this.kaptonRibbonGeo = ribbonGeo;

    // 8 Embedded Copper Conductor Strips inside the Kapton ribbon
    const stripGeo = stage.trackGeometry(createKaptonRibbonGeometry(0.024, ribbonLength, 0.008, 24));
    stripGeo.translate(0, -ribbonLength * 0.5, 0);
    this.kaptonCopperGeo = stripGeo;
    for (let i = 0; i < 8; i++) {
      const offsetX = -0.175 + i * 0.05;
      const strip = new THREE.Mesh(stripGeo, copperMat);
      strip.position.set(offsetX, 0, 0);
      pendulumPivotGroup.add(strip);
    }

    // Zone 03 Bob Group (machined black-anodized 3D bezel + diced silicon wafer + glass cover)
    const bobGroup = new THREE.Group();
    bobGroup.position.set(0, -bobDistW, 0.06);
    pendulumPivotGroup.add(bobGroup);

    const bezelGeo = stage.trackGeometry(createMachinedWaferBezelGeometry(waferR - 0.02, waferR + 0.24));
    const bezelMesh = new THREE.Mesh(bezelGeo, anodizedMat);
    bezelMesh.castShadow = true;
    bezelMesh.receiveShadow = true;
    bobGroup.add(bezelMesh);

    // 8 Socket-head cap screws around bezel perimeter
    const screwGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 12));
    screwGeo.rotateX(Math.PI * 0.5);
    const screwMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x3b4248, metalness: 0.92, roughness: 0.25 })
    );
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const sr = waferR + 0.13;
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.position.set(Math.cos(a) * sr, Math.sin(a) * sr, 0.16);
      bobGroup.add(screw);
    }

    // Diced Silicon Wafer with View-Dependent GLSL Diffraction Shader
    const waferGeo = stage.trackGeometry(new THREE.CircleGeometry(waferR, 64));
    const waferMat = stage.trackMaterial(createThreeWaferShaderMaterial(this.variant));
    const waferMesh = new THREE.Mesh(waferGeo, waferMat);
    waferMesh.position.set(0, 0, 0.05);
    bobGroup.add(waferMesh);
    this.waferShaderMaterial = waferMat;

    // Crystal Glass Cover over the silicon wafer
    const glassGeo = stage.trackGeometry(new THREE.CircleGeometry(waferR + 0.03, 64));
    const glassMat = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.92,
        roughness: 0.04,
        metalness: 0.0,
        ior: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.04,
        transparent: true,
        opacity: 0.35
      })
    );
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.set(0, 0, 0.145);
    bobGroup.add(glassMesh);
  }

  private buildClockHands(
    stage: ThreeStage,
    dialGroup: THREE.Group,
    bodyMat: THREE.Material,
    emissiveMat: THREE.Material,
    goldCapMat: THREE.Material,
    dialCenterW: { x: number; y: number }
  ): void {
    const handsGroup = new THREE.Group();
    handsGroup.visible = true;
    dialGroup.add(handsGroup);
    this.handsGroup = handsGroup;

    const createPivot = (z: number) => {
      const p = new THREE.Group();
      p.position.set(dialCenterW.x, dialCenterW.y, z);
      handsGroup.add(p);
      return p;
    };

    this.hourHandPivot = createPivot(0.24);
    this.minuteHandPivot = createPivot(0.32);
    this.secondHandPivot = createPivot(0.40);

    const hourHand = createMilledClockHand(2.35, 0.55, 0.22, 0.055, bodyMat, emissiveMat, 0);
    const minuteHand = createMilledClockHand(3.45, 0.72, 0.16, 0.045, bodyMat, emissiveMat, 0);
    const secondHand = createMilledClockHand(3.75, 0.92, 0.08, 0.032, bodyMat, emissiveMat, 0);

    for (const hand of [hourHand, minuteHand, secondHand]) {
      hand.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          stage.trackGeometry(child.geometry);
          if (child.userData.isEmissiveIndicator) {
            this.emissiveIndicatorMeshes.push(child);
          } else {
            this.handBodyMeshes.push(child);
          }
        }
      });
    }

    this.hourHandPivot.add(hourHand);
    this.minuteHandPivot.add(minuteHand);
    this.secondHandPivot.add(secondHand);

    // Central ENIG gold hub cap
    const capGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.26, 0.29, 0.12, 32));
    capGeo.rotateX(Math.PI * 0.5);
    const capMesh = new THREE.Mesh(capGeo, goldCapMat);
    capMesh.position.set(dialCenterW.x, dialCenterW.y, 0.44);
    capMesh.castShadow = true;
    handsGroup.add(capMesh);
    this.handBodyMeshes.push(capMesh);
  }

  private applyModeLighting(): void {
    const isSleep = this.currentMode === 'sleep';
    const isNight = this.currentMode === 'night';

    if (this.stage) {
      this.stage.scene.background = new THREE.Color(isSleep ? 0x000000 : 0x020604);
      this.stage.scene.environmentIntensity = isSleep ? 0 : isNight ? 0.15 : 0.35;
    }

    // Black out all board, bezel, SMD, LEDs, and Kapton/wafer geometry in Sleep (Cat mode)
    if (this.boardGroup) this.boardGroup.visible = !isSleep;
    if (this.dialBoardGroup) this.dialBoardGroup.visible = !isSleep;
    if (this.dialGroup) this.dialGroup.visible = true;
    if (this.smdNonEmissiveGroup) this.smdNonEmissiveGroup.visible = !isSleep;
    if (this.pendulumPivotGroup) this.pendulumPivotGroup.visible = !isSleep;
    if (this.handsGroup) this.handsGroup.visible = true;
    for (const obj of this.handBodyMeshes) {
      obj.visible = !isSleep;
    }
    for (const core of this.emissiveIndicatorMeshes) {
      core.visible = true;
    }
    for (const led of this.statusLedMeshes) {
      led.visible = !isSleep;
    }

    // Zero all lights in Sleep mode; keep center hub point light subtle so dial doesn't flare
    if (this.ambientLight) this.ambientLight.intensity = isSleep ? 0 : isNight ? 0.10 : 0.25;
    if (this.keyLight) this.keyLight.intensity = isSleep ? 0 : isNight ? 0.42 : 1.45;
    if (this.rimLight) this.rimLight.intensity = isSleep ? 0 : isNight ? 0.14 : 0.55;
    if (this.handPointLight) {
      this.handPointLight.intensity = isSleep ? 0 : isNight ? 0.15 : 0.35 + this.alertPulseBoost * 0.4;
    }
    if (this.waferAccentLight) this.waferAccentLight.intensity = isSleep ? 0 : isNight ? 0.22 : 0.75;

    // Keep ONLY the clock hand cores dimly illuminated (~15% night-mode brightness) in Sleep mode
    if (this.handEmissiveMaterial) {
      this.handEmissiveMaterial.transparent = false;
      this.handEmissiveMaterial.opacity = 1;
      this.handEmissiveMaterial.depthTest = !isSleep;
      this.handEmissiveMaterial.needsUpdate = true;

      if (isSleep) {
        this.handEmissiveMaterial.color.setRGB(0.68, 0.22, 0.04, THREE.SRGBColorSpace);
      } else if (isNight) {
        this.handEmissiveMaterial.color.setRGB(0.85, 0.20, 0.04);
      } else {
        const boost = 1.0 + this.alertPulseBoost * 0.2;
        this.handEmissiveMaterial.color.setRGB(2.0 * boost, 0.45 * boost, 0.08 * boost);
      }

      // Force-assign material and visibility directly onto each hand core mesh
      for (const core of this.emissiveIndicatorMeshes) {
        if (core instanceof THREE.Mesh) {
          core.material = this.handEmissiveMaterial;
        }
        core.visible = true;
      }
    }

    const ledEmissive = isSleep ? 0 : isNight ? 0.45 : 1.8;
    if (this.statusLedEmissiveMaterial) this.statusLedEmissiveMaterial.emissiveIntensity = ledEmissive;
    if (this.cyanLedEmissiveMaterial) {
      this.cyanLedEmissiveMaterial.emissiveIntensity = isSleep ? 0 : isNight ? 0.35 : 1.6;
    }
  }

  private syncDialGroupPosition(): void {
    if (!this.dialGroup) return;
    const offset = ThreeStage.dialCenterToOffsetWorld(
      this.manifest.dial.center.x,
      this.manifest.dial.center.y
    );
    this.dialGroup.position.set(offset.x, offset.y, 0);
  }

  public renderPendulum(_ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted) return;

    const isSleep = this.currentMode === 'sleep' || physicsData.dampingFactor <= 0.001;
    const effectiveAngleRad = isSleep ? 0 : physicsData.angleRad * physicsData.dampingFactor;
    this.lastPendulumAngleRad = effectiveAngleRad;

    if (this.pendulumPivotGroup) {
      this.pendulumPivotGroup.rotation.z = effectiveAngleRad;
    }

    // Dynamic Kapton ribbon vertex flex synced to pendulum swing
    const flexBowX = Math.sin(effectiveAngleRad * 4.0) * 0.065;
    if (this.kaptonRibbonGeo) {
      updateKaptonRibbonFlex(this.kaptonRibbonGeo, this.kaptonRibbonLength, flexBowX);
    }
    if (this.kaptonCopperGeo) {
      updateKaptonRibbonFlex(this.kaptonCopperGeo, this.kaptonRibbonLength, flexBowX);
    }

    // Update Zone 03 Silicon Wafer diffraction shader uniforms
    if (this.waferShaderMaterial) {
      this.waferShaderMaterial.uniforms.uSwingAngleRad.value = effectiveAngleRad;
      this.waferShaderMaterial.uniforms.uAngularVel.value = isSleep ? 0 : physicsData.angularVelocityNorm;
      this.waferShaderMaterial.uniforms.uTimeSec.value = physicsData.timeSec;
      this.waferShaderMaterial.uniforms.uDimFactor.value = physicsData.dimmed ? 0.32 : 1.0;
    }
  }

  public renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted || !this.stage) return;

    const dt = Math.min(0.1, Math.max(0.001, timeData.deltaTimeSec || 0.016));
    this.alertPulseBoost = Math.max(0, this.alertPulseBoost - dt * 1.8);

    // Lock hand rotations strictly to real wall-clock time via new Date() (radian angles)
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();

    const secondAngle = -(seconds + ms / 1000) * ((Math.PI * 2) / 60);
    const minuteAngle = -(minutes + seconds / 60) * ((Math.PI * 2) / 60);
    const hourAngle = -((hours % 12) + minutes / 60) * ((Math.PI * 2) / 12);

    if (this.hourHandPivot) this.hourHandPivot.rotation.z = hourAngle;
    if (this.minuteHandPivot) this.minuteHandPivot.rotation.z = minuteAngle;
    if (this.secondHandPivot) this.secondHandPivot.rotation.z = secondAngle;

    // Subtle dynamic point light tracking along the minute hand
    if (this.handPointLight && this.currentMode !== 'sleep') {
      const dialCenterW = ThreeStage.canvasToWorldXY(
        PCB_GEOMETRY.DIAL_CENTER.x,
        PCB_GEOMETRY.DIAL_CENTER.y
      );
      const lightRad = minuteAngle + Math.PI * 0.5;
      this.handPointLight.position.set(
        dialCenterW.x + Math.cos(lightRad) * 1.15,
        dialCenterW.y + Math.sin(lightRad) * 1.15,
        0.85
      );
    }

    // Multi-harmonic camera drift + smooth pointer parallax
    if (this.currentMode !== 'sleep') {
      this.cameraPhaseSec += dt;
      const damp = 1 - Math.exp(-dt * 5.0);
      this.pointerCurrentX += (this.pointerTargetX - this.pointerCurrentX) * damp;
      this.pointerCurrentY += (this.pointerTargetY - this.pointerCurrentY) * damp;

      const driftX =
        Math.sin(this.cameraPhaseSec * 0.41) * 0.16 +
        Math.sin(this.cameraPhaseSec * 0.93) * 0.05;
      const driftY =
        Math.cos(this.cameraPhaseSec * 0.29) * 0.14 +
        Math.cos(this.cameraPhaseSec * 0.71) * 0.04;

      this.stage.camera.position.set(
        driftX + this.pointerCurrentX * 0.55,
        driftY + this.pointerCurrentY * 0.45,
        this.stage.baseCameraZ
      );
      this.stage.camera.lookAt(0, 0, 0);
    } else {
      // Throttle 3D render pass to ~1 FPS in Sleep (Cat mode)
      if (timeData.realTimeMs - this.lastSleepRenderTimeMs < 950) {
        return;
      }
      this.lastSleepRenderTimeMs = timeData.realTimeMs;
    }

    this.applyModeLighting();
    this.syncDialGroupPosition();
    this.stage.render();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    const nextMode: ClockMode = telemetryData.isSleeping
      ? 'sleep'
      : telemetryData.mode ?? 'active';
    if (nextMode !== this.currentMode) {
      this.currentMode = nextMode;
      this.lastSleepRenderTimeMs = -10000;
      this.applyModeLighting();
      this.stage?.render();
    }

    this.hudOverlay.render(ctx, telemetryData);
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;

    if (event.type === 'mode_change' && event.payload) {
      const nextMode = (event.payload as { mode?: ClockMode }).mode;
      if (nextMode && nextMode !== this.currentMode) {
        this.currentMode = nextMode;
        this.lastSleepRenderTimeMs = -10000;
        this.applyModeLighting();
        this.stage?.render();
      }
    } else if (
      event.type === 'notification' ||
      event.type === 'mqtt_pulse' ||
      event.type === 'priority_alert'
    ) {
      this.alertPulseBoost = event.priority === 'urgent' ? 1.8 : 0.9;
    }

    this.hudOverlay.onEvent(event);
  }

  public destroy(): void {
    this.isMounted = false;
    this.cleanupPointerParallax();
    this.hudOverlay.destroy();

    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }

    this.boardGroup = null;
    this.dialGroup = null;
    this.dialBoardGroup = null;
    this.smdNonEmissiveGroup = null;
    this.pendulumPivotGroup = null;
    this.handsGroup = null;
    this.handBodyMeshes = [];
    this.statusLedMeshes = [];
    this.emissiveIndicatorMeshes = [];
    this.ambientLight = null;
    this.keyLight = null;
    this.rimLight = null;
    this.handPointLight = null;
    this.waferAccentLight = null;
    this.handEmissiveMaterial = null;
    this.statusLedEmissiveMaterial = null;
    this.cyanLedEmissiveMaterial = null;
    this.waferShaderMaterial = null;
    this.kaptonRibbonGeo = null;
    this.kaptonCopperGeo = null;
    this.hourHandPivot = null;
    this.minuteHandPivot = null;
    this.secondHandPivot = null;
  }
}

export class Pcb2049EmeraldTheme extends Pcb2049Theme {
  constructor() {
    super('emerald');
  }
}
