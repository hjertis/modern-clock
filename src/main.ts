import './styles/main.css';
import { ThemeLoader, ClockDomElements } from './core/themeLoader';
import { ClockEngine } from './core/clockEngine';
import { NotificationManager } from './core/notificationManager';
import { DebugOverlay } from './core/debugOverlay';
import { ClockWebSocketClient } from './core/wsClient';
import { ThemeManager } from './themes/themeManager';
import { NotificationPayload, Theme } from './types/theme';

export interface ClockPublicAPI {
  notify: (payload: NotificationPayload) => string;
  dismiss: (id: string) => void;
  clearAllNotifications: () => void;
  setMode: (mode: 'tick' | 'sweep') => void;
  toggleMode: () => 'tick' | 'sweep';
  setTimeMultiplier: (multiplier: number) => void;
  setTheme: (themeId: string) => Promise<Theme>;
  themeManager: ThemeManager;
  engine: ClockEngine;
  loader: ThemeLoader;
  notifications: NotificationManager;
  ws: ClockWebSocketClient;
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

  // 3. Initialize Core Managers & Modular Theme Architecture
  const themeLoader = new ThemeLoader(elements);
  const themeManager = new ThemeManager(canvas, stage, notificationZone);
  const clockEngine = new ClockEngine(elements, { themeManager });
  const notificationManager = new NotificationManager(notificationZone, pendulum);

  clockEngine.setActiveNotificationsProvider(() => notificationManager.getActiveCount());

  // Forward notification events to active theme for reactive lateral bus pulses
  notificationManager.addEventListener((event) => {
    themeManager.dispatchEvent(event);
  });

  // Sync engine manifest & pill UI whenever active theme changes
  const updateThemePillLabel = (themeId: string) => {
    if (!themePillLabel) return;
    if (themeId === 'pcb_2049') {
      themePillLabel.textContent = '⚡ PCB-2049 / Silicon (T)';
    } else if (themeId === 'pcb_2049_emerald') {
      themePillLabel.textContent = '🟢 Silicon Master // Rev B (T)';
    } else {
      themePillLabel.textContent = '🕰️ Vienna Classic (T)';
    }
  };


  themeManager.onThemeChange((theme, manifest) => {
    if (manifest) {
      clockEngine.setManifest(manifest);
    }
    updateThemePillLabel(theme.id);
  });

  try {
    // 4. Mount Saved Theme from localStorage (or default 'pcb_2049')
    const initialTheme = await themeManager.initDefaultOrSavedTheme('pcb_2049');
    const initialManifest = themeManager.getActiveManifest();
    if (initialManifest) {
      clockEngine.setManifest(initialManifest);
    }
    updateThemePillLabel(initialTheme.id);

    clockEngine.start();

    // 5. Initialize WebSocket connection to backend daemon
    let debugOverlay: DebugOverlay | null = null;
    const wsClient = new ClockWebSocketClient({
      clockEngine,
      notificationManager,
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
      themeManager
    );

    // Pill button toggles HUD
    if (hudTogglePill) {
      hudTogglePill.addEventListener('click', () => {
        debugOverlay?.toggleHUD();
      });
    }

    // Theme pill button cycles registered themes (PCB-2049 -> Silicon Master // Rev B -> Vienna Classic)
    if (themeTogglePill) {
      themeTogglePill.addEventListener('click', () => {
        const currentId = themeManager.getActiveThemeId();
        const nextId =
          currentId === 'pcb_2049'
            ? 'pcb_2049_emerald'
            : currentId === 'pcb_2049_emerald'
              ? 'vienna_classic'
              : 'pcb_2049';
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
      themeManager,
      engine: clockEngine,
      loader: themeLoader,
      notifications: notificationManager,
      ws: wsClient
    };

    window.clock = publicAPI;
    console.log(
      '[Digital Grandfather Clock] Initialized modular theme architecture. Public API accessible at window.clock'
    );

    // Subtle welcome glance notification demonstrating reactive electron packets & circuit toast
    setTimeout(() => {
      const activeId = themeManager.getActiveThemeId();
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
            'Vienna Classic 1080×1920 engine synchronized to epoch time. Press T to switch theme or H for HUD.',
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
