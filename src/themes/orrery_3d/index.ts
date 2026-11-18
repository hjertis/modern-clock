import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { ThemeManifest, ClockMode } from '../../types/theme';
import {
  Theme,
  ThemeConfig,
  TimeData,
  PhysicsData,
  TelemetryData,
  ThemeEvent
} from '../types';
import { ThreeStage, ThreeStageResourceStats } from '../three/ThreeStage';
import { createWalnutWoodMaps } from '../tourbillon_3d/geometries';
import {
  createEarthPlanetMaps,
  createLunarSurfaceMaps,
  createJovianBandTexture,
  createSolarSurfaceMaterial,
  createSolarCoronaShellMaterial,
  createStarfieldMaterial,
  createAstrolabeHandGeometry,
  createAstrolabeHandTrimGeometry,
  createCometSecondHandGeometry
} from './geometries';

export const ORRERY_3D_MANIFEST: ThemeManifest = {
  name: 'Celestial Astrolabe & Orrery',
  version: '1.0.0',
  author: 'Chrono Artisan',
  background: '',
  dial: {
    image: '',
    center: { x: 540, y: 530 }
  },
  hands: {
    hour: {
      image: '',
      pivot: { x: 540, y: 530 }
    },
    minute: {
      image: '',
      pivot: { x: 540, y: 530 }
    },
    second: {
      image: '',
      pivot: { x: 540, y: 530 },
      mode: 'sweep'
    },
    cap: {
      image: '',
      center: { x: 540, y: 530 }
    }
  },
  pendulum: {
    image: '',
    pivot: { x: 540, y: 860 },
    anchor: { x: 540, y: 860 },
    periodSeconds: 2.0,
    maxAngleDeg: 6.0
  },
  notificationZone: {
    x: 140,
    y: 1250,
    width: 800,
    height: 450
  }
};

export interface OrreryEphemerisState {
  mercuryLonDeg: number;
  venusLonDeg: number;
  earthLonDeg: number;
  marsLonDeg: number;
  jupiterLonDeg: number;
  lunarPhaseDeg: number;
  siderealHours: number;
  siderealAngleRad: number;
}

export interface OrreryDebugState {
  mode: ClockMode;
  targetMode: ClockMode;
  brakeFactor: number;
  eclipseFactor: number;
  solarColorHex: string;
  solarEmissiveIntensity: number;
  indexEmissiveIntensity: number;
  lunarEmissiveIntensity: number;
  secondHandEmissiveIntensity: number;
  brassEmissiveIntensity: number;
  obsidianEmissiveIntensity: number;
  ephemeris: OrreryEphemerisState;
  planetAnglesRad: {
    mercury: number;
    venus: number;
    earth: number;
    mars: number;
    jupiter: number;
    moon: number;
  };
  siderealDomeAngleRad: number;
  pendulumAngleRad: number;
  solarLightIntensity: number;
  overheadSpotlightIntensity: number;
  cameraPosition: [number, number, number];
  bloomThreshold: number;
}

const COLOR_ACTIVE_SOLAR = new THREE.Color(0xffb838);
const COLOR_ACTIVE_CORONA = new THREE.Color(0xffe696);
const COLOR_ACTIVE_INDEX = new THREE.Color(0xffcf70);
const COLOR_ACTIVE_STAR = new THREE.Color(0xdbe8ff);

const COLOR_NIGHT_RED = new THREE.Color(0xff2e24);
const COLOR_NIGHT_CORONA = new THREE.Color(0xff6648);
const COLOR_NIGHT_INDEX = new THREE.Color(0xff382c);
const COLOR_NIGHT_STAR = new THREE.Color(0xff8470);

const COLOR_SLEEP_ECLIPSE = new THREE.Color(0x523418);
const COLOR_SLEEP_CORONA = new THREE.Color(0x885c28);
const COLOR_SLEEP_INDEX = new THREE.Color(0x28100c);

function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Computes completely offline heliocentric planetary longitudes, lunar phase angle,
 * and Greenwich Apparent Sidereal Time for the given Date using `astronomy-engine`.
 */
export function computeOrreryEphemeris(date: Date): OrreryEphemerisState {
  const helioLonDeg = (body: Astronomy.Body): number => {
    const vec = Astronomy.HelioVector(body, date);
    const ecl = Astronomy.Ecliptic(vec);
    return normalizeDeg(ecl.elon);
  };

  const siderealHours = Astronomy.SiderealTime(date);
  return {
    mercuryLonDeg: helioLonDeg(Astronomy.Body.Mercury),
    venusLonDeg: helioLonDeg(Astronomy.Body.Venus),
    earthLonDeg: helioLonDeg(Astronomy.Body.Earth),
    marsLonDeg: helioLonDeg(Astronomy.Body.Mars),
    jupiterLonDeg: helioLonDeg(Astronomy.Body.Jupiter),
    lunarPhaseDeg: normalizeDeg(Astronomy.MoonPhase(date)),
    siderealHours,
    siderealAngleRad: (siderealHours / 24.0) * Math.PI * 2
  };
}

export class Orrery3DTheme implements Theme {
  public readonly id = 'orrery_3d';
  public readonly name = 'Celestial Astrolabe & Orrery';

  private manifest: ThemeManifest = structuredClone(ORRERY_3D_MANIFEST);
  private stage: ThreeStage | null = null;
  private isMounted = false;
  private currentMode: ClockMode = 'active';
  private targetMode: ClockMode = 'active';

  // Smooth damping & braking state
  private brakeFactor = 1.0;
  private lastSleepRenderTimeMs = 0;

  // Breathing camera parallax & desktop pointer tilt state
  private cameraPhaseSec = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerCurrentX = 0;
  private pointerCurrentY = 0;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;

  // Smooth mode transition state
  private currentSolarColor = COLOR_ACTIVE_SOLAR.clone();
  private currentCoronaColor = COLOR_ACTIVE_CORONA.clone();
  private currentIndexColor = COLOR_ACTIVE_INDEX.clone();
  private currentStarColor = COLOR_ACTIVE_STAR.clone();
  private currentSolarIntensity = 2.2;
  private currentCoronaIntensity = 1.55;
  private currentIndexIntensity = 2.15;
  private currentLunarIntensity = 1.65;
  private currentSecondIntensity = 1.95;
  private currentEclipseFactor = 0.0;
  private currentSolarLightIntensity = 36.0;
  private currentOverheadLightIntensity = 78.0;
  private currentExposure = 0.96;
  private currentEnvIntensity = 0.88;
  private currentBloomStrength = 0.28;

  // Lighting
  private ambientLight: THREE.AmbientLight | null = null;
  private overheadSpotlight: THREE.SpotLight | null = null;
  private grazingRimSpotlight: THREE.SpotLight | null = null;
  private solarPointLight: THREE.PointLight | null = null;

  // Materials (structural metals remain strictly non-emissive)
  private obsidianMaterial: THREE.MeshStandardMaterial | null = null;
  private brassMaterial: THREE.MeshStandardMaterial | null = null;
  private copperAccentMaterial: THREE.MeshStandardMaterial | null = null;
  private solarSurfaceMaterial: THREE.ShaderMaterial | null = null;
  private solarCoronaMaterial: THREE.ShaderMaterial | null = null;
  private starfieldMaterial: THREE.ShaderMaterial | null = null;
  private constellationLineMaterial: THREE.LineBasicMaterial | null = null;
  private indexGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private handTrimGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private secondHandGlowMaterial: THREE.MeshStandardMaterial | null = null;
  private lunarSunlitMaterial: THREE.MeshStandardMaterial | null = null;

  // Scene assemblies
  private siderealDomeGroup: THREE.Group | null = null;
  private sunMesh: THREE.Mesh | null = null;
  private mercuryOrbitGroup: THREE.Group | null = null;
  private venusOrbitGroup: THREE.Group | null = null;
  private earthOrbitGroup: THREE.Group | null = null;
  private earthGlobeMesh: THREE.Mesh | null = null;
  private moonOrbitGroup: THREE.Group | null = null;
  private moonSunlitCap: THREE.Mesh | null = null;
  private marsOrbitGroup: THREE.Group | null = null;
  private jupiterOrbitGroup: THREE.Group | null = null;

  // Astrolabe Dial Hands
  private hourHandPivot: THREE.Group | null = null;
  private dialGroup: THREE.Group | null = null;
  private dialBasePos = { x: 0, y: 0 };
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;

  // Lower Zone: Gimbaled Armillary Astrolabe Pendulum
  private pendulumPivotGroup: THREE.Group | null = null;
  private armillaryInnerRing: THREE.Mesh | null = null;

  // Phase & cached ephemeris state
  private orreryPhaseSec = 0;
  private lastTickTimestampMs: number | null = null;
  private lastPhysicsAngleRad = 0;
  private alertPulseBoost = 0;
  private lastEphemeris: OrreryEphemerisState = computeOrreryEphemeris(new Date());

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getThreeStage(): ThreeStage | null {
    return this.stage;
  }

  public getResourceStats(): ThreeStageResourceStats | null {
    return this.stage ? this.stage.getResourceStats() : null;
  }

  public getDebugState(): OrreryDebugState {
    const camPos = this.stage?.camera.position;
    const bloom = this.stage?.getBloomParameters();
    return {
      mode: this.currentMode,
      targetMode: this.targetMode,
      brakeFactor: this.brakeFactor,
      eclipseFactor: this.currentEclipseFactor,
      solarColorHex: `#${this.currentSolarColor.getHexString()}`,
      solarEmissiveIntensity: this.currentSolarIntensity,
      indexEmissiveIntensity: this.indexGlowMaterial?.emissiveIntensity ?? 0,
      lunarEmissiveIntensity: this.lunarSunlitMaterial?.emissiveIntensity ?? 0,
      secondHandEmissiveIntensity: this.secondHandGlowMaterial?.emissiveIntensity ?? 0,
      brassEmissiveIntensity: this.brassMaterial?.emissiveIntensity ?? 0,
      obsidianEmissiveIntensity: this.obsidianMaterial?.emissiveIntensity ?? 0,
      ephemeris: { ...this.lastEphemeris },
      planetAnglesRad: {
        mercury: this.mercuryOrbitGroup?.rotation.z ?? 0,
        venus: this.venusOrbitGroup?.rotation.z ?? 0,
        earth: this.earthOrbitGroup?.rotation.z ?? 0,
        mars: this.marsOrbitGroup?.rotation.z ?? 0,
        jupiter: this.jupiterOrbitGroup?.rotation.z ?? 0,
        moon: this.moonOrbitGroup?.rotation.z ?? 0
      },
      siderealDomeAngleRad: this.siderealDomeGroup?.rotation.z ?? 0,
      pendulumAngleRad: this.pendulumPivotGroup?.rotation.z ?? 0,
      solarLightIntensity: this.solarPointLight?.intensity ?? 0,
      overheadSpotlightIntensity: this.overheadSpotlight?.intensity ?? 0,
      cameraPosition: camPos ? [camPos.x, camPos.y, camPos.z] : [0, 0, 35.8],
      bloomThreshold: bloom?.threshold ?? 1.45
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
      this.manifest = structuredClone(ORRERY_3D_MANIFEST);
    }

    this.isMounted = true;
    this.brakeFactor = this.currentMode === 'sleep' ? 0.0 : 1.0;
    this.lastTickTimestampMs = null;
    this.lastEphemeris = computeOrreryEphemeris(new Date());

    const stage = new ThreeStage({
      width: config?.width ?? 1080,
      height: config?.height ?? 1920,
      fov: 30,
      chamberDepth: 5.0,
      stageElement: config?.stageElement,
      bloomThreshold: 1.45,
      bloomStrength: 0.28,
      bloomRadius: 0.4
    });
    this.stage = stage;

    await stage.init();
    if (!this.isMounted || this.stage !== stage) {
      stage.dispose();
      return;
    }

    stage.scene.background = new THREE.Color(0x05070e);
    this.setupPointerParallax();
    this.buildSceneGraph(stage);
    this.applyEphemerisToScene(this.lastEphemeris);
    this.applyModeTargets(true);
    stage.clearCameraViewOffset();
    stage.render();
  }

  private setupPointerParallax(): void {
    this.cleanupPointerParallax();
    if (typeof window === 'undefined') return;

    this.boundOnPointerMove = (e: PointerEvent) => {
      if (this.targetMode === 'sleep') return;
      const w = window.innerWidth || 1080;
      const h = window.innerHeight || 1920;
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

  private buildSceneGraph(stage: ThreeStage): void {
    const scene = stage.scene;

    // --- Structural Obsidian Lacquer (#0b0f19), Oiled Walnut & Astronomical Brass (#c69648) ---
    const walnutMaps = createWalnutWoodMaps(256, 512);
    stage.trackTexture(walnutMaps.map);
    stage.trackTexture(walnutMaps.normalMap);
    stage.trackTexture(walnutMaps.roughnessMap);

    const walnutFrameMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: walnutMaps.map,
        normalMap: walnutMaps.normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughnessMap: walnutMaps.roughnessMap,
        color: 0x623b24,
        metalness: 0.08,
        roughness: 0.72,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    this.obsidianMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x0b0f19,
        metalness: 0.56,
        roughness: 0.28,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    this.brassMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xc69648,
        metalness: 0.88,
        roughness: 0.25,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    this.copperAccentMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xa2663a,
        metalness: 0.85,
        roughness: 0.32,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0
      })
    );

    // --- Planet Procedural Maps & Diffuse Materials (non-emissive for solar terminator shading) ---
    const earthMaps = createEarthPlanetMaps(128, 64);
    stage.trackTexture(earthMaps.map);
    stage.trackTexture(earthMaps.normalMap);

    const lunarMaps = createLunarSurfaceMaps(128, 64);
    stage.trackTexture(lunarMaps.map);
    stage.trackTexture(lunarMaps.normalMap);

    const jupiterTex = stage.trackTexture(createJovianBandTexture(128, 64));

    const mercuryMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x9b9286, metalness: 0.25, roughness: 0.78 })
    );
    const venusMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xdfc184, metalness: 0.1, roughness: 0.58 })
    );
    const earthMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: earthMaps.map,
        normalMap: earthMaps.normalMap,
        normalScale: new THREE.Vector2(1.0, 1.0),
        metalness: 0.08,
        roughness: 0.56
      })
    );
    const moonMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: lunarMaps.map,
        normalMap: lunarMaps.normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        metalness: 0.05,
        roughness: 0.82
      })
    );
    const marsMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xc25834, metalness: 0.12, roughness: 0.72 })
    );
    const jupiterMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        map: jupiterTex,
        metalness: 0.08,
        roughness: 0.62
      })
    );

    // --- Emissive Solar Corona, Backlit Zodiac Indices & Lunar Sunlit Hemisphere (> 1.45 bloom) ---
    this.solarSurfaceMaterial = stage.trackMaterial(createSolarSurfaceMaterial());
    this.solarCoronaMaterial = stage.trackMaterial(createSolarCoronaShellMaterial());
    this.starfieldMaterial = stage.trackMaterial(createStarfieldMaterial());
    this.constellationLineMaterial = stage.trackMaterial(
      new THREE.LineBasicMaterial({
        color: 0x4b6a9e,
        transparent: true,
        opacity: 0.38
      })
    );

    this.indexGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffdf94,
        emissive: new THREE.Color(0xffb838),
        emissiveIntensity: 2.15,
        metalness: 0.12,
        roughness: 0.16
      })
    );

    this.handTrimGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xdca84a,
        emissive: new THREE.Color(0xc69648),
        emissiveIntensity: 1.05,
        metalness: 0.65,
        roughness: 0.22
      })
    );

    this.secondHandGlowMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffe9a6,
        emissive: new THREE.Color(0xffc95c),
        emissiveIntensity: 1.95,
        metalness: 0.15,
        roughness: 0.14
      })
    );

    this.lunarSunlitMaterial = stage.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xf7f2e3,
        emissive: new THREE.Color(0xffd782),
        emissiveIntensity: 1.65,
        metalness: 0.06,
        roughness: 0.45
      })
    );

    // =========================================================================
    // 1. OBSERVATORY LIGHTING RIG & CENTRAL SOLAR POINT LIGHT
    // =========================================================================
    this.ambientLight = new THREE.AmbientLight(0x8fa4c8, 0.22);
    scene.add(this.ambientLight);

    this.overheadSpotlight = new THREE.SpotLight(
      0xffe4b8,
      78.0,
      44.0,
      THREE.MathUtils.degToRad(36),
      0.66,
      1.5
    );
    this.overheadSpotlight.position.set(-2.5, 9.8, 4.8);
    this.overheadSpotlight.target.position.set(0.2, -1.2, -2.8);
    this.overheadSpotlight.castShadow = true;
    this.overheadSpotlight.shadow.mapSize.set(
      ThreeStage.SHADOW_MAP_SIZE,
      ThreeStage.SHADOW_MAP_SIZE
    );
    this.overheadSpotlight.shadow.camera.near = 2.0;
    this.overheadSpotlight.shadow.camera.far = 28.0;
    this.overheadSpotlight.shadow.bias = -0.00035;
    scene.add(this.overheadSpotlight);
    scene.add(this.overheadSpotlight.target);

    this.grazingRimSpotlight = new THREE.SpotLight(
      0x6b92d6,
      36.0,
      32.0,
      THREE.MathUtils.degToRad(44),
      0.78,
      1.5
    );
    this.grazingRimSpotlight.position.set(4.2, 3.6, 4.2);
    this.grazingRimSpotlight.target.position.set(-0.5, -1.5, -3.5);
    scene.add(this.grazingRimSpotlight);
    scene.add(this.grazingRimSpotlight.target);

    const dialWorld = ThreeStage.canvasToWorldXY(
      this.manifest.dial.center.x,
      this.manifest.dial.center.y
    );

    // Central Solar PointLight illuminating planetary spheres for true day/night terminators
    this.solarPointLight = new THREE.PointLight(0xffcb6e, 36.0, 12.0, 1.4);
    this.solarPointLight.position.set(dialWorld.x, dialWorld.y, -1.55);
    scene.add(this.solarPointLight);

    // =========================================================================
    // 2. OBSERVATORY CHAMBER SHAFT (OBSIDIAN LACQUER, WALNUT & BRASS RIBS)
    // =========================================================================
    const chamberGroup = new THREE.Group();
    const outerW = 10.8;
    const outerH = 19.2;
    const chamberD = 4.4;

    const backplate = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, outerH, 0.36),
      this.obsidianMaterial
    );
    backplate.position.set(0, 0, -chamberD);
    backplate.receiveShadow = true;
    chamberGroup.add(backplate);

    const surroundBacking = new THREE.Mesh(
      new THREE.BoxGeometry(24.0, 32.0, 0.36),
      walnutFrameMaterial
    );
    surroundBacking.position.set(0, 0, -chamberD - 0.36);
    surroundBacking.receiveShadow = true;
    chamberGroup.add(surroundBacking);

    const splayLR = THREE.MathUtils.degToRad(14);
    const splayTB = THREE.MathUtils.degToRad(12);
    const wallSlabT = 0.54;

    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabT, outerH, chamberD + 0.4),
      walnutFrameMaterial
    );
    leftWall.position.set(-outerW * 0.5 + 0.52, 0, -chamberD * 0.5);
    leftWall.rotation.y = splayLR;
    leftWall.receiveShadow = true;
    chamberGroup.add(leftWall);

    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallSlabT, outerH, chamberD + 0.4),
      walnutFrameMaterial
    );
    rightWall.position.set(outerW * 0.5 - 0.52, 0, -chamberD * 0.5);
    rightWall.rotation.y = -splayLR;
    rightWall.receiveShadow = true;
    chamberGroup.add(rightWall);

    const topWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabT, chamberD + 0.4),
      walnutFrameMaterial
    );
    topWall.position.set(0, outerH * 0.5 - 0.5, -chamberD * 0.5);
    topWall.rotation.x = -splayTB;
    topWall.receiveShadow = true;
    chamberGroup.add(topWall);

    const bottomWall = new THREE.Mesh(
      new THREE.BoxGeometry(outerW, wallSlabT, chamberD + 0.4),
      walnutFrameMaterial
    );
    bottomWall.position.set(0, -outerH * 0.5 + 0.5, -chamberD * 0.5);
    bottomWall.rotation.x = splayTB;
    bottomWall.receiveShadow = true;
    chamberGroup.add(bottomWall);

    // Engraved aged-brass meridian ribs & corner rivets along backplate
    const hRibGeo = new THREE.BoxGeometry(outerW - 1.4, 0.22, 0.28);
    const rivetGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.12, 8);
    rivetGeo.rotateX(Math.PI * 0.5);
    for (const ry of [8.25, 0.65, -2.55, -8.15]) {
      const rib = new THREE.Mesh(hRibGeo, this.brassMaterial);
      rib.position.set(0, ry, -chamberD + 0.26);
      rib.castShadow = true;
      rib.receiveShadow = true;
      chamberGroup.add(rib);

      for (const rx of [-3.9, -1.95, 0, 1.95, 3.9]) {
        const rivet = new THREE.Mesh(rivetGeo, this.copperAccentMaterial);
        rivet.position.set(rx, ry, -chamberD + 0.4);
        chamberGroup.add(rivet);
      }
    }

    const vRibGeo = new THREE.BoxGeometry(0.24, outerH - 1.8, 0.28);
    for (const rx of [-4.25, 4.25]) {
      const vRib = new THREE.Mesh(vRibGeo, this.brassMaterial);
      vRib.position.set(rx, 0, -chamberD + 0.26);
      vRib.castShadow = true;
      vRib.receiveShadow = true;
      chamberGroup.add(vRib);
    }

    // Outer oiled walnut observatory bezel frame
    const innerW = outerW - 0.68;
    const innerH = outerH - 0.68;
    const trimW = 0.34;
    const trimD = 0.36;
    const topTrim = new THREE.Mesh(
      new THREE.BoxGeometry(innerW + trimW * 2, trimW, trimD),
      walnutFrameMaterial
    );
    topTrim.position.set(0, innerH * 0.5, -0.18);
    chamberGroup.add(topTrim);

    const botTrim = new THREE.Mesh(
      new THREE.BoxGeometry(innerW + trimW * 2, trimW, trimD),
      walnutFrameMaterial
    );
    botTrim.position.set(0, -innerH * 0.5, -0.18);
    chamberGroup.add(botTrim);

    const leftTrim = new THREE.Mesh(
      new THREE.BoxGeometry(trimW, innerH, trimD),
      walnutFrameMaterial
    );
    leftTrim.position.set(-innerW * 0.5, 0, -0.18);
    chamberGroup.add(leftTrim);

    const rightTrim = new THREE.Mesh(
      new THREE.BoxGeometry(trimW, innerH, trimD),
      walnutFrameMaterial
    );
    rightTrim.position.set(innerW * 0.5, 0, -0.18);
    chamberGroup.add(rightTrim);

    scene.add(chamberGroup);

    // =========================================================================
    // 3. SIDEREAL STARFIELD DOME & CONSTELLATION LINES BEHIND UPPER DIAL
    // =========================================================================
    this.siderealDomeGroup = new THREE.Group();
    this.siderealDomeGroup.position.set(dialWorld.x, dialWorld.y, -3.55);

    const starCount = 260;
    const starPositions = new Float32Array(starCount * 3);
    const starScales = new Float32Array(starCount);
    const starPhases = new Float32Array(starCount);

    let seed = 188903;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < starCount; i++) {
      const ang = rand() * Math.PI * 2;
      const rad = 0.6 + Math.sqrt(rand()) * 3.1;
      const depth = -0.35 + (1.0 - rad / 3.8) * 0.35;
      starPositions[i * 3] = Math.cos(ang) * rad;
      starPositions[i * 3 + 1] = Math.sin(ang) * rad;
      starPositions[i * 3 + 2] = depth;
      starScales[i] = 0.48 + Math.pow(rand(), 2.2) * 1.35;
      starPhases[i] = rand() * Math.PI * 2;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('aScale', new THREE.BufferAttribute(starScales, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
    const starPoints = new THREE.Points(starGeo, this.starfieldMaterial);
    this.siderealDomeGroup.add(starPoints);

    // Subtle constellation line segments on the sidereal dome
    const asterisms: Array<Array<[number, number]>> = [
      // Cassiopeia W-shape (upper right quadrant)
      [
        [1.1, 2.2],
        [1.45, 2.55],
        [1.82, 2.22],
        [2.22, 2.58],
        [2.56, 2.15]
      ],
      // Ursa Major dipper (upper left)
      [
        [-2.75, 1.85],
        [-2.25, 1.98],
        [-1.82, 1.75],
        [-1.38, 1.48],
        [-1.08, 1.1],
        [-0.65, 1.25],
        [-0.82, 1.62],
        [-1.38, 1.48]
      ],
      // Orion hourglass (lower right)
      [
        [1.45, -1.2],
        [2.05, -1.12],
        [1.82, -1.65],
        [1.68, -1.68],
        [1.54, -1.71],
        [1.38, -2.25],
        [2.12, -2.18],
        [1.82, -1.65]
      ],
      // Cygnus cross (lower left)
      [
        [-1.9, -1.1],
        [-1.7, -1.65],
        [-1.5, -2.2],
        [-1.7, -1.65],
        [-2.25, -1.48],
        [-1.15, -1.82]
      ]
    ];

    const lineCoords: number[] = [];
    for (const chain of asterisms) {
      for (let i = 0; i < chain.length - 1; i++) {
        lineCoords.push(chain[i][0], chain[i][1], -0.1, chain[i + 1][0], chain[i + 1][1], -0.1);
      }
    }
    const constellationGeo = new THREE.BufferGeometry();
    constellationGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineCoords, 3));
    const constellationLines = new THREE.LineSegments(
      constellationGeo,
      this.constellationLineMaterial
    );
    this.siderealDomeGroup.add(constellationLines);

    // Subtle brass celestial equator & ecliptic reticle rings on dome
    const domeReticle = new THREE.Mesh(
      new THREE.TorusGeometry(2.92, 0.022, 8, 64),
      this.brassMaterial
    );
    this.siderealDomeGroup.add(domeReticle);

    scene.add(this.siderealDomeGroup);

    // =========================================================================
    // 4. UPPER ZONE: HELIOCENTRIC ORRERY & ASTROLABE DIAL
    // =========================================================================
    const dialGroup = new THREE.Group();
    dialGroup.position.set(dialWorld.x, dialWorld.y, -1.55);
    this.dialGroup = dialGroup;
    this.dialBasePos = { x: dialWorld.x, y: dialWorld.y };

    // Recessed obsidian dial backing ring + graduated astronomical brass bezel
    const outerBezel = new THREE.Mesh(
      new THREE.TorusGeometry(3.28, 0.16, 20, 84),
      this.brassMaterial
    );
    outerBezel.position.z = 0.18;
    outerBezel.castShadow = true;
    outerBezel.receiveShadow = true;
    dialGroup.add(outerBezel);

    const innerStepBezel = new THREE.Mesh(
      new THREE.TorusGeometry(3.04, 0.075, 16, 72),
      this.obsidianMaterial
    );
    innerStepBezel.position.z = 0.22;
    dialGroup.add(innerStepBezel);

    // 12 Warm Backlit Zodiac / Hour Indices around the astronomical bezel
    const indexGeo = new THREE.BoxGeometry(0.11, 0.34, 0.09);
    const indexCollarGeo = new THREE.BoxGeometry(0.18, 0.4, 0.05);
    const subTickGeo = new THREE.BoxGeometry(0.036, 0.14, 0.05);

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const tick = new THREE.Mesh(subTickGeo, this.brassMaterial);
      tick.position.set(Math.sin(angle) * 3.16, Math.cos(angle) * 3.16, 0.25);
      tick.rotation.z = -angle;
      dialGroup.add(tick);
    }

    for (let h = 0; h < 12; h++) {
      const angle = (h / 12) * Math.PI * 2;
      const rIdx = 3.06;
      const x = Math.sin(angle) * rIdx;
      const y = Math.cos(angle) * rIdx;

      const collar = new THREE.Mesh(indexCollarGeo, this.brassMaterial);
      collar.position.set(x, y, 0.24);
      collar.rotation.z = -angle;
      dialGroup.add(collar);

      const marker = new THREE.Mesh(indexGeo, this.indexGlowMaterial);
      marker.position.set(x, y, 0.27);
      marker.rotation.z = -angle;
      dialGroup.add(marker);
    }

    // Central Sun (Volumetric/Fresnel granulation sphere + coronal flare shell)
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 36, 28),
      this.solarSurfaceMaterial
    );
    this.sunMesh.castShadow = false;
    this.sunMesh.receiveShadow = false;
    dialGroup.add(this.sunMesh);

    const coronaShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 32, 24),
      this.solarCoronaMaterial
    );
    coronaShell.castShadow = false;
    coronaShell.receiveShadow = false;
    dialGroup.add(coronaShell);

    const brassMat = this.brassMaterial!;

    // Helper to build each concentric brass orbital track & miniature planet mount
    const createPlanetOrbit = (
      orbitRadius: number,
      planetRadius: number,
      planetMat: THREE.Material,
      withJupiterRing = false
    ): { orbitGroup: THREE.Group; planetMesh: THREE.Mesh } => {
      const trackRing = new THREE.Mesh(
        new THREE.TorusGeometry(orbitRadius, 0.022, 10, 64),
        brassMat
      );
      trackRing.receiveShadow = true;
      dialGroup.add(trackRing);

      const orbitGroup = new THREE.Group();
      // Miniature brass radial arm & vertical pedestal collar
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(orbitRadius, 0.032, 0.032),
        brassMat
      );
      arm.position.set(orbitRadius * 0.5, 0, -0.06);
      arm.castShadow = true;
      orbitGroup.add(arm);

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(planetRadius * 0.62, planetRadius * 0.78, 0.08, 14),
        brassMat
      );
      collar.rotation.x = Math.PI * 0.5;
      collar.position.set(orbitRadius, 0, -0.03);
      orbitGroup.add(collar);

      const planetMesh = new THREE.Mesh(
        new THREE.SphereGeometry(planetRadius, 24, 18),
        planetMat
      );
      planetMesh.position.set(orbitRadius, 0, 0);
      planetMesh.castShadow = true;
      planetMesh.receiveShadow = true;
      orbitGroup.add(planetMesh);

      if (withJupiterRing) {
        const jRing = new THREE.Mesh(
          new THREE.TorusGeometry(planetRadius * 1.45, 0.015, 8, 36),
          brassMat
        );
        jRing.position.copy(planetMesh.position);
        jRing.rotation.x = THREE.MathUtils.degToRad(68);
        jRing.rotation.y = THREE.MathUtils.degToRad(14);
        orbitGroup.add(jRing);
      }

      dialGroup.add(orbitGroup);
      return { orbitGroup, planetMesh };
    };

    this.mercuryOrbitGroup = createPlanetOrbit(0.92, 0.082, mercuryMat).orbitGroup;
    this.venusOrbitGroup = createPlanetOrbit(1.28, 0.12, venusMat).orbitGroup;

    // Earth (r = 1.72, 23.44 deg axial tilt) + orbiting bump-mapped Moon with sunlit hemisphere
    const earthTrack = new THREE.Mesh(
      new THREE.TorusGeometry(1.72, 0.025, 10, 68),
      this.brassMaterial
    );
    dialGroup.add(earthTrack);

    this.earthOrbitGroup = new THREE.Group();
    const earthArm = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.036, 0.036), this.brassMaterial);
    earthArm.position.set(0.86, 0, -0.06);
    earthArm.castShadow = true;
    this.earthOrbitGroup.add(earthArm);

    const earthStation = new THREE.Group();
    earthStation.position.set(1.72, 0, 0);

    const earthAxialTiltGroup = new THREE.Group();
    earthAxialTiltGroup.rotation.z = THREE.MathUtils.degToRad(23.44);
    this.earthGlobeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 20), earthMat);
    this.earthGlobeMesh.rotation.x = Math.PI * 0.5;
    this.earthGlobeMesh.castShadow = true;
    this.earthGlobeMesh.receiveShadow = true;
    earthAxialTiltGroup.add(this.earthGlobeMesh);
    earthStation.add(earthAxialTiltGroup);

    const moonTrack = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.011, 8, 36),
      this.brassMaterial
    );
    earthStation.add(moonTrack);

    this.moonOrbitGroup = new THREE.Group();
    const moonStrut = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.018), this.brassMaterial);
    moonStrut.position.set(0.16, 0, -0.02);
    this.moonOrbitGroup.add(moonStrut);

    const moonAssembly = new THREE.Group();
    moonAssembly.position.set(0.32, 0, 0);

    const moonGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.058, 20, 14), moonMat);
    moonGlobe.castShadow = true;
    moonGlobe.receiveShadow = true;
    moonAssembly.add(moonGlobe);

    // Sunlit lunar hemisphere shell (+Y pole points toward the Sun for true phase & subtle bloom)
    this.moonSunlitCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.061, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.48),
      this.lunarSunlitMaterial
    );
    moonAssembly.add(this.moonSunlitCap);

    this.moonOrbitGroup.add(moonAssembly);
    earthStation.add(this.moonOrbitGroup);
    this.earthOrbitGroup.add(earthStation);
    dialGroup.add(this.earthOrbitGroup);

    this.marsOrbitGroup = createPlanetOrbit(2.18, 0.105, marsMat).orbitGroup;
    this.jupiterOrbitGroup = createPlanetOrbit(2.68, 0.23, jupiterMat, true).orbitGroup;

    // Astrolabe Clock Hands mounted cleanly in front of the orrery plane
    this.hourHandPivot = new THREE.Group();
    this.hourHandPivot.position.set(0, 0, 0.62);
    const hourBody = new THREE.Mesh(
      createAstrolabeHandGeometry(1.92, 0.24, 0.065),
      this.obsidianMaterial
    );
    hourBody.castShadow = true;
    const hourTrim = new THREE.Mesh(
      createAstrolabeHandTrimGeometry(1.92, 0.24, 0.072),
      this.handTrimGlowMaterial
    );
    hourTrim.position.z = 0.008;
    const hourPointerTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      this.indexGlowMaterial
    );
    hourPointerTip.position.set(0, 1.9, 0.03);
    this.hourHandPivot.add(hourBody, hourTrim, hourPointerTip);
    dialGroup.add(this.hourHandPivot);

    this.minuteHandPivot = new THREE.Group();
    this.minuteHandPivot.position.set(0, 0, 0.74);
    const minuteBody = new THREE.Mesh(
      createAstrolabeHandGeometry(2.74, 0.19, 0.055),
      this.obsidianMaterial
    );
    minuteBody.castShadow = true;
    const minuteTrim = new THREE.Mesh(
      createAstrolabeHandTrimGeometry(2.74, 0.19, 0.062),
      this.handTrimGlowMaterial
    );
    minuteTrim.position.z = 0.008;
    const minutePointerTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      this.indexGlowMaterial
    );
    minutePointerTip.position.set(0, 2.72, 0.025);
    this.minuteHandPivot.add(minuteBody, minuteTrim, minutePointerTip);
    dialGroup.add(this.minuteHandPivot);

    this.secondHandPivot = new THREE.Group();
    this.secondHandPivot.position.set(0, 0, 0.86);
    const secondNeedle = new THREE.Mesh(
      createCometSecondHandGeometry(2.88, 0.038),
      this.secondHandGlowMaterial
    );
    secondNeedle.castShadow = true;
    this.secondHandPivot.add(secondNeedle);
    dialGroup.add(this.secondHandPivot);

    // Central turned brass & obsidian hand arbor cap
    const arborBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.16, 20),
      this.brassMaterial
    );
    arborBoss.rotation.x = Math.PI * 0.5;
    arborBoss.position.set(0, 0, 0.88);
    dialGroup.add(arborBoss);

    scene.add(dialGroup);

    // =========================================================================
    // 5. LOWER ZONE: ARMILLARY ASTROLABE PENDULUM & MERIDIAN DEGREE ARC
    // =========================================================================
    const pendWorld = ThreeStage.canvasToWorldXY(
      this.manifest.pendulum.pivot.x,
      this.manifest.pendulum.pivot.y
    );

    this.pendulumPivotGroup = new THREE.Group();
    this.pendulumPivotGroup.position.set(pendWorld.x, pendWorld.y, -1.55);

    const bobCenterY = -6.15;

    // Twin obsidian & brass suspension rods
    for (const rx of [-0.14, 0.14]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 5.4, 12),
        this.brassMaterial
      );
      rod.position.set(rx, -2.7, 0);
      rod.castShadow = true;
      this.pendulumPivotGroup.add(rod);
    }

    const yokeBridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.18, 0.16),
      this.obsidianMaterial
    );
    yokeBridge.position.set(0, bobCenterY + 0.84, 0);
    yokeBridge.castShadow = true;
    this.pendulumPivotGroup.add(yokeBridge);

    // Multi-ring gimbaled armillary astrolabe bob
    const armillaryGroup = new THREE.Group();
    armillaryGroup.position.set(0, bobCenterY, 0);

    const meridianRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.052, 16, 48),
      this.brassMaterial
    );
    meridianRing.castShadow = true;
    armillaryGroup.add(meridianRing);

    const equatorialRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.04, 14, 42),
      this.brassMaterial
    );
    equatorialRing.rotation.x = Math.PI * 0.5;
    equatorialRing.castShadow = true;
    armillaryGroup.add(equatorialRing);

    const eclipticRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.035, 14, 42),
      this.copperAccentMaterial
    );
    eclipticRing.rotation.x = THREE.MathUtils.degToRad(66.56);
    eclipticRing.rotation.y = THREE.MathUtils.degToRad(23.44);
    eclipticRing.castShadow = true;
    armillaryGroup.add(eclipticRing);

    this.armillaryInnerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.032, 12, 36),
      this.brassMaterial
    );
    this.armillaryInnerRing.rotation.y = Math.PI * 0.35;
    this.armillaryInnerRing.castShadow = true;
    armillaryGroup.add(this.armillaryInnerRing);

    const centralOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 22, 18),
      this.obsidianMaterial
    );
    centralOrb.castShadow = true;
    armillaryGroup.add(centralOrb);

    const plumbTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.36, 14),
      this.brassMaterial
    );
    plumbTip.rotation.x = Math.PI;
    plumbTip.position.y = -0.92;
    plumbTip.castShadow = true;
    armillaryGroup.add(plumbTip);

    this.pendulumPivotGroup.add(armillaryGroup);
    scene.add(this.pendulumPivotGroup);

    // Recessed curved brass meridian degree arc below pendulum
    const degreeArcGroup = new THREE.Group();
    degreeArcGroup.position.set(pendWorld.x, pendWorld.y, -1.68);
    const arcRadius = 7.72;
    const arcSpan = THREE.MathUtils.degToRad(32);
    const arcStart = -Math.PI * 0.5 - arcSpan * 0.5;

    const meridianArc = new THREE.Mesh(
      new THREE.TorusGeometry(arcRadius, 0.11, 14, 40, arcSpan),
      this.brassMaterial
    );
    meridianArc.rotation.z = arcStart;
    meridianArc.receiveShadow = true;
    meridianArc.castShadow = true;
    degreeArcGroup.add(meridianArc);

    const backingArc = new THREE.Mesh(
      new THREE.TorusGeometry(arcRadius + 0.16, 0.065, 12, 36, arcSpan + 0.04),
      walnutFrameMaterial
    );
    backingArc.rotation.z = arcStart - 0.02;
    backingArc.receiveShadow = true;
    degreeArcGroup.add(backingArc);

    const arcTickGeo = new THREE.BoxGeometry(0.04, 0.24, 0.12);
    for (let deg = -14; deg <= 14; deg += 2) {
      const a = THREE.MathUtils.degToRad(deg);
      const isMajor = deg % 10 === 0;
      const tick = new THREE.Mesh(
        arcTickGeo,
        isMajor ? this.indexGlowMaterial : this.obsidianMaterial
      );
      tick.scale.set(isMajor ? 1.4 : 1.0, isMajor ? 1.25 : 0.9, 1.0);
      tick.position.set(Math.sin(a) * arcRadius, -Math.cos(a) * arcRadius, 0.08);
      tick.rotation.z = a;
      degreeArcGroup.add(tick);
    }

    // Walnut & brass anchor piers connecting degree arc to chamber backplate
    const arcPierGeo = new THREE.BoxGeometry(0.28, 0.34, 2.5);
    for (const anchorDeg of [-12, 0, 12]) {
      const a = THREE.MathUtils.degToRad(anchorDeg);
      const pier = new THREE.Mesh(arcPierGeo, walnutFrameMaterial);
      pier.position.set(Math.sin(a) * arcRadius, -Math.cos(a) * arcRadius, -1.26);
      pier.rotation.z = a;
      pier.receiveShadow = true;
      degreeArcGroup.add(pier);
    }

    scene.add(degreeArcGroup);

    stage.registerObjectTree(scene);
  }

  private applyEphemerisToScene(ephem: OrreryEphemerisState): void {
    const rad = THREE.MathUtils.degToRad;
    if (this.mercuryOrbitGroup) this.mercuryOrbitGroup.rotation.z = rad(ephem.mercuryLonDeg);
    if (this.venusOrbitGroup) this.venusOrbitGroup.rotation.z = rad(ephem.venusLonDeg);
    if (this.earthOrbitGroup) this.earthOrbitGroup.rotation.z = rad(ephem.earthLonDeg);
    if (this.marsOrbitGroup) this.marsOrbitGroup.rotation.z = rad(ephem.marsLonDeg);
    if (this.jupiterOrbitGroup) this.jupiterOrbitGroup.rotation.z = rad(ephem.jupiterLonDeg);

    // Moon orbit: MoonPhase 0 deg = New Moon (toward Sun = -X in Earth radial frame), 180 deg = Full Moon (+X)
    const moonLocalAngleRad = rad(ephem.lunarPhaseDeg - 180);
    if (this.moonOrbitGroup) {
      this.moonOrbitGroup.rotation.z = moonLocalAngleRad;
    }
    // Orient sunlit lunar cap (+Y pole) straight toward the Sun at (-1.72, 0, 0) in Earth frame
    if (this.moonSunlitCap) {
      const moonX = 0.32 * Math.cos(moonLocalAngleRad);
      const moonY = 0.32 * Math.sin(moonLocalAngleRad);
      const toSunX = -1.72 - moonX;
      const toSunY = -moonY;
      const worldAngleToSun = Math.atan2(toSunY, toSunX);
      // Inside moonOrbitGroup (already rotated by moonLocalAngleRad), cap +Y points at local angle:
      const localAngle = worldAngleToSun - moonLocalAngleRad;
      this.moonSunlitCap.rotation.z = localAngle - Math.PI * 0.5;
    }

    if (this.siderealDomeGroup) {
      this.siderealDomeGroup.rotation.z = -ephem.siderealAngleRad;
    }
  }

  private getModeTargets(mode: ClockMode): {
    solarColor: THREE.Color;
    coronaColor: THREE.Color;
    indexColor: THREE.Color;
    starColor: THREE.Color;
    solarIntensity: number;
    coronaIntensity: number;
    indexIntensity: number;
    lunarIntensity: number;
    secondIntensity: number;
    eclipseFactor: number;
    solarLightIntensity: number;
    overheadLightIntensity: number;
    exposure: number;
    envIntensity: number;
    bloomStrength: number;
  } {
    if (mode === 'night') {
      return {
        solarColor: COLOR_NIGHT_RED,
        coronaColor: COLOR_NIGHT_CORONA,
        indexColor: COLOR_NIGHT_INDEX,
        starColor: COLOR_NIGHT_STAR,
        solarIntensity: 1.05,
        coronaIntensity: 0.72,
        indexIntensity: 0.72,
        lunarIntensity: 0.55,
        secondIntensity: 0.8,
        eclipseFactor: 0.15,
        solarLightIntensity: 11.0,
        overheadLightIntensity: 22.0,
        exposure: 0.66,
        envIntensity: 0.42,
        bloomStrength: 0.2
      };
    }
    if (mode === 'sleep') {
      return {
        solarColor: COLOR_SLEEP_ECLIPSE,
        coronaColor: COLOR_SLEEP_CORONA,
        indexColor: COLOR_SLEEP_INDEX,
        starColor: COLOR_SLEEP_ECLIPSE,
        solarIntensity: 0.14,
        coronaIntensity: 0.22,
        indexIntensity: 0.04,
        lunarIntensity: 0.02,
        secondIntensity: 0.04,
        eclipseFactor: 1.0,
        solarLightIntensity: 0.4,
        overheadLightIntensity: 2.5,
        exposure: 0.26,
        envIntensity: 0.12,
        bloomStrength: 0.08
      };
    }
    // 'active' or 'silent'
    return {
      solarColor: COLOR_ACTIVE_SOLAR,
      coronaColor: COLOR_ACTIVE_CORONA,
      indexColor: COLOR_ACTIVE_INDEX,
      starColor: COLOR_ACTIVE_STAR,
      solarIntensity: 2.2,
      coronaIntensity: 1.55,
      indexIntensity: 2.15,
      lunarIntensity: 1.65,
      secondIntensity: 1.95,
      eclipseFactor: 0.0,
      solarLightIntensity: 36.0,
      overheadLightIntensity: 78.0,
      exposure: 0.96,
      envIntensity: 0.88,
      bloomStrength: 0.28
    };
  }

  private applyModeTargets(immediate: boolean, lerpAlpha = 1.0): void {
    const targets = this.getModeTargets(this.targetMode);
    const a = immediate ? 1.0 : Math.max(0, Math.min(1, lerpAlpha));

    this.currentSolarColor.lerp(targets.solarColor, a);
    this.currentCoronaColor.lerp(targets.coronaColor, a);
    this.currentIndexColor.lerp(targets.indexColor, a);
    this.currentStarColor.lerp(targets.starColor, a);

    this.currentSolarIntensity = THREE.MathUtils.lerp(
      this.currentSolarIntensity,
      targets.solarIntensity,
      a
    );
    this.currentCoronaIntensity = THREE.MathUtils.lerp(
      this.currentCoronaIntensity,
      targets.coronaIntensity,
      a
    );
    this.currentIndexIntensity = THREE.MathUtils.lerp(
      this.currentIndexIntensity,
      targets.indexIntensity,
      a
    );
    this.currentLunarIntensity = THREE.MathUtils.lerp(
      this.currentLunarIntensity,
      targets.lunarIntensity,
      a
    );
    this.currentSecondIntensity = THREE.MathUtils.lerp(
      this.currentSecondIntensity,
      targets.secondIntensity,
      a
    );
    this.currentEclipseFactor = THREE.MathUtils.lerp(
      this.currentEclipseFactor,
      targets.eclipseFactor,
      a
    );
    this.currentSolarLightIntensity = THREE.MathUtils.lerp(
      this.currentSolarLightIntensity,
      targets.solarLightIntensity,
      a
    );
    this.currentOverheadLightIntensity = THREE.MathUtils.lerp(
      this.currentOverheadLightIntensity,
      targets.overheadLightIntensity,
      a
    );
    this.currentExposure = THREE.MathUtils.lerp(this.currentExposure, targets.exposure, a);
    this.currentEnvIntensity = THREE.MathUtils.lerp(this.currentEnvIntensity, targets.envIntensity, a);
    this.currentBloomStrength = THREE.MathUtils.lerp(
      this.currentBloomStrength,
      targets.bloomStrength,
      a
    );

    const pulseExtra = this.targetMode === 'sleep' ? 0 : this.alertPulseBoost;

    if (this.solarSurfaceMaterial) {
      this.solarSurfaceMaterial.uniforms.uCoreColor.value.copy(this.currentSolarColor);
      this.solarSurfaceMaterial.uniforms.uCoronaColor.value.copy(this.currentCoronaColor);
      this.solarSurfaceMaterial.uniforms.uEmissiveIntensity.value =
        this.currentSolarIntensity + pulseExtra * 0.7;
      this.solarSurfaceMaterial.uniforms.uEclipseFactor.value = this.currentEclipseFactor;
    }
    if (this.solarCoronaMaterial) {
      this.solarCoronaMaterial.uniforms.uColor.value.copy(this.currentSolarColor);
      this.solarCoronaMaterial.uniforms.uIntensity.value =
        this.currentCoronaIntensity + pulseExtra * 0.5;
      this.solarCoronaMaterial.uniforms.uEclipseFactor.value = this.currentEclipseFactor;
    }
    if (this.starfieldMaterial) {
      this.starfieldMaterial.uniforms.uTint.value.copy(this.currentStarColor);
      this.starfieldMaterial.uniforms.uBrightness.value =
        this.targetMode === 'sleep' ? 0.12 : this.targetMode === 'night' ? 0.65 : 1.0;
    }
    if (this.constellationLineMaterial) {
      this.constellationLineMaterial.opacity =
        this.targetMode === 'sleep' ? 0.05 : this.targetMode === 'night' ? 0.24 : 0.38;
      this.constellationLineMaterial.color.copy(this.currentStarColor);
    }
    if (this.indexGlowMaterial) {
      this.indexGlowMaterial.emissive.copy(this.currentIndexColor);
      this.indexGlowMaterial.emissiveIntensity = this.currentIndexIntensity + pulseExtra * 0.45;
    }
    if (this.handTrimGlowMaterial) {
      this.handTrimGlowMaterial.emissive.copy(this.currentSolarColor);
      this.handTrimGlowMaterial.emissiveIntensity =
        this.targetMode === 'sleep' ? 0.05 : this.targetMode === 'night' ? 0.45 : 1.05;
    }
    if (this.secondHandGlowMaterial) {
      this.secondHandGlowMaterial.emissive.copy(this.currentCoronaColor);
      this.secondHandGlowMaterial.emissiveIntensity = this.currentSecondIntensity;
    }
    if (this.lunarSunlitMaterial) {
      this.lunarSunlitMaterial.emissive.copy(this.currentIndexColor);
      this.lunarSunlitMaterial.emissiveIntensity = this.currentLunarIntensity;
    }

    if (this.solarPointLight) {
      this.solarPointLight.intensity = this.currentSolarLightIntensity + pulseExtra * 8.0;
      this.solarPointLight.color.copy(this.currentSolarColor);
    }
    if (this.overheadSpotlight) {
      this.overheadSpotlight.intensity = this.currentOverheadLightIntensity;
    }
    if (this.grazingRimSpotlight) {
      this.grazingRimSpotlight.intensity =
        this.targetMode === 'sleep' ? 1.8 : this.targetMode === 'night' ? 12.0 : 36.0;
      this.grazingRimSpotlight.color.copy(this.currentStarColor);
    }
    if (this.ambientLight) {
      this.ambientLight.intensity =
        this.targetMode === 'sleep' ? 0.03 : this.targetMode === 'night' ? 0.09 : 0.22;
    }

    if (this.stage) {
      this.stage.setBloomParameters({
        threshold: 1.45,
        strength: this.currentBloomStrength,
        radius: 0.4
      });
      this.stage.setToneMappingExposure(this.currentExposure);
      this.stage.setEnvironmentIntensity(this.currentEnvIntensity);
    }
  }

  public renderPendulum(_ctx: CanvasRenderingContext2D, physicsData: PhysicsData): void {
    if (!this.isMounted || !this.stage) return;

    if (this.targetMode === 'sleep') {
      this.brakeFactor = Math.min(this.brakeFactor * 0.88, physicsData.dampingFactor);
      if (this.brakeFactor < 0.002) this.brakeFactor = 0;
    } else {
      this.brakeFactor = physicsData.dampingFactor;
    }

    const dampedAngleRad = physicsData.angleRad * this.brakeFactor;
    this.lastPhysicsAngleRad = dampedAngleRad;

    if (this.pendulumPivotGroup) {
      this.pendulumPivotGroup.rotation.z = dampedAngleRad;
    }
    if (this.overheadSpotlight) {
      const base = this.currentOverheadLightIntensity;
      this.overheadSpotlight.intensity = physicsData.dimmed ? base * 0.35 : base;
    }
  }

  public renderDial(_ctx: CanvasRenderingContext2D, timeData: TimeData): void {
    if (!this.isMounted || !this.stage) return;

    const dtSec = Math.max(0.001, Math.min(0.25, timeData.deltaTimeSec || 0.016));
    if (this.targetMode === 'sleep') {
      this.brakeFactor = Math.max(0, this.brakeFactor - dtSec * 0.85);
      if (this.pendulumPivotGroup) {
        this.pendulumPivotGroup.rotation.z = this.lastPhysicsAngleRad * this.brakeFactor;
      }
      if (this.brakeFactor <= 0.002) {
        this.brakeFactor = 0;
        if (this.pendulumPivotGroup) this.pendulumPivotGroup.rotation.z = 0;
      }
    } else if (this.brakeFactor < 1.0) {
      this.brakeFactor = Math.min(1.0, this.brakeFactor + dtSec * 0.65);
    }

    const modeLerp = 1 - Math.exp(-dtSec * 4.5);
    this.applyModeTargets(false, modeLerp);

    // 0. Subtle Breathing Parallax Camera
    this.cameraPhaseSec += dtSec * this.brakeFactor;
    this.pointerCurrentX += (this.pointerTargetX - this.pointerCurrentX) * Math.min(1, dtSec * 4.5);
    this.pointerCurrentY += (this.pointerTargetY - this.pointerCurrentY) * Math.min(1, dtSec * 4.5);

    const swayDegX =
      Math.sin((this.cameraPhaseSec * Math.PI * 2) / 25.0) * 3.5 * this.brakeFactor +
      this.pointerCurrentX * 2.2 * this.brakeFactor;
    const swayDegY =
      Math.cos((this.cameraPhaseSec * Math.PI * 2) / 19.5) * 2.0 * this.brakeFactor +
      this.pointerCurrentY * 1.4 * this.brakeFactor;

    const swayRadX = THREE.MathUtils.degToRad(swayDegX);
    const swayRadY = THREE.MathUtils.degToRad(swayDegY);
    const camDist = this.stage.baseCameraZ;
    this.stage.camera.position.set(
      Math.sin(swayRadX) * camDist,
      Math.sin(swayRadY) * camDist,
      Math.cos(swayRadX) * Math.cos(swayRadY) * camDist
    );
    this.stage.camera.lookAt(0, 0.15, -1.55);

    // 1. Synchronized Astrolabe Clock Hands
    if (this.hourHandPivot) this.hourHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.hour);
    if (this.minuteHandPivot) this.minuteHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.minute);
    if (this.secondHandPivot) this.secondHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeData.angles.second);

    // 2. Real-Time Offline Ephemeris (Mercury..Jupiter, Lunar Phase & Sidereal Rotation)
    this.lastEphemeris = computeOrreryEphemeris(timeData.date);
    this.applyEphemerisToScene(this.lastEphemeris);

    // 3. Solar Shader Granulation, Starfield Twinkle, Earth Axial Spin & Armillary Ring Precession
    const simDeltaSec =
      this.lastTickTimestampMs !== null
        ? Math.max(0, (timeData.timestampMs - this.lastTickTimestampMs) / 1000)
        : dtSec;
    this.lastTickTimestampMs = timeData.timestampMs;

    this.orreryPhaseSec += simDeltaSec * this.brakeFactor;
    const tSec = this.orreryPhaseSec;

    if (this.solarSurfaceMaterial) {
      this.solarSurfaceMaterial.uniforms.uTime.value = tSec;
    }
    if (this.solarCoronaMaterial) {
      this.solarCoronaMaterial.uniforms.uTime.value = tSec;
    }
    if (this.starfieldMaterial) {
      this.starfieldMaterial.uniforms.uTime.value = tSec;
    }
    if (this.earthGlobeMesh) {
      this.earthGlobeMesh.rotation.y = (tSec * 0.25) % (Math.PI * 2);
    }
    if (this.armillaryInnerRing) {
      this.armillaryInnerRing.rotation.y =
        this.targetMode === 'sleep' ? Math.PI * 0.35 : Math.PI * 0.35 + tSec * 0.32;
    }

    if (this.alertPulseBoost > 0) {
      this.alertPulseBoost = Math.max(0, this.alertPulseBoost - dtSec * 1.5);
    }

    if (this.targetMode === 'sleep' && this.brakeFactor <= 0.001) {
      this.currentMode = 'sleep';
      if (timeData.realTimeMs - this.lastSleepRenderTimeMs < 950) {
        return;
      }
      this.lastSleepRenderTimeMs = timeData.realTimeMs;
    } else {
      this.currentMode = this.targetMode;
    }

    if (this.dialGroup) {
      const offset = ThreeStage.dialCenterToOffsetWorld(
        this.manifest.dial.center.x,
        this.manifest.dial.center.y
      );
      this.dialGroup.position.x = this.dialBasePos.x + offset.x;
      this.dialGroup.position.y = this.dialBasePos.y + offset.y;
    }
    this.stage.render();
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, telemetryData: TelemetryData): void {
    if (!this.isMounted) return;

    if (telemetryData.mode && telemetryData.mode !== this.targetMode) {
      this.targetMode = telemetryData.mode;
    }

    if (telemetryData.isSleeping) {
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(11, 15, 25, 0.82)';
    ctx.strokeStyle =
      this.targetMode === 'night' ? 'rgba(255, 56, 44, 0.45)' : 'rgba(198, 150, 72, 0.48)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(240, 1840, 600, 38, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 13px "Consolas", "Courier New", monospace';
    ctx.fillStyle = this.targetMode === 'night' ? '#ff7c70' : '#ffdf94';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lstHours = Math.floor(this.lastEphemeris.siderealHours)
      .toString()
      .padStart(2, '0');
    const lstMins = Math.floor((this.lastEphemeris.siderealHours % 1) * 60)
      .toString()
      .padStart(2, '0');
    ctx.fillText(
      `CELESTIAL ORRERY  •  LST ${lstHours}h${lstMins}m  •  LUNAR ${this.lastEphemeris.lunarPhaseDeg.toFixed(0)}°  •  ${telemetryData.fps.toFixed(0)} FPS`,
      540,
      1859
    );
    ctx.restore();
  }

  public onEvent(event: ThemeEvent): void {
    if (!this.isMounted) return;

    if (event.type === 'mode_change' && event.payload) {
      const nextMode = (event.payload as { mode?: ClockMode }).mode;
      if (nextMode) {
        this.targetMode = nextMode;
        this.currentMode = nextMode;
      }
    } else if (
      event.type === 'notification' ||
      event.type === 'priority_alert' ||
      event.type === 'mqtt_pulse'
    ) {
      this.alertPulseBoost = event.priority === 'urgent' ? 2.1 : 1.15;
    }
  }

  public destroy(): void {
    this.isMounted = false;
    this.cleanupPointerParallax();
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
    this.ambientLight = null;
    this.overheadSpotlight = null;
    this.grazingRimSpotlight = null;
    this.solarPointLight = null;
    this.obsidianMaterial = null;
    this.brassMaterial = null;
    this.copperAccentMaterial = null;
    this.solarSurfaceMaterial = null;
    this.solarCoronaMaterial = null;
    this.starfieldMaterial = null;
    this.constellationLineMaterial = null;
    this.indexGlowMaterial = null;
    this.handTrimGlowMaterial = null;
    this.secondHandGlowMaterial = null;
    this.lunarSunlitMaterial = null;
    this.siderealDomeGroup = null;
    this.sunMesh = null;
    this.mercuryOrbitGroup = null;
    this.venusOrbitGroup = null;
    this.earthOrbitGroup = null;
    this.earthGlobeMesh = null;
    this.moonOrbitGroup = null;
    this.moonSunlitCap = null;
    this.marsOrbitGroup = null;
    this.jupiterOrbitGroup = null;
    this.hourHandPivot = null;
    this.minuteHandPivot = null;
    this.secondHandPivot = null;
    this.pendulumPivotGroup = null;
    this.armillaryInnerRing = null;
  }
}

