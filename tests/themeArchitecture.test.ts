import assert from 'node:assert';
import * as THREE from 'three';
import {
  applyDialCenterToGroup,
  applySleepModeIsolation,
  classifyThemeEvent,
  computeBleedRect,
  DEFAULT_NOTIFICATION_STYLE,
  dialCenterToPixelOffset,
  dialCenterToWorldOffset,
  isClockTheme,
  isStandardZLayerOrderValid,
  resolveNotificationStyle,
  STANDARD_Z_LAYERS
} from '../src/themes/helpers';
import { ThemeManager } from '../src/themes/themeManager';
import { TimeData } from '../src/themes/types';
import { Template2DTheme } from '../src/themes/_template-2d';
import { Template3DTheme } from '../src/themes/_template-3d';
import {
  drawVectorBeam,
  VECTOR_GLYPHS,
  VectorOscilloscopeTheme
} from '../src/themes/vector-oscilloscope';

function createMockCanvasContext(fillRectCalls: Array<[number, number, number, number]> = []) {
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    roundRect: () => {},
    clip: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push([x, y, w, h]);
    },
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'transparent',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1
  } as unknown as CanvasRenderingContext2D;
}

function createMockStageElement() {
  const attributes = new Map<string, string>();
  const styleMap = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => attributes.set(k, v),
    getAttribute: (k: string) => attributes.get(k) ?? null,
    prepend: () => {},
    removeChild: () => {},
    style: {
      setProperty: (k: string, v: string) => styleMap.set(k, v),
      getPropertyValue: (k: string) => styleMap.get(k) ?? ''
    },
    _attributes: attributes,
    _styleMap: styleMap
  } as unknown as HTMLElement & {
    _attributes: Map<string, string>;
    _styleMap: Map<string, string>;
  };
}

function createMockTimeData(): TimeData {
  const date = new Date(2026, 10, 18, 10, 10, 30, 500);
  return {
    date,
    hours: 10,
    minutes: 10,
    seconds: 30,
    milliseconds: 500,
    angles: { hour: 305, minute: 60.5, second: 183 },
    secondMode: 'sweep',
    timestampMs: date.getTime(),
    realTimeMs: 1000,
    deltaTimeSec: 0.016
  };
}

// Minimal DOM globals for ThreeStage & ThemeManager in Node
(globalThis as any).document = {
  createElement: () => ({
    width: 1080,
    height: 1920,
    classList: { add: () => {} },
    style: {},
    getContext: () => null
  }),
  body: { setAttribute: () => {} }
};

async function runTests() {
  console.log('--- Starting Theme Architecture & Templates Test Suite ---');

  // 1. Helpers: Dial Center & Bleed Rect
  const pxOffset = dialCenterToPixelOffset(640, 440);
  assert.deepStrictEqual(pxOffset, { dx: 100, dy: -100 });

  const worldOffset = dialCenterToWorldOffset(640, 440);
  assert.deepStrictEqual(worldOffset, { x: 1, y: 1 });

  const bleed = computeBleedRect();
  assert.deepStrictEqual(bleed, { x: -500, y: -500, width: 2080, height: 2920 });

  // 2. Helpers: Z-layer stack ordering
  assert.ok(STANDARD_Z_LAYERS.BACKGROUND < STANDARD_Z_LAYERS.CABINET_FRAME);
  assert.ok(STANDARD_Z_LAYERS.CABINET_FRAME < STANDARD_Z_LAYERS.DIAL_PLATE_AND_GEARS);
  assert.ok(STANDARD_Z_LAYERS.DIAL_PLATE_AND_GEARS < STANDARD_Z_LAYERS.PORTHOLE_GLASS);
  assert.ok(STANDARD_Z_LAYERS.PORTHOLE_GLASS < STANDARD_Z_LAYERS.HOUR_HAND);
  assert.ok(STANDARD_Z_LAYERS.HOUR_HAND < STANDARD_Z_LAYERS.MINUTE_HAND);
  assert.ok(STANDARD_Z_LAYERS.MINUTE_HAND < STANDARD_Z_LAYERS.SECOND_HAND);
  assert.ok(STANDARD_Z_LAYERS.SECOND_HAND < STANDARD_Z_LAYERS.HUB_CAP);

  const bg = new THREE.Object3D();
  bg.position.z = STANDARD_Z_LAYERS.BACKGROUND;
  const cab = new THREE.Object3D();
  cab.position.z = STANDARD_Z_LAYERS.CABINET_FRAME;
  const dial = new THREE.Object3D();
  dial.position.z = STANDARD_Z_LAYERS.DIAL_PLATE_AND_GEARS;
  const glass = new THREE.Object3D();
  glass.position.z = STANDARD_Z_LAYERS.PORTHOLE_GLASS;
  const hour = new THREE.Object3D();
  hour.position.z = STANDARD_Z_LAYERS.HOUR_HAND;
  assert.strictEqual(
    isStandardZLayerOrderValid({
      background: bg,
      cabinetFrame: cab,
      dialPlate: dial,
      portholeGlass: glass,
      hourHand: hour
    }),
    true
  );

  // 3. Helpers: Sleep mode isolation
  const dialGroup = new THREE.Group();
  const handsGroup = new THREE.Group();
  const hiddenCabinet = new THREE.Group();
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff8a2b });
  const needleMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), needleMat);
  handsGroup.add(needleMesh);
  dialGroup.add(handsGroup);

  applySleepModeIsolation('sleep', {
    dialGroup,
    handsGroup,
    hiddenInSleepGroups: [hiddenCabinet],
    emissiveIndicatorMeshes: [needleMesh],
    emissiveMaterial: needleMat
  });
  assert.strictEqual(dialGroup.visible, true);
  assert.strictEqual(handsGroup.visible, true);
  assert.strictEqual(needleMesh.visible, true);
  assert.strictEqual(hiddenCabinet.visible, false);
  assert.strictEqual(needleMat.depthTest, false);

  // 4. Helpers: Event classification
  assert.strictEqual(classifyThemeEvent({ type: 'doorbell' }), 'doorbell');
  assert.strictEqual(
    classifyThemeEvent({ type: 'notification', category: 'doorbell' }),
    'doorbell'
  );
  assert.strictEqual(classifyThemeEvent({ type: 'securityAlert' }), 'securityAlert');
  assert.strictEqual(
    classifyThemeEvent({ type: 'priority_alert', priority: 'urgent' }),
    'securityAlert'
  );

  // 5. Template 2D Theme
  const fillRectCalls: Array<[number, number, number, number]> = [];
  const ctx2d = createMockCanvasContext(fillRectCalls);
  const t2d = new Template2DTheme();
  assert.strictEqual(isClockTheme(t2d), true);
  assert.strictEqual(t2d.renderer, '2d');

  t2d.init({ width: 1080, height: 1920 }, ctx2d);
  t2d.setDialCenter(640, 440);
  t2d.onEvent({ type: 'doorbell' });
  t2d.onEvent({ type: 'securityAlert' });
  for (const mode of ['active', 'silent', 'night', 'sleep'] as const) {
    t2d.setPresenceMode(mode);
    t2d.update(createMockTimeData(), 0.016);
  }
  assert.ok(
    fillRectCalls.some(([x, y, w, h]) => x === -500 && y === -500 && w === 2080 && h === 2920),
    'Template2DTheme must draw full 1080x1920 background with ±500 px bleed margins'
  );
  t2d.dispose();

  // 6. Template 3D Theme
  const t3d = new Template3DTheme();
  assert.strictEqual(isClockTheme(t3d), true);
  assert.strictEqual(t3d.renderer, 'three');

  await t3d.init({ width: 1080, height: 1920, stageElement: createMockStageElement() });
  const stage = t3d.getThreeStage()!;
  const initialCamPos = stage.camera.position.clone();

  t3d.setDialCenter(640, 440);
  assert.strictEqual(t3d.getDialGroup()!.position.x, 1);
  assert.strictEqual(t3d.getDialGroup()!.position.y, 1);
  assert.deepStrictEqual(stage.camera.position.toArray(), initialCamPos.toArray());

  t3d.onEvent({ type: 'doorbell' });
  t3d.onEvent({ type: 'securityAlert' });
  t3d.setPresenceMode('night');
  t3d.update(createMockTimeData(), 0.016);

  t3d.setPresenceMode('sleep');
  t3d.update(createMockTimeData(), 0.016);
  assert.strictEqual(t3d.getDialGroup()!.visible, true);
  assert.strictEqual(t3d.getHandsGroup()!.visible, true);
  assert.ok(t3d.getEmissiveIndicatorMeshes().every((m) => m.visible === true));

  t3d.dispose();
  assert.strictEqual(stage.getResourceStats().disposed, true);

  // 7. Templates are excluded from active ThemeManager switcher, but ClockTheme can be registered
  const mockCanvas = {
    width: 1080,
    height: 1920,
    style: {},
    getContext: () => ctx2d
  } as unknown as HTMLCanvasElement;
  const manager = new ThemeManager(mockCanvas, createMockStageElement());
  const availableIds = manager.getAvailableThemeIds();
  assert.strictEqual(availableIds.includes('template_2d'), false);
  assert.strictEqual(availableIds.includes('template_3d'), false);

  manager.registerTheme(() => new Template2DTheme());
  assert.strictEqual(manager.getAvailableThemeIds().includes('template_2d'), true);

  // 8. Vector CRT Oscilloscope (`vector_oscilloscope`) registration, XY beam, presence modes & events
  assert.strictEqual(availableIds.includes('vector_oscilloscope'), true);
  assert.strictEqual(manager.resolveThemeId('vector_oscilloscope'), 'vector_oscilloscope');
  assert.strictEqual(manager.resolveThemeId('oscilloscope'), 'vector_oscilloscope');
  assert.strictEqual(manager.resolveThemeId('Vector CRT Oscilloscope'), 'vector_oscilloscope');

  // Verify 'J' glyph is present in VECTOR_GLYPHS so 'XY LISSAJOUS' renders completely
  assert.ok(Array.isArray(VECTOR_GLYPHS['J']) && VECTOR_GLYPHS['J'].length > 0);

  const scopeFillRects: Array<[number, number, number, number]> = [];
  let fillCallCount = 0;
  const scopeCtx = createMockCanvasContext(scopeFillRects);
  scopeCtx.fill = () => {
    fillCallCount++;
  };
  const scopeTheme = new VectorOscilloscopeTheme();
  assert.strictEqual(isClockTheme(scopeTheme), true);
  assert.strictEqual(scopeTheme.id, 'vector_oscilloscope');
  assert.strictEqual(scopeTheme.name, 'Vector CRT Oscilloscope');
  assert.strictEqual(scopeTheme.renderer, '2d');

  // Verify drawVectorBeam batches all vertex dwell dots into a single fill() call and uses zero shadowBlur
  fillCallCount = 0;
  drawVectorBeam(
    scopeCtx,
    [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
      { x: 150, y: 50 }
    ],
    { haloColor: '#1aff66', coreColor: '#b8ffd0', dwellDots: true }
  );
  assert.strictEqual(fillCallCount, 1, 'Dwell dots must be batched into a single ctx.fill() call');
  assert.strictEqual(scopeCtx.shadowBlur, 0, 'drawVectorBeam must not use shadowBlur');

  scopeTheme.init({ width: 1080, height: 1920 }, scopeCtx);
  const buildsAfterInit = scopeTheme.getStaticLayerBuildCount();
  assert.strictEqual(buildsAfterInit, 1);

  scopeTheme.setDialCenter(600, 480);
  const buildsAfterDialCenter = scopeTheme.getStaticLayerBuildCount();
  assert.strictEqual(buildsAfterDialCenter, 2);

  scopeTheme.onEvent({ type: 'doorbell' });
  assert.strictEqual(scopeTheme.getTelemetryPulses().doorbellPulse, 1.0);
  scopeTheme.onEvent({ type: 'securityAlert' });
  assert.strictEqual(scopeTheme.getTelemetryPulses().securityAlertPulse, 1.0);

  // Multiple update() frames in the same mode must NOT rebuild staticLayer
  scopeTheme.update(createMockTimeData(), 0.016);
  scopeTheme.update(createMockTimeData(), 0.016);
  assert.strictEqual(scopeTheme.getStaticLayerBuildCount(), buildsAfterDialCenter);

  for (const mode of ['active', 'silent', 'night', 'sleep'] as const) {
    scopeTheme.setPresenceMode(mode);
    scopeTheme.update(createMockTimeData(), 0.016);
  }
  assert.ok(
    scopeFillRects.some(([x, y, w, h]) => x === -500 && y === -500 && w === 2080 && h === 2920),
    'VectorOscilloscopeTheme must draw full 1080x1920 background with ±500 px bleed margins'
  );
  scopeTheme.dispose();

  // 9. Themeable Notification Style resolution & CSS custom properties on ThemeManager
  assert.deepStrictEqual(resolveNotificationStyle(null), DEFAULT_NOTIFICATION_STYLE);
  const t2dForNotif = new Template2DTheme();
  assert.deepStrictEqual(resolveNotificationStyle(t2dForNotif), DEFAULT_NOTIFICATION_STYLE);

  const manifestStyledTheme: any = {
    id: 'manifest_styled',
    name: 'Manifest Styled',
    renderer: '2d',
    init: () => {},
    update: () => {},
    resize: () => {},
    setPresenceMode: () => {},
    setDialCenter: () => {},
    onEvent: () => {},
    dispose: () => {},
    getManifest: () => ({
      name: 'Manifest Styled',
      version: '1.0.0',
      author: 'Test',
      background: '',
      dial: { image: '', center: { x: 540, y: 540 } },
      hands: {
        hour: { image: '', pivot: { x: 0, y: 0 } },
        minute: { image: '', pivot: { x: 0, y: 0 } },
        second: { image: '', pivot: { x: 0, y: 0 }, mode: 'sweep' },
        cap: { image: '', center: { x: 540, y: 540 } }
      },
      pendulum: {
        image: '',
        pivot: { x: 540, y: 990 },
        anchor: { x: 540, y: 990 },
        periodSeconds: 2,
        maxAngleDeg: 6
      },
      notificationZone: { x: 110, y: 1280, width: 860, height: 460 },
      notificationStyle: {
        background: '#112233',
        accentColor: '#44ccff'
      }
    })
  };
  const resolvedFromManifest = resolveNotificationStyle(manifestStyledTheme);
  assert.strictEqual(resolvedFromManifest.background, '#112233');
  assert.strictEqual(resolvedFromManifest.accentColor, '#44ccff');
  assert.strictEqual(resolvedFromManifest.textColor, DEFAULT_NOTIFICATION_STYLE.textColor);

  const stageEl = createMockStageElement();
  const notifCanvas = {
    width: 1080,
    height: 1920,
    style: {},
    getContext: () => createMockCanvasContext()
  } as unknown as HTMLCanvasElement;
  const notifThemeMgr = new ThemeManager(notifCanvas, stageEl);

  await notifThemeMgr.setTheme('vector_oscilloscope', { animateTransition: false });
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), '#030a06');
  assert.strictEqual(stageEl._styleMap.get('--notif-border'), '1px solid #1aff66');
  assert.strictEqual(stageEl._styleMap.get('--notif-radius'), '0px');
  assert.strictEqual(stageEl._styleMap.get('--notif-text'), '#b8ffd0');
  assert.strictEqual(stageEl._styleMap.get('--notif-shadow'), '0 0 12px rgba(26, 255, 102, 0.25)');
  assert.strictEqual(stageEl._attributes.get('data-notif-corner-style'), 'sharp');
  assert.strictEqual(stageEl._attributes.get('data-notif-header-label'), '// OSD NOTICE');

  // Doorbell & securityAlert state overrides
  notifThemeMgr.dispatchEvent({ type: 'doorbell' });
  assert.strictEqual(stageEl._styleMap.get('--notif-accent'), '#ffd166');
  notifThemeMgr.dispatchEvent({ type: 'securityAlert' });
  assert.strictEqual(stageEl._styleMap.get('--notif-accent'), '#ff3b30');

  // Sleep mode overrides to #993810 on #000000 with zero glow
  notifThemeMgr.dispatchEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  assert.strictEqual(stageEl._attributes.get('data-presence-mode'), 'sleep');
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), '#000000');
  assert.strictEqual(stageEl._styleMap.get('--notif-text'), '#993810');
  assert.strictEqual(stageEl._styleMap.get('--notif-shadow'), 'none');

  // Returning to active restores theme styling
  notifThemeMgr.setPresenceMode('active');
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), '#030a06');
  assert.strictEqual(stageEl._styleMap.get('--notif-text'), '#b8ffd0');

  // Switch to mariana_abyss, pcb_2049_emerald, orrery_3d
  await notifThemeMgr.setTheme('mariana_abyss', { animateTransition: false });
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), 'rgba(6, 22, 30, 0.88)');
  assert.strictEqual(stageEl._styleMap.get('--notif-accent'), '#38f8ff');
  assert.strictEqual(stageEl._attributes.get('data-notif-corner-style'), 'brackets');

  await notifThemeMgr.setTheme('pcb_2049_emerald', { animateTransition: false });
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), 'rgba(9, 30, 21, 0.90)');
  assert.strictEqual(stageEl._styleMap.get('--notif-accent'), '#f4c462');

  await notifThemeMgr.setTheme('orrery_3d', { animateTransition: false });
  assert.strictEqual(stageEl._styleMap.get('--notif-bg'), 'rgba(10, 14, 34, 0.88)');
  assert.strictEqual(stageEl._styleMap.get('--notif-accent'), '#e2be67');

  notifThemeMgr.getActiveTheme()?.destroy();

  console.log('✓ All Theme Architecture & Template tests passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
