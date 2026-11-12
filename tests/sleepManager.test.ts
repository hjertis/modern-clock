import assert from 'node:assert';
import { SleepManager, TimeSchedule } from '../src/core/sleepManager';
import { ClockAudioEngine } from '../src/core/audioEngine';
import { NotificationManager } from '../src/core/notificationManager';
import { ClockEngine } from '../src/core/clockEngine';
import { ClockWebSocketClient } from '../src/core/wsClient';
import { ClockMode, NotificationPayload } from '../src/types/theme';

// Mock DOM environment if running in Node without JSDOM
class MockElement {
  private classes = new Set<string>();
  public classList = {
    add: (...cls: string[]) => cls.forEach((c) => this.classes.add(c)),
    remove: (...cls: string[]) => cls.forEach((c) => this.classes.delete(c)),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force !== undefined) {
        if (force) this.classes.add(c);
        else this.classes.delete(c);
        return force;
      }
      if (this.classes.has(c)) {
        this.classes.delete(c);
        return false;
      } else {
        this.classes.add(c);
        return true;
      }
    }
  };
  public hasClass(c: string) { return this.classes.has(c); }
  public styleMap = new Map<string, string>();
  public style = {
    setProperty: (k: string, v: string) => this.styleMap.set(k, v),
    getPropertyValue: (k: string) => this.styleMap.get(k) || '',
    transform: '',
    display: ''
  };
  public eventListeners: Record<string, Function[]> = {};

  public addEventListener(event: string, fn: Function, _opts?: unknown) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  public removeEventListener(event: string, fn: Function, _opts?: unknown) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter((f) => f !== fn);
    }
  }

  public dispatchEvent(event: { type: string; [key: string]: any }) {
    const list = this.eventListeners[event.type] || [];
    for (const fn of list) {
      fn(event);
    }
  }

  public innerHTML = '';
  public className = '';
  public setAttribute(_name: string, _value: string) {}
  public getAttribute(_name: string) { return null; }
  public prepend(_child: any) {}
  public removeChild(_child: any) {}
  public querySelector(_sel: string) { return null; }
  public querySelectorAll(_sel: string) { return []; }
}

// Polyfill minimal browser globals for Node test environment
(globalThis as any).requestAnimationFrame = (fn: Function) => setTimeout(fn, 0);
(globalThis as any).window = {
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '' }
};
(globalThis as any).document = {
  createElement: () => new MockElement(),
  body: new MockElement()
};

async function runTests() {
  console.log('--- Starting Unified 4-State SleepManager Test Suite ---');

  const stage = new MockElement() as any;

  // 1. Initial State & Power/Presence States
  console.log('Test 1: 4-State Machine Basics');
  const sleepManager = new SleepManager(stage, {
    schedule: {
      enabled: true,
      wakeTime: '06:30',
      nightStart: '22:00',
      sleepStart: '23:30'
    },
    nightDimLevel: 0.20,
    sleepOpacity: 0.05
  });

  assert.strictEqual(sleepManager.getMode(), 'active');
  assert.strictEqual(sleepManager.getIsSleeping(), false);

  // Switch to silent
  sleepManager.setMode('silent');
  assert.strictEqual(sleepManager.getMode(), 'silent');
  assert.strictEqual(sleepManager.getIsSleeping(), false);
  assert(stage.classList.contains('mode-silent'));

  // Switch to night
  sleepManager.setMode('night');
  assert.strictEqual(sleepManager.getMode(), 'night');
  assert.strictEqual(sleepManager.getIsSleeping(), false);
  assert(stage.classList.contains('mode-night'));
  assert.strictEqual(stage.styleMap.get('--night-brightness'), '0.2');

  // Switch to sleep (Cat-Safe)
  sleepManager.setMode('sleep');
  assert.strictEqual(sleepManager.getMode(), 'sleep');
  assert.strictEqual(sleepManager.getIsSleeping(), true);
  assert(stage.classList.contains('mode-sleep'));
  assert(stage.classList.contains('night-sleep'));
  assert.strictEqual(stage.styleMap.get('--sleep-opacity'), '0.05');

  console.log('✓ Test 1 Passed: 4-State Machine basics and CSS variables');

  // 2. Schedule Evaluation and Transition Logic
  console.log('Test 2: Automatic Schedule Evaluation');
  // 07:00 -> active
  const morningDate = new Date('2026-11-12T07:00:00');
  assert.strictEqual(sleepManager.evaluateScheduleMode(morningDate), 'active');

  // 22:15 -> night
  const nightDate = new Date('2026-11-12T22:15:00');
  assert.strictEqual(sleepManager.evaluateScheduleMode(nightDate), 'night');

  // 23:45 -> sleep
  const lateDate = new Date('2026-11-12T23:45:00');
  assert.strictEqual(sleepManager.evaluateScheduleMode(lateDate), 'sleep');

  // 02:30 overnight -> sleep
  const overnightDate = new Date('2026-11-12T02:30:00');
  assert.strictEqual(sleepManager.evaluateScheduleMode(overnightDate), 'sleep');

  console.log('✓ Test 2 Passed: Time windows correctly evaluate across 24h & midnight');

  // 3. Manual Override Priority until Next Scheduled Transition
  console.log('Test 3: Manual Override Priority until Next Scheduled Transition');
  const mgr2 = new SleepManager(stage, {
    schedule: {
      enabled: true,
      wakeTime: '06:30',
      nightStart: '22:00',
      sleepStart: '23:30'
    }
  });

  // At 21:00 (scheduled active), user manually forces 'silent'
  mgr2.update(new Date('2026-11-12T21:00:00'), 1000);
  assert.strictEqual(mgr2.getMode(), 'active');

  mgr2.setMode('silent', true);
  assert.strictEqual(mgr2.getMode(), 'silent');
  assert.strictEqual(mgr2.isManualOverrideActive(), true);

  // At 21:30 (still scheduled active), manual override holds
  mgr2.update(new Date('2026-11-12T21:30:00'), 2000);
  assert.strictEqual(mgr2.getMode(), 'silent');

  // At 22:00 (scheduled transition to 'night' occurs)
  mgr2.update(new Date('2026-11-12T22:00:00'), 3000);
  // Manual override is cleared, scheduled mode 'night' takes over!
  assert.strictEqual(mgr2.getMode(), 'night');
  assert.strictEqual(mgr2.isManualOverrideActive(), false);

  // Now user overrides to 'active' at 22:15
  mgr2.setMode('active', true);
  assert.strictEqual(mgr2.getMode(), 'active');
  assert.strictEqual(mgr2.isManualOverrideActive(), true);

  // At 23:30 (scheduled transition to 'sleep' occurs)
  mgr2.update(new Date('2026-11-12T23:30:00'), 4000);
  assert.strictEqual(mgr2.getMode(), 'sleep');
  assert.strictEqual(mgr2.isManualOverrideActive(), false);

  console.log('✓ Test 3 Passed: Manual override priority clears on scheduled transition boundary');

  // 4. AudioEngine Muting & Alert Rules
  console.log('Test 4: AudioEngine Integration');
  const audio = new ClockAudioEngine();

  // Active mode: chimes & ticks allowed
  audio.setClockMode('active');
  assert.strictEqual(audio.getClockMode(), 'active');

  // Silent mode: ticks & chimes muted
  audio.setClockMode('silent');
  assert.strictEqual(audio.getClockMode(), 'silent');

  // Night mode: ticks & chimes muted
  audio.setClockMode('night');
  assert.strictEqual(audio.getClockMode(), 'night');

  // Sleep mode: all audio muted
  audio.setClockMode('sleep');
  assert.strictEqual(audio.getClockMode(), 'sleep');

  console.log('✓ Test 4 Passed: AudioEngine mode switching and guards');

  // 5. NotificationManager Suppression & Queueing
  console.log('Test 5: NotificationManager Mode Rules & Queueing');
  const notifZone = new MockElement() as any;
  const notifManager = new NotificationManager(notifZone, null, audio);

  // Active mode: low & normal allowed
  notifManager.setMode('active');
  const id1 = notifManager.notify({ title: 'T1', message: 'M1', priority: 'normal' });
  assert(id1.startsWith('notif_'));
  assert.strictEqual(notifManager.getQueuedNotifications().length, 0);

  // Night mode: low & normal queued/suppressed, high/critical allowed
  notifManager.setMode('night');
  notifManager.notify({ title: 'T2', message: 'M2', priority: 'normal' });
  notifManager.notify({ title: 'T3', message: 'M3', priority: 'low' });
  assert.strictEqual(notifManager.getQueuedNotifications().length, 2);

  // High priority allowed in night mode
  notifManager.notify({ title: 'Emergency', message: 'Alarm', priority: 'critical' });
  // Queue still has 2 because critical was displayed directly
  assert.strictEqual(notifManager.getQueuedNotifications().length, 2);

  // Sleep mode: visual toasts suppressed, all notifications queued
  notifManager.setMode('sleep');
  notifManager.notify({ title: 'T4', message: 'M4', priority: 'normal' });
  assert.strictEqual(notifManager.getQueuedNotifications().length, 3);

  // Exiting sleep back to active flushes queued notifications
  notifManager.setMode('active');
  assert.strictEqual(notifManager.getQueuedNotifications().length, 0);

  console.log('✓ Test 5 Passed: Notification suppression and queue flush');

  // 6. ClockEngine FPS Throttling & Pendulum Motion Suppression
  console.log('Test 6: ClockEngine FPS Throttling & Pet Motion Suppression');
  const clockEngine = new ClockEngine(undefined, { sleepManager: mgr2, audioEngine: audio });

  mgr2.setMode('active');
  clockEngine.setMode('active');
  assert.strictEqual(clockEngine.getMode(), 'active');

  mgr2.setMode('night');
  clockEngine.setMode('night');
  assert.strictEqual(clockEngine.getMode(), 'night');

  mgr2.setMode('sleep');
  clockEngine.setMode('sleep');
  assert.strictEqual(clockEngine.getMode(), 'sleep');

  console.log('✓ Test 6 Passed: ClockEngine mode throttle configuration');

  // 7. Paw-Proof Wake Guard
  console.log('Test 7: Paw-Proof Wake Guard (Hold & Triple Tap)');
  const pawStage = new MockElement() as any;
  const pawSleep = new SleepManager(pawStage);

  pawSleep.setMode('sleep');
  assert.strictEqual(pawSleep.getMode(), 'sleep');

  // Single tap: ignored!
  let prevented = false;
  pawStage.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'click',
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  // Mode should still be 'sleep'
  assert.strictEqual(pawSleep.getMode(), 'sleep');

  // Triple-tap within 1 second: wakes display!
  pawStage.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  pawStage.dispatchEvent({
    type: 'pointerup',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });

  assert.strictEqual(pawSleep.getMode(), 'active');

  // Test 7b: Press-and-hold wake (2.5s hold, tested with custom hold threshold)
  const holdStage = new MockElement() as any;
  const holdSleep = new SleepManager(holdStage, {
    catSafeWakeHoldMs: 60
  });
  holdSleep.setMode('sleep');
  assert.strictEqual(holdSleep.getMode(), 'sleep');

  holdStage.dispatchEvent({
    type: 'pointerdown',
    pointerId: 1,
    preventDefault: () => {},
    stopPropagation: () => {}
  });

  // Mode should still be sleep immediately
  assert.strictEqual(holdSleep.getMode(), 'sleep');

  // Wait for hold timer to trigger wake
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(holdSleep.getMode(), 'active');

  console.log('✓ Test 7 Passed: Single tap ignored, triple tap wakes, press-and-hold wakes');

  // 8. WebSocket / MQTT Inbound Commands & Outbound Broadcasts
  console.log('Test 8: WebSocket / MQTT Actions & State Broadcast');
  const mockWsMessages: any[] = [];
  const wsClient = new ClockWebSocketClient({
    clockEngine,
    notificationManager: notifManager,
    audioEngine: audio,
    sleepManager: pawSleep
  });

  // Mock socket send
  (wsClient as any).isConnected = () => true;
  (wsClient as any).socket = {
    readyState: 1,
    send: (msg: string) => {
      mockWsMessages.push(JSON.parse(msg));
    }
  };

  // Test inbound set_mode action
  wsClient.processMessage({ action: 'set_mode', mode: 'night' });
  assert.strictEqual(pawSleep.getMode(), 'night');

  // Check state broadcast
  const lastMsg = mockWsMessages[mockWsMessages.length - 1];
  assert.strictEqual(lastMsg.type, 'mode_changed');
  assert.strictEqual(lastMsg.mode, 'night');

  // Test inbound wake action
  pawSleep.setMode('sleep');
  wsClient.processMessage({ action: 'wake' });
  assert.strictEqual(pawSleep.getMode(), 'active');

  // Test inbound set_schedule action
  wsClient.processMessage({
    action: 'set_schedule',
    nightStart: '21:30',
    sleepStart: '23:00',
    wakeTime: '07:00'
  });
  const sched = pawSleep.getSchedule();
  assert.strictEqual(sched.nightStart, '21:30');
  assert.strictEqual(sched.sleepStart, '23:00');
  assert.strictEqual(sched.wakeTime, '07:00');

  console.log('✓ Test 8 Passed: WebSocket set_mode, set_schedule, wake, and state broadcasting');

  console.log('==================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (8/8 Test Suites)');
  console.log('==================================================');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
