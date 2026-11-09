import './styles/main.css';
import { ThemeLoader, ClockDomElements } from './core/themeLoader';
import { ClockEngine } from './core/clockEngine';
import { NotificationManager } from './core/notificationManager';
import { DebugOverlay } from './core/debugOverlay';
import { NotificationPayload } from './types/theme';

export interface ClockPublicAPI {
  notify: (payload: NotificationPayload) => string;
  dismiss: (id: string) => void;
  clearAllNotifications: () => void;
  setMode: (mode: 'tick' | 'sweep') => void;
  toggleMode: () => 'tick' | 'sweep';
  setTimeMultiplier: (multiplier: number) => void;
  engine: ClockEngine;
  loader: ThemeLoader;
  notifications: NotificationManager;
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

async function bootstrap() {
  const stage = document.getElementById('clock-stage') as HTMLElement;
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

  if (!stage || !bg || !pendulum || !notificationZone || !dial || !handHour || !handMinute || !handSecond || !handCap || !crosshairs) {
    throw new Error('Missing required clock DOM elements');
  }

  // 1. Fixed Canvas Containment Scaling
  initViewportScaling(stage);

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

  // 3. Initialize Core Managers
  const themeLoader = new ThemeLoader(elements);
  const clockEngine = new ClockEngine(elements);
  const notificationManager = new NotificationManager(notificationZone, pendulum);

  // 4. Load Default Theme Manifest
  try {
    const manifest = await themeLoader.loadTheme('/themes/default/theme.json');
    clockEngine.setManifest(manifest);
    clockEngine.start();

    // 5. Initialize Debug Overlay & HUD
    const debugOverlay = new DebugOverlay(
      document.body,
      crosshairs,
      clockEngine,
      themeLoader,
      notificationManager
    );

    // Pill button toggles HUD
    if (hudTogglePill) {
      hudTogglePill.addEventListener('click', () => {
        debugOverlay.toggleHUD();
      });
    }

    // 6. Expose global clock API for kiosk / smart home automation integration
    const publicAPI: ClockPublicAPI = {
      notify: (payload: NotificationPayload) => notificationManager.notify(payload),
      dismiss: (id: string) => notificationManager.dismiss(id),
      clearAllNotifications: () => notificationManager.clearAll(),
      setMode: (mode: 'tick' | 'sweep') => clockEngine.setSecondMode(mode),
      toggleMode: () => clockEngine.toggleSecondMode(),
      setTimeMultiplier: (multiplier: number) => clockEngine.setTimeMultiplier(multiplier),
      engine: clockEngine,
      loader: themeLoader,
      notifications: notificationManager
    };

    window.clock = publicAPI;
    console.log('[Digital Grandfather Clock] Initialized successfully. Public API accessible at window.clock');

    // Optional subtle welcome glance
    setTimeout(() => {
      notificationManager.notify({
        category: 'info',
        title: 'Chamber Online',
        message: 'Vienna Classic 1080×1920 engine synchronized to epoch time. Press H to toggle HUD.',
        timeoutMs: 5000
      });
    }, 1200);

  } catch (error) {
    console.error('[Digital Grandfather Clock] Failed to load theme:', error);
  }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

