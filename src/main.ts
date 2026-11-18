import './styles/main.css';
import { ThemeLoader, ClockDomElements } from './core/themeLoader';
import { ClockEngine } from './core/clockEngine';
import { NotificationManager } from './core/notificationManager';
import { DebugOverlay } from './core/debugOverlay';
import { ClockWebSocketClient } from './core/wsClient';
import { ThemeManager } from './themes/themeManager';
import { ClockAudioEngine } from './core/audioEngine';
import { SleepManager, TimeSchedule } from './core/sleepManager';
import { DisplayOptions } from './core/timeFormatter';
import { NotificationPayload, Theme, ClockMode } from './types/theme';

export interface ClockPublicAPI {
  notify: (payload: NotificationPayload) => string;
  dismiss: (id: string) => void;
  clearAllNotifications: () => void;
  setMode: (mode: 'tick' | 'sweep') => void;
  toggleMode: () => 'tick' | 'sweep';
  setTimeMultiplier: (multiplier: number) => void;
  setTheme: (themeId: string) => Promise<Theme>;
  setDisplayOptions: (options: Partial<DisplayOptions>) => DisplayOptions;
  getDisplayOptions: () => DisplayOptions;
  setClockMode: (mode: ClockMode) => void;
  getClockMode: () => ClockMode;
  wake: () => void;
  setSchedule: (schedule: Partial<TimeSchedule>) => void;
  getSchedule: () => TimeSchedule;
  themeManager: ThemeManager;
  engine: ClockEngine;
  loader: ThemeLoader;
  notifications: NotificationManager;
  ws: ClockWebSocketClient;
  audio: ClockAudioEngine;
  sleep: SleepManager;
}

declare global {
  interface Window {
    clock: ClockPublicAPI;
  }
}

function initViewportScaling(stage: HTMLElement): void {
  const BASE_WIDTH = 1080;
  const BASE_HEIGHT = 1920;

  const updateScale = () => {
    const windowW = window.innerWidth;
    const windowH = window.innerHeight;

    // Use containment scaling so entire 1080x1920 fits viewport
    const scaleX = windowW / BASE_WIDTH;
    const scaleY = windowH / BASE_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    stage.style.transform = `scale(${scale})`;
  };

  window.addEventListener('resize', updateScale);
  updateScale();
}

function initKioskWakeLock(): void {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

  let wakeLockSentinel: WakeLockSentinel | null = null;

  const acquireWakeLock = async () => {
    try {
      if (document.visibilityState === 'visible') {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch {
      // Browser may require a user gesture or deny Wake Lock in headless environments
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLockSentinel) {
      void acquireWakeLock();
    }
  });

  window.addEventListener(
    'pointerdown',
    () => {
      if (!wakeLockSentinel) {
        void acquireWakeLock();
      }
    },
    { once: true, passive: true }
  );

  void acquireWakeLock();
}

function initIdleCursorHiding(idleTimeoutMs = 5000): void {
  if (typeof document === 'undefined' || !document.body) return;

  let idleTimer: number | null = null;

  const resetIdleTimer = () => {
    document.body.classList.remove('kiosk-cursor-hidden');
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
    }
    idleTimer = window.setTimeout(() => {
      document.body.classList.add('kiosk-cursor-hidden');
    }, idleTimeoutMs);
  };

  for (const evt of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  }

  resetIdleTimer();
}

async function bootstrap() {
  const stage = document.getElementById('clock-stage') as HTMLElement;
  const canvas = document.getElementById('clock-canvas') as HTMLCanvasElement;
  const bg = document.getElementById('clock-bg') as HTMLImageElement;
  const pendulum = document.getElementById('clock-pendulum') as HTMLImageElement;
  const notificationZone = document.getElementById('notification-zone') as HTMLElement;
  const dial = document.getElementById('clock-dial') as HTMLImageElement;
  const handHour = document.getElementById('hand-hour') as HTMLImageElement;
  const handMinute = document.getElementById('hand-minute') as HTMLImageElement;
  const handSecond = document.getElementById('hand-second') as HTMLImageElement;
  const handCap = document.getElementById('hand-cap') as HTMLImageElement;
  const crosshairs = document.getElementById('debug-crosshairs') as HTMLElement;
  const hudTogglePill = document.getElementById('hud-toggle-pill') as HTMLButtonElement;
  const themeTogglePill = document.getElementById('theme-toggle-pill') as HTMLButtonElement;
  const themePillLabel = document.getElementById('theme-pill-label') as HTMLElement;

  if (!stage || !canvas || !notificationZone || !crosshairs) {
    throw new Error('Missing required clock DOM elements');
  }

  // 1. Fixed Canvas Containment Scaling & 24/7 Kiosk Safeguards
  initViewportScaling(stage);
  initKioskWakeLock();
  initIdleCursorHiding(5000);

  // 2. DOM Elements Bundle
  const elements: ClockDomElements = {
    stage,
    bg,
    pendulum,
    notificationZone,
    dial,
    handHour,
    handMinute,
    handSecond,
    handCap
  };

  // 3. Initialize Core Managers & Modular Theme Architecture
  const themeLoader = new ThemeLoader(elements);
  const audioEngine = new ClockAudioEngine();
  const sleepManager = new SleepManager(stage, {
    schedule: {
      enabled: false,
      wakeTime: '06:30',
      nightStart: '22:00',
      sleepStart: '23:30'
    },
    nightDimLevel: 0.20,
    sleepOpacity: 0.05
  });
  const themeManager = new ThemeManager(canvas, stage, notificationZone, audioEngine);
  const clockEngine = new ClockEngine(elements, { themeManager, audioEngine, sleepManager });
  const notificationManager = new NotificationManager(
    notificationZone,
    pendulum,
    audioEngine,
    sleepManager
  );

  // Sync mode changes across all subsystems
  sleepManager.onModeChange((mode, prevMode) => {
    console.log(`[Clock] Mode changed: ${prevMode} -> ${mode}`);
    clockEngine.setMode(mode);
    audioEngine.setClockMode(mode);
    notificationManager.setMode(mode);
    themeManager.dispatchEvent({
      type: 'mode_change',
      payload: { mode, prevMode, isSleeping: mode === 'sleep' },
      timestamp: Date.now()
    });
  });

  clockEngine.setActiveNotificationsProvider(() => notificationManager.getActiveCount());

  // Forward notification events to active theme for reactive lateral bus pulses
  notificationManager.addEventListener((event) => {
    themeManager.dispatchEvent(event);
  });

  // Sync engine manifest, pill UI, and sound profile whenever active theme changes
  const updateThemePillLabel = (themeId: string) => {
    if (!themePillLabel) return;
    if (themeId === 'pcb_2049') {
      themePillLabel.textContent = '⚡ PCB-2049 / Silicon (T)';
    } else if (themeId === 'pcb_2049_emerald') {
      themePillLabel.textContent = '🟢 Silicon Master // Rev B (T)';
    } else if (themeId === 'hybrid_base') {
      themePillLabel.textContent = '🎛️ Hybrid Analog/Digital (T)';
    } else if (themeId === 'nixie_hybrid') {
      themePillLabel.textContent = '🔥 Nixie Chronograph (T)';
    } else if (themeId === 'tourbillon_3d') {
      themePillLabel.textContent = '⚙️ Horological Tourbillon 3D (T)';
    } else if (themeId === 'reactor_3d') {
      themePillLabel.textContent = '☢️ Chrono-Containment Reactor (T)';
    } else if (themeId === 'orrery_3d') {
      themePillLabel.textContent = '🪐 Celestial Astrolabe & Orrery (T)';
    } else if (themeId === 'mariana_abyss') {
      themePillLabel.textContent = '🌊 Mariana Abyss (T)';
    } else if (themeId === 'vector_oscilloscope') {
      themePillLabel.textContent = '📈 Vector CRT Oscilloscope (T)';
    } else {
      themePillLabel.textContent = '🕰️ Vienna Classic (T)';
    }
  };

  themeManager.onThemeChange((theme, manifest) => {
    if (manifest) {
      clockEngine.setManifest(manifest);
    }
    audioEngine.setTheme(theme.id);
    updateThemePillLabel(theme.id);
  });

  try {
    // 4. Mount Saved Theme from localStorage (or default 'pcb_2049')
    const initialTheme = await themeManager.initDefaultOrSavedTheme('pcb_2049');
    const initialManifest = themeManager.getActiveManifest();
    if (initialManifest) {
      clockEngine.setManifest(initialManifest);
    }
    audioEngine.setTheme(initialTheme.id);
    updateThemePillLabel(initialTheme.id);

    clockEngine.start();

    // 5. Initialize WebSocket connection to backend daemon
    let debugOverlay: DebugOverlay | null = null;
    const wsClient = new ClockWebSocketClient({
      clockEngine,
      notificationManager,
      audioEngine,
      sleepManager,
      themeManager,
      themeLoader,
      onStatusChange: (status, url) => {
        debugOverlay?.updateWSStatus(status, url);
      }
    });

    // 6. Initialize Debug Overlay & HUD
    debugOverlay = new DebugOverlay(
      document.body,
      crosshairs,
      clockEngine,
      themeLoader,
      notificationManager,
      wsClient,
      themeManager,
      audioEngine,
      sleepManager
    );

    // Pill button toggles HUD
    if (hudTogglePill) {
      hudTogglePill.addEventListener('click', () => {
        debugOverlay?.toggleHUD();
      });
    }

    // Theme pill button cycles registered themes
    if (themeTogglePill) {
      themeTogglePill.addEventListener('click', () => {
        const ids = themeManager.getAvailableThemeIds();
        const currentId = themeManager.getActiveThemeId();
        const idx = ids.indexOf(currentId);
        const nextId = ids[(idx + 1) % ids.length] || 'pcb_2049';
        themeManager.setTheme(nextId);
      });
    }


    // Connect WebSocket
    wsClient.connect();

    // 7. Expose global clock API for kiosk / smart home automation integration
    const publicAPI: ClockPublicAPI = {
      notify: (payload: NotificationPayload) => notificationManager.notify(payload),
      dismiss: (id: string) => notificationManager.dismiss(id),
      clearAllNotifications: () => notificationManager.clearAll(),
      setMode: (mode: 'tick' | 'sweep') => clockEngine.setSecondMode(mode),
      toggleMode: () => clockEngine.toggleSecondMode(),
      setTimeMultiplier: (multiplier: number) => clockEngine.setTimeMultiplier(multiplier),
      setTheme: (themeId: string) => themeManager.setTheme(themeId),
      setDisplayOptions: (options: Partial<DisplayOptions>) => clockEngine.setDisplayOptions(options),
      getDisplayOptions: () => clockEngine.getDisplayOptions(),
      setClockMode: (mode: ClockMode) => sleepManager.setMode(mode, true),
      getClockMode: () => sleepManager.getMode(),
      wake: () => sleepManager.wake(),
      setSchedule: (schedule: Partial<TimeSchedule>) => sleepManager.setSchedule(schedule),
      getSchedule: () => sleepManager.getSchedule(),
      themeManager,
      engine: clockEngine,
      loader: themeLoader,
      notifications: notificationManager,
      ws: wsClient,
      audio: audioEngine,
      sleep: sleepManager
    };

    window.clock = publicAPI;
    console.log(
      '[Digital Grandfather Clock] Initialized modular theme architecture. Public API accessible at window.clock'
    );

    // Subtle welcome glance notification demonstrating reactive electron packets & circuit toast
    setTimeout(() => {
      const activeId = themeManager.getActiveThemeId();
      const activeTheme = themeManager.getActiveTheme();
      const themeDisplayName = activeTheme?.name || (activeId === 'pcb_2049' ? 'PCB-2049' : 'Vienna Classic');

      if (activeId === 'pcb_2049') {
        notificationManager.notify({
          category: 'info',
          priority: 'normal',
          title: 'SYS_BOOT // PCB-2049 ONLINE',
          message:
            'Monocrystalline silicon wafer locked to harmonic phase θ(t). Press T to switch theme or H for HUD.',
          timeoutMs: 5200
        });
      } else {
        notificationManager.notify({
          category: 'info',
          priority: 'normal',
          title: 'Chamber Online',
          message:
            `${themeDisplayName} 1080×1920 engine synchronized to epoch time. Press T to switch theme or H for HUD.`,
          timeoutMs: 5000
        });
      }
    }, 900);
  } catch (error) {
    console.error('[Digital Grandfather Clock] Failed to initialize theme architecture:', error);
  }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
