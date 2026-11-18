import assert from 'node:assert';
import {
  DISPLAY_OPTIONS_STORAGE_KEY,
  DisplayOptionsStore,
  formatClockDate,
  formatSynchronizedTime,
  loadDisplayOptions,
  sharedDisplayOptions
} from '../src/core/timeFormatter';
import { ThemeManager } from '../src/themes/themeManager';
import { HybridBaseTheme, HYBRID_DIGITAL_CELL_SLOTS } from '../src/themes/hybrid_base';
import { NixieHybridTheme } from '../src/themes/nixie_hybrid';
import { Tourbillon3DTheme, computeCounterweightProgress } from '../src/themes/tourbillon_3d';
import { Reactor3DTheme } from '../src/themes/reactor_3d';
import { Orrery3DTheme, computeOrreryEphemeris } from '../src/themes/orrery_3d';
import { MarianaAbyssTheme } from '../src/themes/mariana_abyss';
import { Pcb2049Theme } from '../src/themes/pcb2049';
import { ClockAudioEngine } from '../src/core/audioEngine';
import { ClockEngine } from '../src/core/clockEngine';
import { ClockWebSocketClient } from '../src/core/wsClient';
import { NotificationManager } from '../src/core/notificationManager';
import { SleepManager } from '../src/core/sleepManager';

// Minimal mock DOM & Canvas environment for Node execution
const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => (storageMap.has(key) ? storageMap.get(key)! : null),
  setItem: (key: string, val: string) => storageMap.set(key, String(val)),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

function createMockCanvasContext(): CanvasRenderingContext2D {
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
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    setLineDash: () => {},
    bezierCurveTo: () => {},
    quadraticCurveTo: () => {},
    ellipse: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    canvas: { width: 1080, height: 1920 }
  } as unknown as CanvasRenderingContext2D;
}

class MockElement {
  private classes = new Set<string>();
  public classList = {
    add: (...cls: string[]) => cls.forEach((c) => this.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => this.classes.delete(c)),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const next = force !== undefined ? force : !this.classes.has(c);
      if (next) this.classes.add(c);
      else this.classes.delete(c);
      return next;
    }
  };
  public style: Record<string, any> = {
    setProperty: () => {},
    getPropertyValue: () => '',
    opacity: '1',
    transition: ''
  };
  public attributes = new Map<string, string>();
  public setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
  public getAttribute(k: string) {
    return this.attributes.get(k) || null;
  }
  public addEventListener() {}
  public removeEventListener() {}
  public prepend() {}
  public removeChild() {}
  public querySelector() {
    return null;
  }
  public querySelectorAll() {
    return [];
  }
}

(globalThis as any).requestAnimationFrame = (fn: Function) => setTimeout(fn, 0);
(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(globalThis as any).Image = class {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public complete = true;
  public naturalWidth = 100;
  public naturalHeight = 100;
  set src(_val: string) {
    if (this.onload) setTimeout(() => this.onload && this.onload(), 0);
  }
};
(globalThis as any).window = {
  setTimeout,
  clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '', protocol: 'http:', host: '127.0.0.1:8088' }
};
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 1080,
        height: 1920,
        style: {},
        getContext: () => createMockCanvasContext()
      };
    }
    return new MockElement();
  },
  body: new MockElement()
};

async function runHybridBaseTests() {
  console.log('--- Starting Hybrid Base (v0.2.0-base) & TimeFormatter Test Suite ---');

  // 1. 24h and 12h Time Formatting (Midnight 00:00, Noon 12:00, Afternoon, Late Night)
  console.log('Test 1: 12h / 24h Formatting & Midnight / Noon Edge Cases');

  // Midnight: 2026-11-12T00:00:00 (Thursday, 12 Nov)
  const midnight = new Date(2026, 10, 12, 0, 0, 0, 0);
  const midnight24 = formatSynchronizedTime(midnight, {
    hourFormat: '24h',
    showSeconds: true,
    showDate: true
  });
  assert.strictEqual(midnight24.hours24, 0);
  assert.strictEqual(midnight24.displayHours, 0);
  assert.deepStrictEqual(midnight24.hourDigits, ['0', '0']);
  assert.strictEqual(midnight24.formattedTime, '00:00:00');
  assert.strictEqual(midnight24.meridiem, 'AM');
  assert.strictEqual(midnight24.showMeridiem, false);
  assert.strictEqual(midnight24.formattedDate, 'THU 12 NOV');

  const midnight12 = formatSynchronizedTime(midnight, {
    hourFormat: '12h',
    showSeconds: true,
    showDate: true
  });
  assert.strictEqual(midnight12.hours24, 0);
  assert.strictEqual(midnight12.displayHours, 12);
  assert.deepStrictEqual(midnight12.hourDigits, ['1', '2']);
  assert.strictEqual(midnight12.formattedTime, '12:00:00');
  assert.strictEqual(midnight12.meridiem, 'AM');
  assert.strictEqual(midnight12.isPm, false);
  assert.strictEqual(midnight12.showMeridiem, true);

  // Noon: 2026-11-12T12:00:00
  const noon = new Date(2026, 10, 12, 12, 0, 0, 0);
  const noon24 = formatSynchronizedTime(noon, {
    hourFormat: '24h',
    showSeconds: true,
    showDate: true
  });
  assert.strictEqual(noon24.hours24, 12);
  assert.strictEqual(noon24.displayHours, 12);
  assert.deepStrictEqual(noon24.hourDigits, ['1', '2']);
  assert.strictEqual(noon24.formattedTime, '12:00:00');
  assert.strictEqual(noon24.isPm, true);
  assert.strictEqual(noon24.showMeridiem, false);

  const noon12 = formatSynchronizedTime(noon, {
    hourFormat: '12h',
    showSeconds: true,
    showDate: true
  });
  assert.strictEqual(noon12.hours24, 12);
  assert.strictEqual(noon12.displayHours, 12);
  assert.deepStrictEqual(noon12.hourDigits, ['1', '2']);
  assert.strictEqual(noon12.formattedTime, '12:00:00');
  assert.strictEqual(noon12.meridiem, 'PM');
  assert.strictEqual(noon12.isPm, true);
  assert.strictEqual(noon12.showMeridiem, true);

  // Afternoon: 13:05:09
  const afternoon = new Date(2026, 10, 12, 13, 5, 9, 0);
  const afternoon24 = formatSynchronizedTime(afternoon, { hourFormat: '24h', showSeconds: true });
  const afternoon12 = formatSynchronizedTime(afternoon, { hourFormat: '12h', showSeconds: true });
  assert.strictEqual(afternoon24.formattedTime, '13:05:09');
  assert.strictEqual(afternoon12.formattedTime, '01:05:09');
  assert.strictEqual(afternoon12.meridiem, 'PM');

  // ShowSeconds = false & ShowDate = false
  const compactTick = formatSynchronizedTime(afternoon, {
    hourFormat: '24h',
    showSeconds: false,
    showDate: false
  });
  assert.strictEqual(compactTick.formattedTime, '13:05');
  assert.strictEqual(compactTick.formattedDate, '');
  assert.strictEqual(compactTick.rawDateText, 'THU 12 NOV');
  assert.strictEqual(compactTick.cells[5].visible, false); // sep2
  assert.strictEqual(compactTick.cells[6].visible, false); // s1
  assert.strictEqual(compactTick.cells[7].visible, false); // s2
  assert.strictEqual(formatClockDate(midnight), 'THU 12 NOV');

  console.log('✓ Test 1 Passed: 12h/24h formatting, midnight/noon edge cases, showSeconds & showDate');

  // 2. Single-Tick Synchronization Between Analog Hand Angles & Digital Character Cells
  console.log('Test 2: Single-Tick Synchronization (Analog Angles <-> Digital Cells) & Sweep/Tick Modes');

  const sampleTime = new Date(2026, 10, 12, 15, 30, 45, 500); // 15:30:45.500
  const syncTick = formatSynchronizedTime(
    sampleTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'tick'
  );

  // Verify discrete 8-cell structure: ['1', '5', ':', '3', '0', ':', '4', '5']
  assert.strictEqual(syncTick.cells.length, 8);
  assert.deepStrictEqual(
    syncTick.cells.map((c) => c.char),
    ['1', '5', ':', '3', '0', ':', '4', '5']
  );

  // Verify analog hand angles match the exact same timestamp tick
  // Second angle in 'tick' mode: 45s * 6 deg = 270 deg (discrete whole-second integer angle)
  assert.strictEqual(syncTick.angles.second, 45 * 6);
  // Minute angle: (30 + 45/60 + 500/60000) * 6 = 184.55 deg
  const expectedMinAngle = (30 + 45 / 60 + 500 / 60000) * 6;
  assert(Math.abs(syncTick.angles.minute - expectedMinAngle) < 1e-9);
  // Hour angle: ((15 % 12) + 30/60 + 45/3600) * 30 = 3.5125 * 30 = 105.375 deg
  const expectedHourAngle = (3 + 30 / 60 + 45 / 3600) * 30;
  assert(Math.abs(syncTick.angles.hour - expectedHourAngle) < 1e-9);

  // Test Sweep Mode vs Tick Mode on fractional second (45.5s)
  const sweepTick = formatSynchronizedTime(
    sampleTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  // Sweep mode must produce continuous fractional second angle: (45 + 500/1000) * 6 = 45.5 * 6 = 273 deg
  const expectedSweepAngle = ((45 + 500 / 1000) / 60) * 360;
  assert.strictEqual(expectedSweepAngle, 273);
  assert.strictEqual(sweepTick.angles.second, expectedSweepAngle);
  // In sweep mode, digital SS cells still cleanly step to whole second digits ('4', '5')
  assert.deepStrictEqual(sweepTick.secondDigits, ['4', '5']);
  assert.deepStrictEqual(
    sweepTick.cells.map((c) => c.char),
    ['1', '5', ':', '3', '0', ':', '4', '5']
  );
  // Distinct from tick angle at mid-second:
  assert.notStrictEqual(sweepTick.angles.second, syncTick.angles.second);
  assert.strictEqual(syncTick.angles.second, 270);
  assert.strictEqual(sweepTick.angles.second, 273);

  // Verify HybridBaseTheme renders in sweep mode and updates live
  const hybridTheme = new HybridBaseTheme();
  const mockCtx = createMockCanvasContext();
  hybridTheme.mount(mockCtx, { width: 1080, height: 1920 });
  hybridTheme.renderDial(mockCtx, {
    date: sampleTime,
    hours: sampleTime.getHours(),
    minutes: sampleTime.getMinutes(),
    seconds: sampleTime.getSeconds(),
    milliseconds: sampleTime.getMilliseconds(),
    angles: sweepTick.angles,
    secondMode: 'sweep',
    timestampMs: sampleTime.getTime(),
    realTimeMs: 1000,
    deltaTimeSec: 0.016,
    displayOptions: sweepTick.options,
    digitalTick: sweepTick
  });
  const renderedSweepTick = hybridTheme.getLastRenderedTick();
  assert(renderedSweepTick !== null);
  assert.strictEqual(renderedSweepTick!.angles.second, 273);

  // Verify live toggle to tick mode
  hybridTheme.renderDial(mockCtx, {
    date: sampleTime,
    hours: sampleTime.getHours(),
    minutes: sampleTime.getMinutes(),
    seconds: sampleTime.getSeconds(),
    milliseconds: sampleTime.getMilliseconds(),
    angles: syncTick.angles,
    secondMode: 'tick',
    timestampMs: sampleTime.getTime(),
    realTimeMs: 1016,
    deltaTimeSec: 0.016,
    displayOptions: syncTick.options,
    digitalTick: syncTick
  });
  const renderedTickMode = hybridTheme.getLastRenderedTick();
  assert(renderedTickMode !== null);
  assert.strictEqual(renderedTickMode!.angles.second, 270);
  assert.strictEqual(renderedTickMode!.angles.second, Number(syncTick.cells[6].char + syncTick.cells[7].char) * 6);
  assert.strictEqual(hybridTheme.getCellSlots().length, 8);
  assert.strictEqual(HYBRID_DIGITAL_CELL_SLOTS.length, 8);

  console.log('✓ Test 2 Passed: Single-tick synchronization between analog hand angles and digital cells');

  // 3. Runtime WebSocket `set_display_options` & localStorage Persistence
  console.log('Test 3: WebSocket `set_display_options` & localStorage Persistence');
  storageMap.clear();
  sharedDisplayOptions.reset();

  const stage = new MockElement() as any;
  const notifZone = new MockElement() as any;
  const audio = new ClockAudioEngine();
  const sleepManager = new SleepManager(stage);
  const notifManager = new NotificationManager(notifZone, null, audio);
  const clockEngine = new ClockEngine(undefined, { sleepManager, audioEngine: audio });
  const wsClient = new ClockWebSocketClient({
    clockEngine,
    notificationManager: notifManager,
    audioEngine: audio,
    sleepManager
  });

  assert.deepStrictEqual(clockEngine.getDisplayOptions(), {
    hourFormat: '24h',
    showSeconds: true,
    showDate: true
  });

  wsClient.processMessage({
    action: 'set_display_options',
    hourFormat: '12h',
    showSeconds: false,
    showDate: false
  });

  assert.deepStrictEqual(clockEngine.getDisplayOptions(), {
    hourFormat: '12h',
    showSeconds: false,
    showDate: false
  });

  // Verify persisted in localStorage
  const rawStored = localStorage.getItem(DISPLAY_OPTIONS_STORAGE_KEY);
  assert(rawStored !== null);
  assert.deepStrictEqual(loadDisplayOptions(), {
    hourFormat: '12h',
    showSeconds: false,
    showDate: false
  });

  // Verify a fresh DisplayOptionsStore restores from localStorage
  const reloadedStore = new DisplayOptionsStore();
  assert.deepStrictEqual(reloadedStore.getOptions(), {
    hourFormat: '12h',
    showSeconds: false,
    showDate: false
  });

  console.log('✓ Test 3 Passed: Runtime WebSocket `set_display_options` and localStorage persistence');

  // 4. ThemeManager Registration & Automatic Backend Broadcast
  console.log('Test 4: ThemeManager Registration & WebSocket Broadcast');
  const mockCanvas = {
    width: 1080,
    height: 1920,
    style: { opacity: '1', transition: '' },
    getContext: () => createMockCanvasContext()
  } as unknown as HTMLCanvasElement;

  const themeManager = new ThemeManager(mockCanvas, stage, notifZone, audio);
  const availableIds = themeManager.getAvailableThemeIds();
  const availableDescriptors = themeManager.getAvailableThemes();

  assert(availableIds.includes('hybrid_base'), 'hybrid_base must be registered in ThemeManager');
  const hybridDescriptor = availableDescriptors.find((d) => d.id === 'hybrid_base');
  assert(hybridDescriptor !== undefined);
  assert.strictEqual(hybridDescriptor!.name, 'Hybrid Analog/Digital');

  // Alias resolution check
  assert.strictEqual(themeManager.resolveThemeId('hybrid_base'), 'hybrid_base');
  assert.strictEqual(themeManager.resolveThemeId('hybrid'), 'hybrid_base');
  assert.strictEqual(themeManager.resolveThemeId('Hybrid Analog/Digital'), 'hybrid_base');

  // Activate hybrid_base and verify audio profile and WS broadcast
  const sentMessages: any[] = [];
  (wsClient as any).isConnected = () => true;
  (wsClient as any).socket = {
    readyState: 1,
    send: (msg: string) => sentMessages.push(JSON.parse(msg))
  };
  wsClient.setThemeManager(themeManager);

  const mountedTheme = await themeManager.setTheme('hybrid_base', { animateTransition: false });
  assert.strictEqual(mountedTheme.id, 'hybrid_base');
  assert.strictEqual(mountedTheme.name, 'Hybrid Analog/Digital');
  assert.strictEqual(audio.getSoundProfile(), 'hybrid_base');

  const regMsg = sentMessages.find((m) => m.type === 'register_themes');
  assert(regMsg !== undefined, 'ThemeManager should trigger register_themes WS broadcast');
  assert(regMsg.themes.includes('hybrid_base'));
  assert.strictEqual(regMsg.activeTheme, 'hybrid_base');

  console.log('✓ Test 4 Passed: ThemeManager registers `hybrid_base` ("Hybrid Analog/Digital") and broadcasts to backend');

  // 5. Nixie Hybrid (`nixie_hybrid`) Theme, Cathode Anti-Poisoning Sweep, IN-13 Bargraph & Audio Profile
  console.log('Test 5: Nixie Hybrid (`nixie_hybrid`) Registration, Cathode Anti-Poisoning & IN-13 Bargraph');
  assert(availableIds.includes('nixie_hybrid'), 'nixie_hybrid must be registered in ThemeManager');
  const nixieDescriptor = availableDescriptors.find((d) => d.id === 'nixie_hybrid');
  assert(nixieDescriptor !== undefined);
  assert.strictEqual(nixieDescriptor!.name, 'Nixie Chronograph');

  assert.strictEqual(themeManager.resolveThemeId('nixie_hybrid'), 'nixie_hybrid');
  assert.strictEqual(themeManager.resolveThemeId('nixie'), 'nixie_hybrid');
  assert.strictEqual(themeManager.resolveThemeId('Nixie Chronograph'), 'nixie_hybrid');

  const mountedNixie = (await themeManager.setTheme('nixie_hybrid', {
    animateTransition: false
  })) as NixieHybridTheme;
  assert.strictEqual(mountedNixie.id, 'nixie_hybrid');
  assert.strictEqual(mountedNixie.name, 'Nixie Chronograph');
  assert.strictEqual(audio.getSoundProfile(), 'nixie_hybrid');

  // Top-of-hour (10:00:00.500 -> 500ms into the 1.8s cathode anti-poisoning sweep)
  const topOfHourSweepTime = new Date(2026, 10, 12, 10, 0, 0, 500);
  const hourSweepTick = formatSynchronizedTime(
    topOfHourSweepTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'tick'
  );
  mountedNixie.renderDial(mockCtx, {
    date: topOfHourSweepTime,
    hours: 10,
    minutes: 0,
    seconds: 0,
    milliseconds: 500,
    angles: hourSweepTick.angles,
    secondMode: 'tick',
    timestampMs: topOfHourSweepTime.getTime(),
    realTimeMs: 500,
    deltaTimeSec: 0.016,
    displayOptions: hourSweepTick.options,
    digitalTick: hourSweepTick
  });
  assert.strictEqual(mountedNixie.isAntiPoisoningActive(), true);
  assert.strictEqual(mountedNixie.getActiveTubeDigits().length, 6);

  // After 1.8s (10:00:02.000 -> settles on 10:00:02)
  const settledTime = new Date(2026, 10, 12, 10, 0, 2, 0);
  const settledTick = formatSynchronizedTime(
    settledTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'tick'
  );
  mountedNixie.renderDial(mockCtx, {
    date: settledTime,
    hours: 10,
    minutes: 0,
    seconds: 2,
    milliseconds: 0,
    angles: settledTick.angles,
    secondMode: 'tick',
    timestampMs: settledTime.getTime(),
    realTimeMs: 2000,
    deltaTimeSec: 0.016,
    displayOptions: settledTick.options,
    digitalTick: settledTick
  });
  assert.strictEqual(mountedNixie.isAntiPoisoningActive(), false);
  assert.deepStrictEqual(mountedNixie.getActiveTubeDigits(), ['1', '0', '0', '0', '0', '2']);

  // IN-13 Bargraph Pendulum velocity response & sleep parking
  mountedNixie.renderPendulum(mockCtx, {
    angleDeg: 3,
    angleRad: 0.052,
    angularVelocityNorm: 0.1,
    angularVelocityRad: 0.02,
    phase: 0.1,
    phaseRad: 0.62,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 1136 },
    timeSec: 10
  });
  const lowVelRatio = mountedNixie.getBargraphFillRatio();

  mountedNixie.renderPendulum(mockCtx, {
    angleDeg: 0,
    angleRad: 0,
    angularVelocityNorm: 0.95,
    angularVelocityRad: 0.3,
    phase: 0.25,
    phaseRad: 1.57,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 1136 },
    timeSec: 10.5
  });
  const highVelRatio = mountedNixie.getBargraphFillRatio();
  assert(highVelRatio > lowVelRatio, 'IN-13 bargraph column should rise with pendulum velocity');

  // Sleep mode parks pendulum and zeroes IN-13 column
  mountedNixie.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  mountedNixie.renderPendulum(mockCtx, {
    angleDeg: 0,
    angleRad: 0,
    angularVelocityNorm: 0,
    angularVelocityRad: 0,
    phase: 0,
    phaseRad: 0,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 0.0,
    dimmed: false,
    pivot: { x: 540, y: 1136 },
    timeSec: 0
  });
  assert.strictEqual(mountedNixie.getBargraphFillRatio(), 0);

  console.log('✓ Test 5 Passed: Nixie Hybrid IN-18 matrix, 1.8s cathode anti-poisoning sweep, IN-13 bargraph & audio profile');

  // 6. Tourbillon 3D (`tourbillon_3d`), ThreeStage Disposal, Multi-Plane Gears, Counterweights & Modes
  console.log('Test 6: Horological Tourbillon 3D (`tourbillon_3d`), ThreeStage & Mechanical Architecture');
  assert(availableIds.includes('tourbillon_3d'), 'tourbillon_3d must be registered in ThemeManager');
  const tourbillonDescriptor = availableDescriptors.find((d) => d.id === 'tourbillon_3d');
  assert(tourbillonDescriptor !== undefined);
  assert.strictEqual(tourbillonDescriptor!.name, 'Horological Tourbillon 3D');

  assert.strictEqual(themeManager.resolveThemeId('tourbillon_3d'), 'tourbillon_3d');
  assert.strictEqual(themeManager.resolveThemeId('tourbillon'), 'tourbillon_3d');
  assert.strictEqual(themeManager.resolveThemeId('Horological Tourbillon 3D'), 'tourbillon_3d');

  const mountedTourbillon = (await themeManager.setTheme('tourbillon_3d', {
    animateTransition: false
  })) as Tourbillon3DTheme;
  assert.strictEqual(mountedTourbillon.id, 'tourbillon_3d');
  assert.strictEqual(mountedTourbillon.name, 'Horological Tourbillon 3D');
  assert.strictEqual(audio.getSoundProfile(), 'tourbillon_3d');

  const threeStage = mountedTourbillon.getThreeStage();
  assert(threeStage !== null, 'ThreeStage must be initialized on mount');
  assert.strictEqual(threeStage!.width, 1080);
  assert.strictEqual(threeStage!.height, 1920);
  assert.strictEqual(threeStage!.fov, 30);

  const activeStats = threeStage!.getResourceStats();
  assert(activeStats.geometries > 15, 'ThreeStage must track scene geometries');
  assert(activeStats.materials > 8, 'ThreeStage must track scene materials');
  assert(
    activeStats.textures >= 4,
    'ThreeStage must track walnut diffuse/normal/roughness & PMREM studio textures'
  );
  assert.strictEqual(activeStats.disposed, false);

  // Render frame in active mode and check multi-plane gears, 2.5 Hz tourbillon, and lyre pendulum
  const midWeekTime = new Date(2026, 10, 11, 14, 25, 30, 100); // Wednesday afternoon
  const midWeekTick = formatSynchronizedTime(
    midWeekTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  mountedTourbillon.renderPendulum(mockCtx, {
    angleDeg: 5.0,
    angleRad: (5.0 * Math.PI) / 180,
    angularVelocityNorm: 0.5,
    angularVelocityRad: 0.1,
    phase: 0.1,
    phaseRad: 0.62,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 860 },
    timeSec: 25.1
  });
  mountedTourbillon.renderDial(mockCtx, {
    date: midWeekTime,
    hours: 14,
    minutes: 25,
    seconds: 30,
    milliseconds: 100,
    angles: midWeekTick.angles,
    secondMode: 'sweep',
    timestampMs: midWeekTime.getTime(),
    realTimeMs: 3000,
    deltaTimeSec: 0.1,
    displayOptions: midWeekTick.options,
    digitalTick: midWeekTick
  });

  const debugActive = mountedTourbillon.getDebugState();
  // Verify 4 distinct Z-planes for the beveled gear train
  assert.strictEqual(debugActive.gearPlaneZ.length, 4);
  assert.notStrictEqual(debugActive.gearPlaneZ[0], debugActive.gearPlaneZ[1]);
  assert.notStrictEqual(debugActive.gearPlaneZ[1], debugActive.gearPlaneZ[2]);
  assert.notStrictEqual(debugActive.gearPlaneZ[2], debugActive.gearPlaneZ[3]);
  // Verify tilted inner tourbillon gimbal axes (20 deg - 35 deg)
  assert(debugActive.tourbillonTiltDeg[0] >= 20 && debugActive.tourbillonTiltDeg[0] <= 35);
  assert(debugActive.tourbillonTiltDeg[1] >= 20 && debugActive.tourbillonTiltDeg[1] <= 35);
  // Verify breathing camera parallax sway & bloom threshold (1.45)
  assert(Math.abs(debugActive.cameraPosition[0]) > 0.01 || Math.abs(debugActive.cameraPosition[1]) > 0.01);
  assert.strictEqual(debugActive.bloomThreshold, 1.45);
  assert(debugActive.rubyEmissiveIntensity >= 2.5, 'Ruby bearings should glow with emissiveIntensity >= 2.5');
  assert(debugActive.spotlightIntensity > 50, 'Active mode spotlight should be bright');
  assert(Math.abs(debugActive.pendulumAngleRad) > 0.05, 'Lyre pendulum should swing in active mode');

  // Counterweights: Saturday night is near bottom (~1.0), Sunday 00:00:30 is mid-rewind (~0.5), Sunday 00:01:00 is rewound (0.0)
  const satNight = new Date(2026, 10, 14, 23, 55, 0, 0); // Saturday 23:55
  const sunMidnightStart = new Date(2026, 10, 15, 0, 0, 0, 0); // Sunday 00:00:00
  const sunMidnightMid = new Date(2026, 10, 15, 0, 0, 30, 0); // Sunday 00:00:30
  const sunMidnightDone = new Date(2026, 10, 15, 0, 1, 0, 0); // Sunday 00:01:00
  assert(computeCounterweightProgress(satNight) > 0.99);
  assert(Math.abs(computeCounterweightProgress(sunMidnightStart) - 1.0) < 1e-6);
  assert(Math.abs(computeCounterweightProgress(sunMidnightMid) - 0.5) < 1e-6);
  assert(Math.abs(computeCounterweightProgress(sunMidnightDone) - 0.0) < 1e-6);

  // Night mode dims spotlight and index glow
  mountedTourbillon.onEvent({ type: 'mode_change', payload: { mode: 'night' } });
  const debugNight = mountedTourbillon.getDebugState();
  assert(debugNight.spotlightIntensity < debugActive.spotlightIntensity * 0.4);
  assert(debugNight.indexEmissiveIntensity < debugActive.indexEmissiveIntensity);

  // Sleep mode smoothly brakes tourbillon cage and pendulum to rest
  mountedTourbillon.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  mountedTourbillon.renderPendulum(mockCtx, {
    angleDeg: 0,
    angleRad: 0,
    angularVelocityNorm: 0,
    angularVelocityRad: 0,
    phase: 0,
    phaseRad: 0,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 0.0,
    dimmed: false,
    pivot: { x: 540, y: 860 },
    timeSec: 0
  });
  const debugSleep = mountedTourbillon.getDebugState();
  assert.strictEqual(debugSleep.brakeFactor, 0);
  assert.strictEqual(debugSleep.pendulumAngleRad, 0);

  // Switching away from tourbillon_3d disposes all geometries, materials, textures, and render targets
  await themeManager.setTheme('pcb_2049', { animateTransition: false });
  const disposedStats = threeStage!.getResourceStats();
  assert.strictEqual(disposedStats.disposed, true);
  assert.strictEqual(disposedStats.geometries, 0);
  assert.strictEqual(disposedStats.materials, 0);
  assert.strictEqual(disposedStats.textures, 0);
  assert.strictEqual(disposedStats.renderTargets, 0);

  console.log('✓ Test 6 Passed: Tourbillon 3D, ThreeStage disposal, multi-plane gears, counterweights & modes');

  // 7. Chrono-Containment Reactor (`reactor_3d`), Three-Zone Architecture, BDC Arc Flash, Modes & Disposal
  console.log('Test 7: Chrono-Containment Reactor (`reactor_3d`), ThreeStage, Modes & Magnetic Shutdown');
  assert(availableIds.includes('reactor_3d'), 'reactor_3d must be registered in ThemeManager');
  const reactorDescriptor = availableDescriptors.find((d) => d.id === 'reactor_3d');
  assert(reactorDescriptor !== undefined);
  assert.strictEqual(reactorDescriptor!.name, 'Chrono-Containment Reactor');

  assert.strictEqual(themeManager.resolveThemeId('reactor_3d'), 'reactor_3d');
  assert.strictEqual(themeManager.resolveThemeId('reactor'), 'reactor_3d');
  assert.strictEqual(themeManager.resolveThemeId('Chrono-Containment Reactor'), 'reactor_3d');

  const mountedReactor = (await themeManager.setTheme('reactor_3d', {
    animateTransition: false
  })) as Reactor3DTheme;
  assert.strictEqual(mountedReactor.id, 'reactor_3d');
  assert.strictEqual(mountedReactor.name, 'Chrono-Containment Reactor');
  assert.strictEqual(audio.getSoundProfile(), 'reactor_3d');

  const reactorStage = mountedReactor.getThreeStage();
  assert(reactorStage !== null, 'ThreeStage must be initialized for reactor_3d');
  assert.strictEqual(reactorStage!.width, 1080);
  assert.strictEqual(reactorStage!.height, 1920);
  assert.strictEqual(reactorStage!.fov, 30);

  const reactorStats = reactorStage!.getResourceStats();
  assert(reactorStats.geometries > 20, 'Reactor3D must track scene geometries');
  assert(reactorStats.materials > 8, 'Reactor3D must track scene materials');
  assert(reactorStats.textures >= 4, 'Reactor3D must track titanium bulkhead & PMREM textures');
  assert.strictEqual(reactorStats.disposed, false);

  const rTime1 = new Date(2026, 10, 13, 8, 15, 10, 100);
  const rTick1 = formatSynchronizedTime(
    rTime1,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  // Pendulum swinging through negative -> zero crossing (bottom dead center) triggers cyan arc flash
  mountedReactor.renderPendulum(mockCtx, {
    angleDeg: -2.5,
    angleRad: (-2.5 * Math.PI) / 180,
    angularVelocityNorm: 0.7,
    angularVelocityRad: 0.2,
    phase: 0.2,
    phaseRad: 1.25,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 860 },
    timeSec: 10.1
  });
  mountedReactor.renderDial(mockCtx, {
    date: rTime1,
    hours: 8,
    minutes: 15,
    seconds: 10,
    milliseconds: 100,
    angles: rTick1.angles,
    secondMode: 'sweep',
    timestampMs: rTime1.getTime(),
    realTimeMs: 1000,
    deltaTimeSec: 0.1,
    displayOptions: rTick1.options,
    digitalTick: rTick1
  });

  const rTime2 = new Date(2026, 10, 13, 8, 15, 11, 200);
  const rTick2 = formatSynchronizedTime(
    rTime2,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  mountedReactor.renderPendulum(mockCtx, {
    angleDeg: 0.2,
    angleRad: (0.2 * Math.PI) / 180,
    angularVelocityNorm: 0.98,
    angularVelocityRad: 0.3,
    phase: 0.25,
    phaseRad: 1.57,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 860 },
    timeSec: 11.2
  });
  mountedReactor.renderDial(mockCtx, {
    date: rTime2,
    hours: 8,
    minutes: 15,
    seconds: 11,
    milliseconds: 200,
    angles: rTick2.angles,
    secondMode: 'sweep',
    timestampMs: rTime2.getTime(),
    realTimeMs: 1100,
    deltaTimeSec: 0.05,
    displayOptions: rTick2.options,
    digitalTick: rTick2
  });

  const reactorActive = mountedReactor.getDebugState();
  assert.strictEqual(reactorActive.bloomThreshold, 1.45);
  // Structural metals must remain non-emissive below bloom threshold while core/coolant/indices exceed 1.45
  assert.strictEqual(reactorActive.titaniumEmissiveIntensity, 0);
  assert.strictEqual(reactorActive.copperEmissiveIntensity, 0);
  assert(
    reactorActive.coreEmissiveIntensity >= 1.5 && reactorActive.coreEmissiveIntensity <= 2.2,
    'Plasma core must stay above 1.45 bloom threshold without over-clipping (~2.0)'
  );
  assert(reactorActive.indexEmissiveIntensity > 1.45, 'Hour indices must exceed bloom threshold in active mode');
  assert(reactorActive.coolantEmissiveIntensity > 1.45, 'Coolant core must exceed bloom threshold in active mode');
  assert(reactorActive.secondHandEmissiveIntensity > 1.45, 'Second hand must exceed bloom threshold in active mode');
  // Counter-rotating gimbal rings & tilted axes
  assert(reactorActive.gimbalAnglesRad[0] < 0, 'Outer gimbal rotates negatively on Z');
  assert(reactorActive.gimbalAnglesRad[1] > 0, 'Mid gimbal counter-rotates positively on X');
  assert(reactorActive.gimbalAnglesRad[2] < 0, 'Inner gimbal counter-rotates negatively on Y');
  assert(reactorActive.gimbalTiltDeg[0] >= 20 && reactorActive.gimbalTiltDeg[0] <= 35);
  assert(Math.abs(reactorActive.gimbalTiltDeg[1]) >= 20 && Math.abs(reactorActive.gimbalTiltDeg[1]) <= 35);
  // Servo escapement arm pulsed on second change (10 -> 11) + wrist status LED + grazing rim light
  assert.strictEqual(reactorActive.servoLastSecond, 11);
  assert(Math.abs(reactorActive.servoPulseAngleRad) > 0.01, 'Servo arm should pulse on 1s index');
  assert(reactorActive.servoArmRimLightIntensity > 20, 'Bulkhead & 4 oclock servo rim light should be active');
  assert(reactorActive.servoWristLedIntensity > 1.45, 'Servo wrist status LED should pulse above bloom threshold on 1 Hz tick');
  // BDC cyan dynamic air-gap plasma arc triggered within +/-4 deg & under-bob point light pulse
  assert(reactorActive.arcFlashIntensity > 0.7, 'BDC +/-4 deg window should trigger dynamic plasma arc');
  assert(
    reactorActive.arcLightPosition[1] < -6.5,
    'Under-bob point light must be positioned at the central tungsten electrode tip'
  );
  assert(
    reactorActive.arcLightIntensity > 20,
    'Under-bob point light must pulse brightly in sync with plasma arc discharge'
  );
  assert(reactorActive.coreColorHex === '#00e5ff', `Active core should be Cherenkov cyan, got ${reactorActive.coreColorHex}`);

  // Night mode: smooth transition to deep standby crimson (#ff1e38)
  mountedReactor.onEvent({ type: 'mode_change', payload: { mode: 'night' } });
  for (let step = 0; step < 30; step++) {
    mountedReactor.renderDial(mockCtx, {
      date: rTime2,
      hours: 8,
      minutes: 15,
      seconds: 11,
      milliseconds: 200 + step * 50,
      angles: rTick2.angles,
      secondMode: 'sweep',
      timestampMs: rTime2.getTime() + step * 50,
      realTimeMs: 1200 + step * 50,
      deltaTimeSec: 0.1,
      displayOptions: rTick2.options,
      digitalTick: rTick2
    });
  }
  const reactorNight = mountedReactor.getDebugState();
  assert.strictEqual(reactorNight.mode, 'night');
  assert(reactorNight.coreEmissiveIntensity < reactorActive.coreEmissiveIntensity);
  assert(reactorNight.indexEmissiveIntensity < reactorActive.indexEmissiveIntensity);
  assert(reactorNight.coreColorHex === '#ff1e38' || reactorNight.coreColorHex.startsWith('#ff'), `Night core should transition to standby crimson, got ${reactorNight.coreColorHex}`);

  // Sleep mode: full magnetic shutdown -> gimbals lock to 0, pendulum damps to 0, core dims
  mountedReactor.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  for (let step = 0; step < 30; step++) {
    mountedReactor.renderPendulum(mockCtx, {
      angleDeg: 0,
      angleRad: 0,
      angularVelocityNorm: 0,
      angularVelocityRad: 0,
      phase: 0,
      phaseRad: 0,
      periodSeconds: 2.0,
      maxAngleDeg: 6.0,
      dampingFactor: 0.0,
      dimmed: false,
      pivot: { x: 540, y: 860 },
      timeSec: 0
    });
    mountedReactor.renderDial(mockCtx, {
      date: rTime2,
      hours: 8,
      minutes: 15,
      seconds: 11,
      milliseconds: 200,
      angles: rTick2.angles,
      secondMode: 'sweep',
      timestampMs: rTime2.getTime(),
      realTimeMs: 3000 + step * 1000,
      deltaTimeSec: 0.15,
      displayOptions: rTick2.options,
      digitalTick: rTick2
    });
  }
  const reactorSleep = mountedReactor.getDebugState();
  assert.strictEqual(reactorSleep.brakeFactor, 0);
  assert.strictEqual(reactorSleep.pendulumAngleRad, 0);
  assert.strictEqual(reactorSleep.gimbalAnglesRad[0], 0);
  assert.strictEqual(reactorSleep.gimbalAnglesRad[1], 0);
  assert.strictEqual(reactorSleep.gimbalAnglesRad[2], 0);
  assert(reactorSleep.coreEmissiveIntensity <= 0.08);
  assert.strictEqual(reactorSleep.arcFlashIntensity, 0);

  // Switching away from reactor_3d disposes all geometries, materials, textures, and render targets
  await themeManager.setTheme('pcb_2049', { animateTransition: false });
  const reactorDisposed = reactorStage!.getResourceStats();
  assert.strictEqual(reactorDisposed.disposed, true);
  assert.strictEqual(reactorDisposed.geometries, 0);
  assert.strictEqual(reactorDisposed.materials, 0);
  assert.strictEqual(reactorDisposed.textures, 0);
  assert.strictEqual(reactorDisposed.renderTargets, 0);

  console.log('✓ Test 7 Passed: Chrono-Containment Reactor 3D, ThreeStage disposal, BDC arc flash & modes');

  // 8. Celestial Astrolabe & Orrery (`orrery_3d`), Offline Ephemeris, Solar Terminator, Eclipse Sleep & Disposal
  console.log('Test 8: Celestial Astrolabe & Orrery (`orrery_3d`), Ephemeris, Modes & Disposal');
  assert(availableIds.includes('orrery_3d'), 'orrery_3d must be registered in ThemeManager');
  const orreryDescriptor = availableDescriptors.find((d) => d.id === 'orrery_3d');
  assert(orreryDescriptor !== undefined);
  assert.strictEqual(orreryDescriptor!.name, 'Celestial Astrolabe & Orrery');

  assert.strictEqual(themeManager.resolveThemeId('orrery_3d'), 'orrery_3d');
  assert.strictEqual(themeManager.resolveThemeId('orrery'), 'orrery_3d');
  assert.strictEqual(themeManager.resolveThemeId('Celestial Astrolabe & Orrery'), 'orrery_3d');

  // Verify offline ephemeris calculation via astronomy-engine across distinct dates
  const ephemA = computeOrreryEphemeris(new Date('2026-11-13T10:15:00Z'));
  const ephemB = computeOrreryEphemeris(new Date('2026-12-13T10:15:00Z'));
  assert(ephemA.mercuryLonDeg >= 0 && ephemA.mercuryLonDeg < 360);
  assert(ephemA.venusLonDeg >= 0 && ephemA.venusLonDeg < 360);
  assert(ephemA.earthLonDeg >= 0 && ephemA.earthLonDeg < 360);
  assert(ephemA.marsLonDeg >= 0 && ephemA.marsLonDeg < 360);
  assert(ephemA.jupiterLonDeg >= 0 && ephemA.jupiterLonDeg < 360);
  assert(ephemA.lunarPhaseDeg >= 0 && ephemA.lunarPhaseDeg < 360);
  assert(ephemA.siderealHours >= 0 && ephemA.siderealHours < 24);
  assert(
    Math.abs(ephemB.mercuryLonDeg - ephemA.mercuryLonDeg) > 1.0,
    'Planetary ephemeris longitudes must advance offline across dates'
  );
  assert(
    Math.abs(ephemB.earthLonDeg - ephemA.earthLonDeg) > 20.0,
    'Earth heliocentric longitude must advance ~30 deg across 1 month'
  );

  const mountedOrrery = (await themeManager.setTheme('orrery_3d', {
    animateTransition: false
  })) as Orrery3DTheme;
  assert.strictEqual(mountedOrrery.id, 'orrery_3d');
  assert.strictEqual(mountedOrrery.name, 'Celestial Astrolabe & Orrery');
  assert.strictEqual(audio.getSoundProfile(), 'orrery_3d');

  const orreryStage = mountedOrrery.getThreeStage();
  assert(orreryStage !== null, 'ThreeStage must be initialized for orrery_3d');
  assert.strictEqual(orreryStage!.width, 1080);
  assert.strictEqual(orreryStage!.height, 1920);
  assert.strictEqual(orreryStage!.fov, 30);

  const orreryStats = orreryStage!.getResourceStats();
  assert(orreryStats.geometries > 20, 'Orrery3D must track scene geometries');
  assert(orreryStats.materials > 10, 'Orrery3D must track scene materials');
  assert(orreryStats.textures >= 7, 'Orrery3D must track walnut, Earth, Moon, Jupiter & PMREM textures');
  assert.strictEqual(orreryStats.disposed, false);

  const oTime = new Date('2026-11-13T10:15:30.250Z');
  const oTick = formatSynchronizedTime(
    oTime,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  mountedOrrery.renderPendulum(mockCtx, {
    angleDeg: 4.5,
    angleRad: (4.5 * Math.PI) / 180,
    angularVelocityNorm: 0.6,
    angularVelocityRad: 0.15,
    phase: 0.15,
    phaseRad: 0.94,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 860 },
    timeSec: 30.25
  });
  mountedOrrery.renderDial(mockCtx, {
    date: oTime,
    hours: oTick.hours24,
    minutes: oTick.minutes,
    seconds: oTick.seconds,
    milliseconds: oTick.milliseconds,
    angles: oTick.angles,
    secondMode: 'sweep',
    timestampMs: oTime.getTime(),
    realTimeMs: 2000,
    deltaTimeSec: 0.1,
    displayOptions: oTick.options,
    digitalTick: oTick
  });

  const orreryActive = mountedOrrery.getDebugState();
  assert.strictEqual(orreryActive.bloomThreshold, 1.45);
  assert.strictEqual(orreryActive.brassEmissiveIntensity, 0);
  assert.strictEqual(orreryActive.obsidianEmissiveIntensity, 0);
  assert(orreryActive.solarEmissiveIntensity > 1.45, 'Solar corona must exceed bloom threshold in active mode');
  assert(orreryActive.indexEmissiveIntensity > 1.45, 'Backlit zodiac indices must exceed bloom threshold');
  assert(orreryActive.lunarEmissiveIntensity > 1.45, 'Sunlit lunar hemisphere must exceed bloom threshold');
  assert(orreryActive.solarLightIntensity > 20, 'Central solar PointLight must illuminate planetary terminators');
  assert(Math.abs(orreryActive.pendulumAngleRad) > 0.04, 'Armillary pendulum should swing in active mode');

  // Night mode: smooth red-shift transition
  mountedOrrery.onEvent({ type: 'mode_change', payload: { mode: 'night' } });
  for (let step = 0; step < 25; step++) {
    mountedOrrery.renderDial(mockCtx, {
      date: oTime,
      hours: oTick.hours24,
      minutes: oTick.minutes,
      seconds: oTick.seconds,
      milliseconds: oTick.milliseconds,
      angles: oTick.angles,
      secondMode: 'sweep',
      timestampMs: oTime.getTime() + step * 50,
      realTimeMs: 2200 + step * 50,
      deltaTimeSec: 0.1,
      displayOptions: oTick.options,
      digitalTick: oTick
    });
  }
  const orreryNight = mountedOrrery.getDebugState();
  assert.strictEqual(orreryNight.mode, 'night');
  assert(orreryNight.solarEmissiveIntensity < orreryActive.solarEmissiveIntensity);
  assert(orreryNight.indexEmissiveIntensity < orreryActive.indexEmissiveIntensity);
  assert(
    orreryNight.solarColorHex.startsWith('#ff'),
    `Night solar glow should red-shift, got ${orreryNight.solarColorHex}`
  );

  // Sleep mode: eclipse corona ring + pendulum smoothly damps to 0
  mountedOrrery.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  for (let step = 0; step < 30; step++) {
    mountedOrrery.renderPendulum(mockCtx, {
      angleDeg: 0,
      angleRad: 0,
      angularVelocityNorm: 0,
      angularVelocityRad: 0,
      phase: 0,
      phaseRad: 0,
      periodSeconds: 2.0,
      maxAngleDeg: 6.0,
      dampingFactor: 0.0,
      dimmed: false,
      pivot: { x: 540, y: 860 },
      timeSec: 0
    });
    mountedOrrery.renderDial(mockCtx, {
      date: oTime,
      hours: oTick.hours24,
      minutes: oTick.minutes,
      seconds: oTick.seconds,
      milliseconds: oTick.milliseconds,
      angles: oTick.angles,
      secondMode: 'sweep',
      timestampMs: oTime.getTime(),
      realTimeMs: 4000 + step * 1000,
      deltaTimeSec: 0.15,
      displayOptions: oTick.options,
      digitalTick: oTick
    });
  }
  const orrerySleep = mountedOrrery.getDebugState();
  assert.strictEqual(orrerySleep.brakeFactor, 0);
  assert.strictEqual(orrerySleep.pendulumAngleRad, 0);
  assert(orrerySleep.eclipseFactor > 0.9, 'Sleep mode must activate solar eclipse factor (~1.0)');
  assert(orrerySleep.solarEmissiveIntensity <= 0.2);

  // Switching away from orrery_3d cleanly disposes all GPU resources
  await themeManager.setTheme('pcb_2049', { animateTransition: false });
  const orreryDisposed = orreryStage!.getResourceStats();
  assert.strictEqual(orreryDisposed.disposed, true);
  assert.strictEqual(orreryDisposed.geometries, 0);
  assert.strictEqual(orreryDisposed.materials, 0);
  assert.strictEqual(orreryDisposed.textures, 0);
  assert.strictEqual(orreryDisposed.renderTargets, 0);

  console.log('✓ Test 8 Passed: Celestial Astrolabe & Orrery 3D, Ephemeris, Eclipse Sleep & Disposal');

  // 9. Mariana Abyss (`mariana_abyss`): 3-Zone 3D Bathysphere, Gear Train, Pressure Tubes, Aquarium & Cat Sleep
  console.log('Test 9: Mariana Abyss (`mariana_abyss`), 3-Zone Kinematics, Sleep & Disposal');
  assert(availableIds.includes('mariana_abyss'), 'mariana_abyss must be registered in ThemeManager');
  const marianaDescriptor = availableDescriptors.find((d) => d.id === 'mariana_abyss');
  assert(marianaDescriptor !== undefined);
  assert.strictEqual(marianaDescriptor!.name, 'Mariana Abyss');

  assert.strictEqual(themeManager.resolveThemeId('mariana_abyss'), 'mariana_abyss');
  assert.strictEqual(themeManager.resolveThemeId('mariana'), 'mariana_abyss');
  assert.strictEqual(themeManager.resolveThemeId('abyss'), 'mariana_abyss');
  assert.strictEqual(themeManager.resolveThemeId('Mariana Abyss'), 'mariana_abyss');

  const mountedMariana = (await themeManager.setTheme('mariana_abyss', {
    animateTransition: false
  })) as MarianaAbyssTheme;
  assert.strictEqual(mountedMariana.id, 'mariana_abyss');
  assert.strictEqual(mountedMariana.name, 'Mariana Abyss');
  assert.strictEqual(audio.getSoundProfile(), 'mariana_abyss');

  const marianaStage = mountedMariana.getThreeStage();
  assert(marianaStage !== null, 'ThreeStage must be initialized for mariana_abyss');
  assert.strictEqual(marianaStage!.width, 1080);
  assert.strictEqual(marianaStage!.height, 1920);
  const marianaStats = mountedMariana.getResourceStats();
  assert(marianaStats !== null && marianaStats.geometries > 20);
  assert(marianaStats!.materials > 10);

  const mTime1 = new Date('2026-11-17T11:25:15.000');
  const mTick1 = formatSynchronizedTime(mTime1, {
    hourFormat: '24h',
    showSeconds: true,
    showDate: true
  });
  mountedMariana.renderPendulum(mockCtx, {
    angleDeg: 5.0,
    angleRad: (5.0 * Math.PI) / 180,
    angularVelocityNorm: 0.5,
    angularVelocityRad: 0.25,
    phase: 0.2,
    phaseRad: 1.25,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 1136 },
    timeSec: 15.0
  });
  mountedMariana.renderDial(mockCtx, {
    date: mTime1,
    hours: mTick1.hours24,
    minutes: mTick1.minutes,
    seconds: mTick1.seconds,
    milliseconds: mTick1.milliseconds,
    angles: mTick1.angles,
    secondMode: 'sweep',
    timestampMs: mTime1.getTime(),
    realTimeMs: 1000,
    deltaTimeSec: 0.05,
    displayOptions: mTick1.options,
    digitalTick: mTick1
  });
  // Second render after 120ms so 100ms crossfade completes
  const mTime2 = new Date('2026-11-17T11:25:30.000');
  const mTick2 = formatSynchronizedTime(mTime2, {
    hourFormat: '24h',
    showSeconds: true,
    showDate: true
  });
  mountedMariana.renderDial(mockCtx, {
    date: mTime2,
    hours: mTick2.hours24,
    minutes: mTick2.minutes,
    seconds: mTick2.seconds,
    milliseconds: mTick2.milliseconds,
    angles: mTick2.angles,
    secondMode: 'sweep',
    timestampMs: mTime2.getTime(),
    realTimeMs: 1200,
    deltaTimeSec: 0.05,
    displayOptions: mTick2.options,
    digitalTick: mTick2
  });

  const mActive = mountedMariana.getDebugState();
  assert.strictEqual(mActive.chassisVisible, true);
  assert.strictEqual(mActive.portholeVisible, true);
  assert.strictEqual(mActive.aquariumVisible, true);
  assert(mActive.keyLightIntensity > 1.0);
  assert(mActive.tubeLightIntensity > 0.5 && mActive.tubeLightIntensity <= 1.6);
  assert.deepStrictEqual(mActive.activeDigits, ['1', '1', '2', '5', '3', '0']);
  assert(mActive.activeFilamentEmissive > 1.0 && mActive.activeFilamentEmissive <= 1.55);
  assert(Math.abs(mActive.bargraphFillRatio - 0.5) < 0.05);
  assert(Math.abs(mActive.gearAnglesRad[0] - (-Math.PI)) < 0.02);
  assert(Math.abs(mActive.gearAnglesRad[2] - (-Math.PI * 2)) < 0.02);
  assert(mActive.sonarSweepRad !== 0);

  // Sleep (Cat Mode): extinguishes all lights, hides chassis/glass/water/creatures,
  // leaves ONLY active 3D numeral cathode filaments dimly glowing at ~12-15%
  mountedMariana.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  mountedMariana.renderPendulum(mockCtx, {
    angleDeg: 0,
    angleRad: 0,
    angularVelocityNorm: 0,
    angularVelocityRad: 0,
    phase: 0,
    phaseRad: 0,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 0,
    dimmed: false,
    pivot: { x: 540, y: 1136 },
    timeSec: 0
  });
  mountedMariana.renderDial(mockCtx, {
    date: mTime2,
    hours: mTick2.hours24,
    minutes: mTick2.minutes,
    seconds: mTick2.seconds,
    milliseconds: mTick2.milliseconds,
    angles: mTick2.angles,
    secondMode: 'sweep',
    timestampMs: mTime2.getTime(),
    realTimeMs: 2500,
    deltaTimeSec: 0.05,
    displayOptions: mTick2.options,
    digitalTick: mTick2
  });

  const mSleep = mountedMariana.getDebugState();
  assert.strictEqual(mSleep.isSleepActive, true);
  assert.strictEqual(mSleep.chassisVisible, false);
  assert.strictEqual(mSleep.portholeVisible, false);
  assert.strictEqual(mSleep.aquariumVisible, false);
  assert.strictEqual(mSleep.keyLightIntensity, 0);
  assert.strictEqual(mSleep.tubeLightIntensity, 0);
  assert(
    mSleep.activeFilamentEmissive >= 0.12 && mSleep.activeFilamentEmissive <= 0.15,
    `Sleep filament emissive (${mSleep.activeFilamentEmissive}) must be in ~12-15% range`
  );

  // Switching away from mariana_abyss cleanly disposes all GPU resources
  await themeManager.setTheme('pcb_2049', { animateTransition: false });
  const marianaDisposed = marianaStage!.getResourceStats();
  assert.strictEqual(marianaDisposed.disposed, true);
  assert.strictEqual(marianaDisposed.geometries, 0);
  assert.strictEqual(marianaDisposed.materials, 0);
  assert.strictEqual(marianaDisposed.textures, 0);
  assert.strictEqual(marianaDisposed.renderTargets, 0);

  console.log('✓ Test 9 Passed: Mariana Abyss 3D, Gear Train, Pressure Tubes, Aquarium, Cat Sleep & Disposal');

  // 10. PCB-2049 3D Three.js Scene (`pcb_2049`), Emerald LPI Stackup, Kapton Flex, Wafer Shader, Cat Sleep & Disposal
  console.log('Test 10: PCB-2049 3D Three.js Scene (`pcb_2049`), Emerald Stackup, Kapton Flex, Cat Sleep & Disposal');
  const mountedPcb = (await themeManager.setTheme('pcb_2049', {
    animateTransition: false
  })) as Pcb2049Theme;
  assert.strictEqual(mountedPcb.id, 'pcb_2049');

  const pcbStage = mountedPcb.getThreeStage();
  assert(pcbStage !== null, 'ThreeStage must be initialized for pcb_2049');
  assert.strictEqual(pcbStage!.width, 1080);
  assert.strictEqual(pcbStage!.height, 1920);
  assert.strictEqual(pcbStage!.fov, 35);

  const pcbStats = pcbStage!.getResourceStats();
  assert(pcbStats.geometries > 20, 'PCB-2049 3D must track scene geometries');
  assert(pcbStats.materials > 10, 'PCB-2049 3D must track scene materials');
  assert(pcbStats.textures >= 3, 'PCB-2049 3D must track LPI relief, silkscreen & PMREM textures');
  assert.strictEqual(pcbStats.disposed, false);

  const pcbTime1 = new Date(2026, 10, 17, 13, 15, 30, 0);
  const pcbTick1 = formatSynchronizedTime(
    pcbTime1,
    { hourFormat: '24h', showSeconds: true, showDate: true },
    'sweep'
  );
  const testSwingRad = (4.5 * Math.PI) / 180;
  mountedPcb.renderPendulum(mockCtx, {
    angleDeg: 4.5,
    angleRad: testSwingRad,
    angularVelocityNorm: 0.4,
    angularVelocityRad: 0.15,
    phase: 0.25,
    phaseRad: Math.PI * 0.5,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 1.0,
    dimmed: false,
    pivot: { x: 540, y: 990 },
    timeSec: 1.5
  });
  mountedPcb.renderDial(mockCtx, {
    date: pcbTime1,
    hours: pcbTime1.getHours(),
    minutes: pcbTime1.getMinutes(),
    seconds: pcbTime1.getSeconds(),
    milliseconds: 0,
    angles: pcbTick1.angles,
    secondMode: 'sweep',
    timestampMs: pcbTime1.getTime(),
    realTimeMs: 1500,
    deltaTimeSec: 0.016,
    displayOptions: pcbTick1.options,
    digitalTick: pcbTick1
  });

  const pcbActive = mountedPcb.getDebugState();
  assert.strictEqual(pcbActive.isSleepActive, false);
  assert.strictEqual(pcbActive.boardVisible, true);
  assert.strictEqual(pcbActive.pendulumVisible, true);
  assert.strictEqual(pcbActive.bloomThreshold, 0.92);
  assert.strictEqual(pcbActive.bloomStrength, 0.6);
  assert(Math.abs(pcbActive.pendulumAngleRad - testSwingRad) < 1e-6);
  assert(pcbActive.handEmissiveIntensity > 1.5);

  // Switch to Sleep (Cat Mode)
  mountedPcb.onEvent({ type: 'mode_change', payload: { mode: 'sleep' } });
  mountedPcb.renderPendulum(mockCtx, {
    angleDeg: 4.5,
    angleRad: testSwingRad,
    angularVelocityNorm: 0.4,
    angularVelocityRad: 0.15,
    phase: 0.25,
    phaseRad: Math.PI * 0.5,
    periodSeconds: 2.0,
    maxAngleDeg: 6.0,
    dampingFactor: 0.0,
    dimmed: false,
    pivot: { x: 540, y: 990 },
    timeSec: 2.5
  });
  mountedPcb.renderDial(mockCtx, {
    date: pcbTime1,
    hours: pcbTime1.getHours(),
    minutes: pcbTime1.getMinutes(),
    seconds: pcbTime1.getSeconds(),
    milliseconds: 0,
    angles: pcbTick1.angles,
    secondMode: 'sweep',
    timestampMs: pcbTime1.getTime(),
    realTimeMs: 2600,
    deltaTimeSec: 0.05,
    displayOptions: pcbTick1.options,
    digitalTick: pcbTick1
  });

  const pcbSleep = mountedPcb.getDebugState();
  assert.strictEqual(pcbSleep.isSleepActive, true);
  assert.strictEqual(pcbSleep.boardVisible, false);
  assert.strictEqual(pcbSleep.pendulumVisible, false);
  assert.strictEqual(pcbSleep.keyLightIntensity, 0);
  assert.strictEqual(pcbSleep.handPointLightIntensity, 0);
  assert.strictEqual(pcbSleep.pendulumAngleRad, 0);
  assert(
    pcbSleep.handEmissiveIntensity >= 0.12 && pcbSleep.handEmissiveIntensity <= 0.15,
    `Sleep hand emissive (${pcbSleep.handEmissiveIntensity}) must be in ~12-15% range`
  );

  // Switching away from pcb_2049 cleanly disposes all GPU resources
  await themeManager.setTheme('vienna_classic', { animateTransition: false });
  const pcbDisposed = pcbStage!.getResourceStats();
  assert.strictEqual(pcbDisposed.disposed, true);
  assert.strictEqual(pcbDisposed.geometries, 0);
  assert.strictEqual(pcbDisposed.materials, 0);
  assert.strictEqual(pcbDisposed.textures, 0);
  assert.strictEqual(pcbDisposed.renderTargets, 0);

  console.log('✓ Test 10 Passed: PCB-2049 3D Three.js Scene, Emerald LPI Stackup, Kapton Flex, Cat Sleep & Disposal');

  console.log('==================================================');
  console.log('🎉 ALL 10 TEST SUITES PASSED! (10/10 Test Suites)');
  console.log('==================================================');
}

runHybridBaseTests().catch((err) => {
  console.error('HybridBase Test Suite Failed:', err);
  process.exit(1);
});

