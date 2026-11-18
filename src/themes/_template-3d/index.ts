import * as THREE from 'three';
import { ClockMode, ThemeManifest } from '../../types/theme';
import {
  ClockTheme,
  ThemeConfig,
  ThemeEvent,
  TimeData
} from '../types';
import { ThreeStage, ThreeStageResourceStats } from '../three/ThreeStage';
import {
  applyDialCenterToGroup,
  applySleepModeIsolation,
  BLEED_MARGIN_PX,
  classifyThemeEvent,
  createDefaultManifest,
  DIAL_CENTER_BASELINE,
  setStandardZLayer,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  THREE_PIXELS_PER_UNIT
} from '../helpers';

/**
 * Copy-Paste Three.js 3D Starter Template
 *
 * When copying to `src/themes/<your_theme>/index.ts`:
 * 1. Change `id` and `name` to unique values.
 * 2. Customize geometries/materials while preserving `dialGroup`, `handsGroup`,
 *    `emissiveIndicatorMeshes`, and `STANDARD_Z_LAYERS`.
 * 3. Register the theme in `src/themes/themeManager.ts`.
 */
export class Template3DTheme implements ClockTheme {
  public readonly id = 'template_3d';
  public readonly name = 'Template 3D Clock';
  public readonly renderer = 'three' as const;

  private stage: ThreeStage | null = null;
  private manifest: ThemeManifest = createDefaultManifest('Template 3D Clock');
  private presenceMode: ClockMode = 'active';
  private dialCenter: { x: number; y: number } = {
    x: DIAL_CENTER_BASELINE.x,
    y: DIAL_CENTER_BASELINE.y
  };

  // Scene hierarchy
  private backgroundMesh: THREE.Mesh | null = null;
  private cabinetGroup: THREE.Group | null = null;
  private dialGroup: THREE.Group | null = null;
  private dialPlateGroup: THREE.Group | null = null;
  private portholeGlassMesh: THREE.Mesh | null = null;
  private handsGroup: THREE.Group | null = null;

  // Hand pivots & hub
  private hourHandPivot: THREE.Group | null = null;
  private minuteHandPivot: THREE.Group | null = null;
  private secondHandPivot: THREE.Group | null = null;
  private secondHandGroup: THREE.Group | null = null;
  private hubCapMesh: THREE.Mesh | null = null;

  // Sleep-isolated glowing indicator strips
  private emissiveIndicatorMeshes: THREE.Object3D[] = [];
  private handEmissiveMaterial: THREE.MeshBasicMaterial | null = null;
  private alertRingMaterial: THREE.MeshBasicMaterial | null = null;

  // Lights
  private keyLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  // Reactive telemetry pulse state
  private doorbellPulse = 0;
  private securityAlertPulse = 0;

  public getManifest(): ThemeManifest {
    return this.manifest;
  }

  public getThreeStage(): ThreeStage | null {
    return this.stage;
  }

  public getResourceStats(): ThreeStageResourceStats | null {
    return this.stage ? this.stage.getResourceStats() : null;
  }

  public getPresenceMode(): ClockMode {
    return this.presenceMode;
  }

  public getDialGroup(): THREE.Group | null {
    return this.dialGroup;
  }

  public getHandsGroup(): THREE.Group | null {
    return this.handsGroup;
  }

  public getEmissiveIndicatorMeshes(): THREE.Object3D[] {
    return [...this.emissiveIndicatorMeshes];
  }

  public async init(config?: ThemeConfig): Promise<void> {
    const width = config?.width ?? STAGE_WIDTH;
    const height = config?.height ?? STAGE_HEIGHT;
    this.manifest = config?.manifest
      ? structuredClone(config.manifest)
      : createDefaultManifest(this.name);
    this.dialCenter = { ...this.manifest.dial.center };
    this.emissiveIndicatorMeshes = [];

    const stage = new ThreeStage({
      width,
      height,
      stageElement: config?.stageElement
    });
    await stage.init();
    this.stage = stage;

    this.buildLights(stage);
    this.buildBackgroundAndCabinet(stage);
    this.buildDialGroup(stage);

    this.setDialCenter(this.dialCenter.x, this.dialCenter.y);
    this.setPresenceMode(this.presenceMode);
  }

  private buildLights(stage: ThreeStage): void {
    this.ambientLight = new THREE.AmbientLight(0xdbeafe, 0.35);
    stage.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    this.keyLight.position.set(4, 7, 10);
    stage.scene.add(this.keyLight);
  }

  private buildBackgroundAndCabinet(stage: ThreeStage): void {
    // 1. Full 1080×1920 background with ±500 px bleed margins (never moves with dialCenter)
    const bleedWidthWorld = (STAGE_WIDTH + BLEED_MARGIN_PX * 2) / THREE_PIXELS_PER_UNIT;
    const bleedHeightWorld = (STAGE_HEIGHT + BLEED_MARGIN_PX * 2) / THREE_PIXELS_PER_UNIT;

    const bgGeo = stage.trackGeometry(new THREE.PlaneGeometry(bleedWidthWorld, bleedHeightWorld));
    const bgMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x090d14, roughness: 0.9, metalness: 0.1 })
    );
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    setStandardZLayer(bgMesh, 'BACKGROUND');
    stage.scene.add(bgMesh);
    this.backgroundMesh = bgMesh;

    // 2. Outer cabinet frame
    const cabinetGroup = new THREE.Group();
    setStandardZLayer(cabinetGroup, 'CABINET_FRAME');
    const frameGeo = stage.trackGeometry(new THREE.BoxGeometry(9.6, 17.6, 0.3));
    const frameMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x161d29, roughness: 0.55, metalness: 0.45 })
    );
    cabinetGroup.add(new THREE.Mesh(frameGeo, frameMat));
    stage.scene.add(cabinetGroup);
    this.cabinetGroup = cabinetGroup;
  }

  private buildDialGroup(stage: ThreeStage): void {
    // Movable dialGroup (offset strictly via setDialCenter)
    const dialGroup = new THREE.Group();
    dialGroup.visible = true;
    stage.scene.add(dialGroup);
    this.dialGroup = dialGroup;

    // 3. Dial plate & indices
    const dialPlateGroup = new THREE.Group();
    setStandardZLayer(dialPlateGroup, 'DIAL_PLATE_AND_GEARS');
    dialGroup.add(dialPlateGroup);
    this.dialPlateGroup = dialPlateGroup;

    const plateGeo = stage.trackGeometry(new THREE.CylinderGeometry(4.0, 4.0, 0.14, 64));
    plateGeo.rotateX(Math.PI * 0.5);
    const plateMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.45, metalness: 0.65 })
    );
    dialPlateGroup.add(new THREE.Mesh(plateGeo, plateMat));

    const markerGeo = stage.trackGeometry(new THREE.BoxGeometry(0.08, 0.34, 0.06));
    const markerMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.8 })
    );
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(Math.sin(angle) * 3.5, Math.cos(angle) * 3.5, 0.09);
      marker.rotation.z = -angle;
      dialPlateGroup.add(marker);
    }

    // Telemetry alert ring around dial
    const alertGeo = stage.trackGeometry(new THREE.RingGeometry(4.05, 4.18, 64));
    const alertMat = stage.trackMaterial(
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0 })
    );
    const alertRing = new THREE.Mesh(alertGeo, alertMat);
    alertRing.position.z = 0.1;
    dialPlateGroup.add(alertRing);
    this.alertRingMaterial = alertMat;

    // 4. Porthole glass layer
    const glassGeo = stage.trackGeometry(new THREE.CircleGeometry(4.0, 64));
    const glassMat = stage.trackMaterial(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        roughness: 0.08,
        metalness: 0.0
      })
    );
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    setStandardZLayer(glassMesh, 'PORTHOLE_GLASS');
    dialGroup.add(glassMesh);
    this.portholeGlassMesh = glassMesh;

    // 5. Isolated handsGroup (always visible = true so Sleep mode keeps glowing needles)
    const handsGroup = new THREE.Group();
    handsGroup.visible = true;
    dialGroup.add(handsGroup);
    this.handsGroup = handsGroup;

    const bodyMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.85 })
    );
    this.handEmissiveMaterial = stage.trackMaterial(
      new THREE.MeshBasicMaterial({ color: 0xff8a2b })
    );

    this.hourHandPivot = this.createHand(stage, handsGroup, 'HOUR_HAND', 2.2, 0.18, bodyMat);
    this.minuteHandPivot = this.createHand(stage, handsGroup, 'MINUTE_HAND', 3.2, 0.12, bodyMat);
    this.secondHandPivot = this.createHand(stage, handsGroup, 'SECOND_HAND', 3.5, 0.06, bodyMat, false);
    this.secondHandGroup = this.secondHandPivot;

    const capGeo = stage.trackGeometry(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 32));
    capGeo.rotateX(Math.PI * 0.5);
    const capMat = stage.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.25, metalness: 0.9 })
    );
    const capMesh = new THREE.Mesh(capGeo, capMat);
    setStandardZLayer(capMesh, 'HUB_CAP');
    handsGroup.add(capMesh);
    this.hubCapMesh = capMesh;
  }

  private createHand(
    stage: ThreeStage,
    handsGroup: THREE.Group,
    layer: 'HOUR_HAND' | 'MINUTE_HAND' | 'SECOND_HAND',
    length: number,
    width: number,
    bodyMat: THREE.Material,
    includeInSleep = true
  ): THREE.Group {
    const pivot = new THREE.Group();
    setStandardZLayer(pivot, layer);
    handsGroup.add(pivot);

    const bodyGeo = stage.trackGeometry(new THREE.BoxGeometry(width, length, 0.04));
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = length * 0.4;
    pivot.add(bodyMesh);

    if (includeInSleep && this.handEmissiveMaterial) {
      const stripGeo = stage.trackGeometry(
        new THREE.BoxGeometry(width * 0.45, length * 0.82, 0.05)
      );
      const stripMesh = new THREE.Mesh(stripGeo, this.handEmissiveMaterial);
      stripMesh.position.y = length * 0.42;
      stripMesh.position.z = 0.01;
      pivot.add(stripMesh);
      this.emissiveIndicatorMeshes.push(stripMesh);
    }

    return pivot;
  }

  public resize(width = STAGE_WIDTH, height = STAGE_HEIGHT): void {
    if (!this.stage) return;
    this.stage.camera.aspect = width / height;
    this.stage.camera.updateProjectionMatrix();
  }

  public setPresenceMode(mode: ClockMode): void {
    this.presenceMode = mode;
    const isSleep = mode === 'sleep';

    if (this.secondHandGroup) {
      this.secondHandGroup.visible = !isSleep;
    }

    applySleepModeIsolation(mode, {
      scene: this.stage?.scene,
      dialGroup: this.dialGroup,
      handsGroup: this.handsGroup,
      hiddenInSleepGroups: [
        this.backgroundMesh,
        this.cabinetGroup,
        this.dialPlateGroup,
        this.portholeGlassMesh,
        this.hubCapMesh
      ],
      emissiveIndicatorMeshes: this.emissiveIndicatorMeshes,
      emissiveMaterial: this.handEmissiveMaterial,
      lightsToZeroInSleep: [
        { light: this.ambientLight, activeIntensity: 0.35, nightIntensity: 0.1 },
        { light: this.keyLight, activeIntensity: 1.4, nightIntensity: 0.35 }
      ]
    });
  }

  public setDialCenter(x: number, y: number): void {
    this.dialCenter = { x, y };
    this.manifest.dial.center.x = x;
    this.manifest.dial.center.y = y;
    applyDialCenterToGroup(this.dialGroup, x, y);
  }

  public onEvent(event: ThemeEvent): void {
    const kind = classifyThemeEvent(event);
    if (kind === 'mode_change' && event.payload && 'mode' in event.payload) {
      const mode = (event.payload as { mode?: ClockMode }).mode;
      if (mode) this.setPresenceMode(mode);
      return;
    }
    if (kind === 'doorbell') {
      this.doorbellPulse = 1.0;
    } else if (kind === 'securityAlert') {
      this.securityAlertPulse = 1.0;
    }
  }

  public update(timeState: TimeData, delta: number): void {
    const dt = Math.max(0, Math.min(1, delta));
    this.doorbellPulse = Math.max(0, this.doorbellPulse - dt * 0.75);
    this.securityAlertPulse = Math.max(0, this.securityAlertPulse - dt * 0.55);

    if (this.hourHandPivot) {
      this.hourHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeState.angles.hour);
    }
    if (this.minuteHandPivot) {
      this.minuteHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeState.angles.minute);
    }
    if (this.secondHandPivot) {
      this.secondHandPivot.rotation.z = -THREE.MathUtils.degToRad(timeState.angles.second);
    }

    if (this.alertRingMaterial) {
      if (this.securityAlertPulse > 0.01) {
        this.alertRingMaterial.color.setHex(0xff3b30);
        this.alertRingMaterial.opacity = this.securityAlertPulse * 0.9;
      } else if (this.doorbellPulse > 0.01) {
        this.alertRingMaterial.color.setHex(0x38f8ff);
        this.alertRingMaterial.opacity = this.doorbellPulse * 0.85;
      } else {
        this.alertRingMaterial.opacity = 0;
      }
    }

    this.stage?.render();
  }

  public dispose(): void {
    this.stage?.dispose();
    this.stage = null;
    this.backgroundMesh = null;
    this.cabinetGroup = null;
    this.dialGroup = null;
    this.dialPlateGroup = null;
    this.portholeGlassMesh = null;
    this.handsGroup = null;
    this.hourHandPivot = null;
    this.minuteHandPivot = null;
    this.secondHandPivot = null;
    this.secondHandGroup = null;
    this.hubCapMesh = null;
    this.emissiveIndicatorMeshes = [];
    this.handEmissiveMaterial = null;
    this.alertRingMaterial = null;
    this.keyLight = null;
    this.ambientLight = null;
  }
}
