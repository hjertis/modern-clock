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

  console.log('==================================================');
  console.log('🎉 ALL HYBRID & NIXIE TESTS PASSED! (5/5 Test Suites)');
  console.log('==================================================');
}

runHybridBaseTests().catch((err) => {
  console.error('HybridBase Test Suite Failed:', err);
  process.exit(1);
});

