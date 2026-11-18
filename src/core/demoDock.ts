import { ThemeManager } from '../themes/themeManager';
import { SleepManager } from './sleepManager';
import { NotificationManager } from './notificationManager';
import { DebugOverlay } from './debugOverlay';
import { ClockWebSocketClient } from './wsClient';
import { ClockMode } from '../types/theme';

export interface DemoDockOptions {
  container: HTMLElement;
  themeManager: ThemeManager;
  sleepManager: SleepManager;
  notificationManager: NotificationManager;
  debugOverlay?: DebugOverlay | null;
  idleDimMs?: number;
}

export function isDemoModeEnabled(): boolean {
  return ClockWebSocketClient.isDemoMode();
}

export class DemoDock {
  private container: HTMLElement;
  private dockElement: HTMLElement;
  private themeSelect!: HTMLSelectElement;
  private modeButtons: Map<ClockMode, HTMLButtonElement> = new Map();
  private themeManager: ThemeManager;
  private sleepManager: SleepManager;
  private notificationManager: NotificationManager;
  private debugOverlay: DebugOverlay | null;
  private idleDimMs: number;
  private idleTimer: number | null = null;
  private unsubscribers: Array<() => void> = [];
  private boundResetIdle: () => void;

  constructor(options: DemoDockOptions) {
    this.container = options.container;
    this.themeManager = options.themeManager;
    this.sleepManager = options.sleepManager;
    this.notificationManager = options.notificationManager;
    this.debugOverlay = options.debugOverlay || null;
    this.idleDimMs = options.idleDimMs ?? 4000;

    this.dockElement = document.createElement('div');
    this.dockElement.id = 'demo-showcase-dock';
    this.dockElement.className = 'demo-dock';
    this.dockElement.setAttribute('role', 'region');
    this.dockElement.setAttribute('aria-label', 'Clock Demo Controls');

    this.boundResetIdle = this.resetIdleDim.bind(this);

    this.buildDom();
    this.container.appendChild(this.dockElement);
    this.setupListeners();
    this.resetIdleDim();
  }

  private buildDom(): void {
    // 1. Theme selector
    const themeGroup = this.createGroup();
    const themeLabel = document.createElement('span');
    themeLabel.className = 'demo-dock-label';
    themeLabel.textContent = 'Theme';
    themeGroup.appendChild(themeLabel);

    this.themeSelect = document.createElement('select');
    this.themeSelect.className = 'demo-dock-select';
    this.themeSelect.setAttribute('aria-label', 'Select Clock Theme');
    this.populateThemeOptions();
    this.themeSelect.addEventListener('change', () => {
      void this.themeManager.setTheme(this.themeSelect.value);
    });
    themeGroup.appendChild(this.themeSelect);

    // 2. Presence mode buttons
    const modeGroup = this.createGroup();
    const modes: Array<{ mode: ClockMode; label: string }> = [
      { mode: 'active', label: 'Active' },
      { mode: 'night', label: 'Night' },
      { mode: 'sleep', label: 'Sleep' }
    ];
    for (const item of modes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'demo-dock-btn';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        this.sleepManager.setMode(item.mode, true);
      });
      this.modeButtons.set(item.mode, btn);
      modeGroup.appendChild(btn);
    }
    this.syncModeButtons(this.sleepManager.getMode());

    // 3. Sample local notifications
    const notifGroup = this.createGroup();
    const btnInfo = this.createButton('Info', 'demo-dock-btn', () => {
      this.notificationManager.notify({
        category: 'info',
        priority: 'normal',
        title: 'TELEMETRY // SYNC OK',
        message: 'Epoch phase locked — local autonomous demo mode active.',
        timeoutMs: 5000
      });
    });
    const btnDoorbell = this.createButton('Doorbell', 'demo-dock-btn demo-dock-btn-accent', () => {
      this.notificationManager.notify({
        category: 'doorbell',
        priority: 'normal',
        title: 'FRONT ENTRANCE // DOORBELL',
        message: 'Visitor detected at main entrance — chime triggered.',
        timeoutMs: 6500
      });
    });
    const btnAlert = this.createButton(
      'Security Alert',
      'demo-dock-btn demo-dock-btn-danger',
      () => {
        this.notificationManager.notify({
          category: 'securityAlert',
          priority: 'urgent',
          title: 'PERIMETER // SECURITY ALERT',
          message: 'Motion sensor tripped in sector 02 — urgent override active.',
          timeoutMs: 7500
        });
      }
    );
    notifGroup.appendChild(btnInfo);
    notifGroup.appendChild(btnDoorbell);
    notifGroup.appendChild(btnAlert);

    // 4. Optional Calibration HUD toggle & GitHub repo link
    const hudGroup = this.createGroup();
    const btnHud = this.createButton('HUD', 'demo-dock-btn', () => {
      this.debugOverlay?.toggleHUD();
    });
    btnHud.title = 'Toggle Calibration HUD (H)';
    hudGroup.appendChild(btnHud);

    const repoLink = document.createElement('a');
    repoLink.className = 'demo-dock-btn demo-dock-link';
    repoLink.href = 'https://github.com/hjertis/modern-clock';
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.title = 'View source on GitHub';
    repoLink.textContent = 'GitHub ↗';
    hudGroup.appendChild(repoLink);

    this.dockElement.replaceChildren(themeGroup, modeGroup, notifGroup, hudGroup);
  }

  private createGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'demo-dock-group';
    return group;
  }

  private createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private populateThemeOptions(): void {
    const activeId = this.themeManager.getActiveThemeId();
    const themes = this.themeManager.getAvailableThemes();
    const options: HTMLOptionElement[] = [];

    for (const theme of themes) {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = theme.name;
      if (theme.id === activeId) {
        opt.selected = true;
      }
      options.push(opt);
    }

    this.themeSelect.replaceChildren(...options);
    this.themeSelect.value = activeId;
  }

  private syncModeButtons(activeMode: ClockMode): void {
    for (const [mode, btn] of this.modeButtons.entries()) {
      btn.classList.toggle('active', mode === activeMode);
    }
  }

  private setupListeners(): void {
    this.unsubscribers.push(
      this.themeManager.onThemeChange((theme) => {
        this.themeSelect.value = theme.id;
      })
    );
    this.unsubscribers.push(
      this.themeManager.onThemeRegistryChange(() => {
        this.populateThemeOptions();
      })
    );
    this.unsubscribers.push(
      this.sleepManager.onModeChange((mode) => {
        this.syncModeButtons(mode);
      })
    );

    for (const evt of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) {
      window.addEventListener(evt, this.boundResetIdle, { passive: true });
    }
    this.dockElement.addEventListener('mouseenter', this.boundResetIdle, { passive: true });
    this.dockElement.addEventListener('focusin', this.boundResetIdle);
  }

  private resetIdleDim(): void {
    this.dockElement.classList.remove('dimmed');
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
    }
    this.idleTimer = window.setTimeout(() => {
      this.dockElement.classList.add('dimmed');
    }, this.idleDimMs);
  }

  public destroy(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    for (const evt of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) {
      window.removeEventListener(evt, this.boundResetIdle);
    }
    this.dockElement.removeEventListener('mouseenter', this.boundResetIdle);
    this.dockElement.removeEventListener('focusin', this.boundResetIdle);
    if (this.dockElement.parentNode) {
      this.dockElement.parentNode.removeChild(this.dockElement);
    }
  }
}
