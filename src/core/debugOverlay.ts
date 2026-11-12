import { ThemeManifest } from '../types/theme';
import { ClockEngine } from './clockEngine';
import { ThemeLoader } from './themeLoader';
import { ThemeManager } from '../themes/themeManager';
import { NotificationManager } from './notificationManager';
import { ClockWebSocketClient, WSStatus } from './wsClient';
import { ClockAudioEngine } from './audioEngine';
import { SleepManager } from './sleepManager';

export class DebugOverlay {
  private container: HTMLElement;
  private crosshairsLayer: HTMLElement;
  private panelElement!: HTMLElement;
  private clockEngine: ClockEngine;
  private themeLoader: ThemeLoader;
  private themeManager?: ThemeManager;
  private notificationManager: NotificationManager;
  private wsClient?: ClockWebSocketClient;
  private audioEngine?: ClockAudioEngine;
  private sleepManager?: SleepManager;
  private isVisible = false;
  private showCrosshairs = false;

  constructor(
    container: HTMLElement,
    crosshairsLayer: HTMLElement,
    clockEngine: ClockEngine,
    themeLoader: ThemeLoader,
    notificationManager: NotificationManager,
    wsClient?: ClockWebSocketClient,
    themeManager?: ThemeManager,
    audioEngine?: ClockAudioEngine,
    sleepManager?: SleepManager
  ) {
    this.container = container;
    this.crosshairsLayer = crosshairsLayer;
    this.clockEngine = clockEngine;
    this.themeLoader = themeLoader;
    this.notificationManager = notificationManager;
    this.wsClient = wsClient;
    this.themeManager = themeManager;
    this.audioEngine = audioEngine;
    this.sleepManager = sleepManager || clockEngine.getSleepManager() || undefined;

    if (this.sleepManager) {
      this.sleepManager.onModeChange(() => {
        this.refreshHudModeButtons();
      });
    }

    this.initPanel();
    this.setupKeyboardShortcuts();
    this.updateCrosshairs();

    if (this.themeManager) {
      this.themeManager.onThemeChange((_theme, manifest) => {
        if (manifest) {
          this.renderPanelContent(manifest);
          this.updateCrosshairs();
        }
      });
    }
  }

  private getActiveManifest(): ThemeManifest | null {
    return this.themeManager?.getActiveManifest() || this.themeLoader.getManifest();
  }

  private initPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'debug-hud-panel';
    panel.className = `debug-panel ${this.isVisible ? '' : 'hidden'}`.trim();
    this.panelElement = panel;

    const manifest = this.getActiveManifest();
    if (manifest) {
      this.renderPanelContent(manifest);
    }
    this.container.appendChild(panel);

    this.clockEngine.addOnTickListener((currentDate, pendulumAngle, fps) => {
      if (!this.isVisible) return;
      const timeDisplay = this.panelElement.querySelector('#debug-time-readout');
      const pendulumDisplay = this.panelElement.querySelector('#debug-pendulum-readout');
      const fpsDisplay = this.panelElement.querySelector('#debug-fps-readout');

      if (timeDisplay) {
        timeDisplay.textContent =
          currentDate.toLocaleTimeString() +
          '.' +
          String(currentDate.getMilliseconds()).padStart(3, '0');
      }
      if (pendulumDisplay) {
        pendulumDisplay.textContent = `${pendulumAngle > 0 ? '+' : ''}${pendulumAngle.toFixed(2)}°`;
      }
      if (fpsDisplay) {
        fpsDisplay.textContent = `${fps.toFixed(1)} FPS`;
      }
    });
  }

  private renderPanelContent(manifest: ThemeManifest): void {
    const activeThemeId = this.themeManager?.getActiveThemeId() || 'pcb_2049';
    const availableThemes = this.themeManager?.getAvailableThemes() || [
      { id: 'pcb_2049', name: 'PCB-2049 / Industrial Silicon' },
      { id: 'vienna_classic', name: 'Vienna Classic' }
    ];

    const themeButtonsHtml = availableThemes
      .map(
        (t) => `
        <button data-theme-id="${t.id}" class="debug-btn theme-select-btn ${
          t.id === activeThemeId ? 'active' : ''
        }">
          ${
            t.id === 'pcb_2049'
              ? '⚡ '
              : t.id === 'pcb_2049_emerald'
                ? '🟢 '
                : t.id === 'nixie_hybrid'
                  ? '🔥 '
                  : t.id === 'tourbillon_3d'
                    ? '⚙️ '
                    : t.id === 'hybrid_base'
                      ? '🎛️ '
                      : '🕰️ '
          }${t.name}
        </button>
      `
      )
      .join('');


    this.panelElement.innerHTML = `
      <div class="debug-header">
        <div class="debug-title">
          <span class="debug-badge">DEV HUD</span>
          <h3>Clock Architecture & Calibration</h3>
        </div>
        <div class="debug-actions-top">
          <button id="btn-toggle-crosshairs" class="debug-btn-sm ${this.showCrosshairs ? 'active' : ''}">
            Crosshairs: ${this.showCrosshairs ? 'ON' : 'OFF'}
          </button>
          <button id="btn-close-hud" class="debug-btn-icon" title="Hide HUD (Press H)">✕</button>
        </div>
      </div>

      <div class="debug-body">
        <!-- Live Status Bar -->
        <div class="debug-status-row">
          <div class="debug-stat">
            <span class="stat-label">Simulated Time</span>
            <span id="debug-time-readout" class="stat-value font-mono">--:--:--.---</span>
          </div>
          <div class="debug-stat">
            <span class="stat-label">Pendulum θ</span>
            <span id="debug-pendulum-readout" class="stat-value font-mono">0.00°</span>
          </div>
          <div class="debug-stat">
            <span class="stat-label">Frame Rate</span>
            <span id="debug-fps-readout" class="stat-value font-mono">60.0 FPS</span>
          </div>
          <div class="debug-stat">
            <span class="stat-label">Mode</span>
            <span id="debug-mode-readout" class="stat-value font-mono">${this.clockEngine.getSecondMode().toUpperCase()}</span>
          </div>
          <div class="debug-stat">
            <span class="stat-label">WebSocket</span>
            <span id="debug-ws-readout" class="stat-value font-mono">${this.wsClient ? this.wsClient.getStatus().toUpperCase() : 'DISABLED'}</span>
          </div>
        </div>

        <!-- Theme Selector -->
        <div class="debug-section">
          <div class="section-title">Active Theme Engine</div>
          <div class="debug-button-grid">
            ${themeButtonsHtml}
          </div>
        </div>

        <!-- Power & Presence States -->
        <div class="debug-section">
          <div class="section-title">Power & Presence States</div>
          <div class="debug-button-grid">
            <button id="btn-mode-active" class="debug-btn mode-btn ${this.sleepManager?.getMode() === 'active' ? 'active' : ''}">
              ☀️ Active
            </button>
            <button id="btn-mode-silent" class="debug-btn mode-btn ${this.sleepManager?.getMode() === 'silent' ? 'active' : ''}">
              🤫 Silent
            </button>
            <button id="btn-mode-night" class="debug-btn mode-btn ${this.sleepManager?.getMode() === 'night' ? 'active' : ''}">
              🌙 Night (30 FPS)
            </button>
            <button id="btn-mode-sleep" class="debug-btn mode-btn ${this.sleepManager?.getMode() === 'sleep' ? 'active' : ''}">
              💤 Sleep (Cat-Safe 1 FPS)
            </button>
          </div>
        </div>

        <!-- Quick Action Buttons -->
        <div class="debug-section">
          <div class="section-title">Reactive Telemetry & Actions</div>
          <div class="debug-button-grid">
            <button id="btn-doorbell" class="debug-btn debug-btn-accent">
              🔔 Doorbell + Electron Pulse
            </button>
            <button id="btn-urgent-alert" class="debug-btn debug-btn-danger">
              🚨 Priority Security Alert
            </button>
            <button id="btn-toggle-mode" class="debug-btn">
              ⏱ Toggle Tick / Sweep
            </button>
            <button id="btn-fast-forward" class="debug-btn">
              ⏩ 10x Fast-Forward
            </button>
          </div>
        </div>

        <!-- Procedural Web Audio Engine Controls -->
        <div class="debug-section">
          <div class="section-title">Procedural Web Audio Engine (Zero External Audio)</div>
          <div class="debug-button-grid">
            <button id="btn-toggle-mute" class="debug-btn ${this.audioEngine?.getMuted() ? 'active' : ''}">
              ${this.audioEngine?.getMuted() ? '🔇 Audio Muted' : '🔊 Audio Active'}
            </button>
            <button id="btn-toggle-chimes" class="debug-btn ${this.audioEngine?.getChimesEnabled() ? 'active' : ''}">
              ${this.audioEngine?.getChimesEnabled() ? '🔔 Chimes: ON' : '🔕 Chimes: OFF'}
            </button>
            <button id="btn-test-tick" class="debug-btn">
              ⏱ Test Escapement
            </button>
            <button id="btn-test-chime" class="debug-btn">
              🎵 Test Hour Chime
            </button>
          </div>
          <div class="control-row" style="margin-top: 8px;">
            <label>Master Volume: <span id="debug-volume-val">${Math.round((this.audioEngine?.getVolume() ?? 0.5) * 100)}%</span></label>
            <input type="range" id="input-audio-volume" min="0" max="100" value="${Math.round((this.audioEngine?.getVolume() ?? 0.5) * 100)}" />
          </div>
        </div>

        <!-- Live Calibration Sliders / Inputs -->
        <div class="debug-section">
          <div class="section-title">Dial Center (Canvas 1080×1920)</div>
          <div class="control-row">
            <label>Dial Center X</label>
            <input type="range" id="input-dial-x" min="0" max="1080" value="${manifest.dial.center.x}" />
            <input type="number" id="num-dial-x" class="control-num" min="0" max="1080" value="${manifest.dial.center.x}" />
          </div>
          <div class="control-row">
            <label>Dial Center Y</label>
            <input type="range" id="input-dial-y" min="0" max="1920" value="${manifest.dial.center.y}" />
            <input type="number" id="num-dial-y" class="control-num" min="0" max="1920" value="${manifest.dial.center.y}" />
          </div>
        </div>

        <div class="debug-section">
          <div class="section-title">Pendulum Physics & Hinge</div>
          <div class="control-row">
            <label>Pivot X (Canvas)</label>
            <input type="number" id="num-pend-pivot-x" class="control-num" value="${manifest.pendulum.pivot.x}" />
            <label>Pivot Y (Canvas)</label>
            <input type="number" id="num-pend-pivot-y" class="control-num" value="${manifest.pendulum.pivot.y}" />
          </div>
          <div class="control-row">
            <label>Period T (sec)</label>
            <input type="number" id="num-pend-period" class="control-num" step="0.1" value="${manifest.pendulum.periodSeconds}" />
            <label>Max θ (deg)</label>
            <input type="number" id="num-pend-angle" class="control-num" step="0.5" value="${manifest.pendulum.maxAngleDeg}" />
          </div>
        </div>
      </div>

      <div class="debug-footer">
        <span class="shortcut-tip">Press <kbd>H</kbd> to toggle HUD  •  <kbd>T</kbd> to switch Theme</span>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const manifest = this.getActiveManifest();
    if (!manifest) return;

    // Mode switching buttons
    const setupModeBtn = (btnId: string, mode: 'active' | 'silent' | 'night' | 'sleep') => {
      const btn = this.panelElement.querySelector(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          this.sleepManager?.setMode(mode, true);
          this.clockEngine.setMode(mode);
          this.refreshHudModeButtons();
        });
      }
    };
    setupModeBtn('#btn-mode-active', 'active');
    setupModeBtn('#btn-mode-silent', 'silent');
    setupModeBtn('#btn-mode-night', 'night');
    setupModeBtn('#btn-mode-sleep', 'sleep');

    // Theme switching buttons
    const themeBtns = this.panelElement.querySelectorAll('.theme-select-btn');
    themeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const themeId = btn.getAttribute('data-theme-id');
        if (themeId && this.themeManager) {
          this.themeManager.setTheme(themeId);
        }
      });
    });

    // Toggle crosshairs button
    const btnCrosshairs = this.panelElement.querySelector(
      '#btn-toggle-crosshairs'
    ) as HTMLButtonElement;
    if (btnCrosshairs) {
      btnCrosshairs.addEventListener('click', () => {
        this.showCrosshairs = !this.showCrosshairs;
        this.clockEngine.setShowDebugGrid(this.showCrosshairs);
        btnCrosshairs.classList.toggle('active', this.showCrosshairs);
        btnCrosshairs.textContent = `Crosshairs: ${this.showCrosshairs ? 'ON' : 'OFF'}`;
        this.updateCrosshairs();
      });
    }

    // Close HUD button
    const btnClose = this.panelElement.querySelector('#btn-close-hud');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.toggleHUD());
    }

    // Doorbell notification button
    const btnDoorbell = this.panelElement.querySelector('#btn-doorbell');
    if (btnDoorbell) {
      btnDoorbell.addEventListener('click', () => {
        this.notificationManager.notify({
          category: 'doorbell',
          priority: 'normal',
          title: 'PERIMETER_NODE_01 // DOORBELL',
          message: 'Optical sensor triggered at main airlock — courier package detected.',
          timeoutMs: 6500
        });
      });
    }

    // Urgent Alert button
    const btnUrgent = this.panelElement.querySelector('#btn-urgent-alert');
    if (btnUrgent) {
      btnUrgent.addEventListener('click', () => {
        this.notificationManager.notify({
          category: 'alert',
          priority: 'urgent',
          title: 'CRITICAL_FAULT // OVERVOLTAGE',
          message: 'Transient surge detected on L4_CHRONO_BUS — routing electron packet dump.',
          timeoutMs: 7500
        });
      });
    }

    // Toggle tick/sweep button
    const btnToggleMode = this.panelElement.querySelector('#btn-toggle-mode');
    const modeReadout = this.panelElement.querySelector('#debug-mode-readout');
    if (btnToggleMode) {
      btnToggleMode.addEventListener('click', () => {
        const newMode = this.clockEngine.toggleSecondMode();
        if (modeReadout) {
          modeReadout.textContent = newMode.toUpperCase();
        }
      });
    }

    // Fast-Forward Time button
    const btnFastForward = this.panelElement.querySelector(
      '#btn-fast-forward'
    ) as HTMLButtonElement;
    if (btnFastForward) {
      btnFastForward.addEventListener('click', () => {
        const currentMultiplier = this.clockEngine.getTimeMultiplier();
        if (currentMultiplier === 1.0) {
          this.clockEngine.setTimeMultiplier(10.0);
          btnFastForward.textContent = '⏸ Normal 1x Speed';
          btnFastForward.classList.add('active');
        } else {
          this.clockEngine.setTimeMultiplier(1.0);
          btnFastForward.textContent = '⏩ 10x Fast-Forward';
          btnFastForward.classList.remove('active');
        }
      });
    }

    // Audio Engine Controls
    const btnToggleMute = this.panelElement.querySelector('#btn-toggle-mute') as HTMLButtonElement;
    if (btnToggleMute && this.audioEngine) {
      btnToggleMute.addEventListener('click', () => {
        if (!this.audioEngine) return;
        this.audioEngine.unlock();
        const isMuted = this.audioEngine.toggleMute();
        btnToggleMute.textContent = isMuted ? '🔇 Audio Muted' : '🔊 Audio Active';
        btnToggleMute.classList.toggle('active', isMuted);
      });
    }

    const btnToggleChimes = this.panelElement.querySelector('#btn-toggle-chimes') as HTMLButtonElement;
    if (btnToggleChimes && this.audioEngine) {
      btnToggleChimes.addEventListener('click', () => {
        if (!this.audioEngine) return;
        this.audioEngine.unlock();
        const enabled = this.audioEngine.toggleChimes();
        btnToggleChimes.textContent = enabled ? '🔔 Chimes: ON' : '🔕 Chimes: OFF';
        btnToggleChimes.classList.toggle('active', enabled);
      });
    }

    const btnTestTick = this.panelElement.querySelector('#btn-test-tick') as HTMLButtonElement;
    if (btnTestTick && this.audioEngine) {
      btnTestTick.addEventListener('click', () => {
        if (!this.audioEngine) return;
        this.audioEngine.unlock();
        this.audioEngine.onEscapementTick();
      });
    }

    const btnTestChime = this.panelElement.querySelector('#btn-test-chime') as HTMLButtonElement;
    if (btnTestChime && this.audioEngine) {
      btnTestChime.addEventListener('click', () => {
        if (!this.audioEngine) return;
        this.audioEngine.unlock();
        this.audioEngine.onHour(new Date().getHours());
      });
    }

    const inputVolume = this.panelElement.querySelector('#input-audio-volume') as HTMLInputElement;
    const volumeVal = this.panelElement.querySelector('#debug-volume-val');
    if (inputVolume && this.audioEngine) {
      inputVolume.addEventListener('input', (e) => {
        if (!this.audioEngine) return;
        const vol = Number((e.target as HTMLInputElement).value) / 100;
        this.audioEngine.setVolume(vol);
        if (volumeVal) {
          volumeVal.textContent = `${Math.round(vol * 100)}%`;
        }
      });
    }

    // Dial Center synchronization
    const inputDialX = this.panelElement.querySelector('#input-dial-x') as HTMLInputElement;
    const numDialX = this.panelElement.querySelector('#num-dial-x') as HTMLInputElement;
    const inputDialY = this.panelElement.querySelector('#input-dial-y') as HTMLInputElement;
    const numDialY = this.panelElement.querySelector('#num-dial-y') as HTMLInputElement;

    const syncDialX = (val: number) => {
      manifest.dial.center.x = val;
      inputDialX.value = String(val);
      numDialX.value = String(val);
      this.updateCrosshairs();
    };

    const syncDialY = (val: number) => {
      manifest.dial.center.y = val;
      inputDialY.value = String(val);
      numDialY.value = String(val);
      this.updateCrosshairs();
    };

    inputDialX?.addEventListener('input', (e) =>
      syncDialX(Number((e.target as HTMLInputElement).value))
    );
    numDialX?.addEventListener('change', (e) =>
      syncDialX(Number((e.target as HTMLInputElement).value))
    );
    inputDialY?.addEventListener('input', (e) =>
      syncDialY(Number((e.target as HTMLInputElement).value))
    );
    numDialY?.addEventListener('change', (e) =>
      syncDialY(Number((e.target as HTMLInputElement).value))
    );

    // Pendulum Inputs
    const numPendPivotX = this.panelElement.querySelector('#num-pend-pivot-x') as HTMLInputElement;
    const numPendPivotY = this.panelElement.querySelector('#num-pend-pivot-y') as HTMLInputElement;
    const numPendPeriod = this.panelElement.querySelector('#num-pend-period') as HTMLInputElement;
    const numPendAngle = this.panelElement.querySelector('#num-pend-angle') as HTMLInputElement;

    const updatePendulum = () => {
      manifest.pendulum.pivot.x = Number(numPendPivotX.value);
      manifest.pendulum.pivot.y = Number(numPendPivotY.value);
      manifest.pendulum.periodSeconds = Number(numPendPeriod.value);
      manifest.pendulum.maxAngleDeg = Number(numPendAngle.value);
      this.updateCrosshairs();
    };

    numPendPivotX?.addEventListener('change', updatePendulum);
    numPendPivotY?.addEventListener('change', updatePendulum);
    numPendPeriod?.addEventListener('change', updatePendulum);
    numPendAngle?.addEventListener('change', updatePendulum);
  }

  /**
   * Updates visual crosshairs calibration lines on Layer 7
   */
  public updateCrosshairs(): void {
    if (!this.showCrosshairs) {
      this.crosshairsLayer.innerHTML = '';
      return;
    }

    const manifest = this.getActiveManifest();
    if (!manifest) return;

    const dialX = manifest.dial.center.x;
    const dialY = manifest.dial.center.y;
    const pendPivotX = manifest.pendulum.pivot.x;
    const pendPivotY = manifest.pendulum.pivot.y;
    const notif = manifest.notificationZone;

    this.crosshairsLayer.innerHTML = `
      <svg viewBox="0 0 1080 1920" width="1080" height="1920" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;">
        <!-- Center Dial Crosshairs -->
        <g id="debug-dial-crosshair">
          <line x1="${dialX - 40}" y1="${dialY}" x2="${dialX + 40}" y2="${dialY}" stroke="#ff3b30" stroke-width="2" />
          <line x1="${dialX}" y1="${dialY - 40}" x2="${dialX}" y2="${dialY + 40}" stroke="#ff3b30" stroke-width="2" />
          <circle cx="${dialX}" cy="${dialY}" r="6" fill="#ff3b30" />
          <circle cx="${dialX}" cy="${dialY}" r="24" stroke="#ff3b30" stroke-width="1.5" stroke-dasharray="4 3" fill="none" />
          <text x="${dialX + 32}" y="${dialY - 14}" fill="#ff3b30" font-family="monospace" font-size="16" font-weight="bold">
            Dial Center (${dialX}, ${dialY})
          </text>
        </g>

        <!-- Pendulum Hinge Pivot -->
        <g id="debug-pendulum-pivot">
          <line x1="${pendPivotX - 30}" y1="${pendPivotY}" x2="${pendPivotX + 30}" y2="${pendPivotY}" stroke="#ff9500" stroke-width="2" />
          <line x1="${pendPivotX}" y1="${pendPivotY - 30}" x2="${pendPivotX}" y2="${pendPivotY + 30}" stroke="#ff9500" stroke-width="2" />
          <circle cx="${pendPivotX}" cy="${pendPivotY}" r="5" fill="#ff9500" />
          <text x="${pendPivotX + 36}" y="${pendPivotY + 5}" fill="#ff9500" font-family="monospace" font-size="16" font-weight="bold">
            Pendulum Pivot (${pendPivotX}, ${pendPivotY})
          </text>
        </g>

        <!-- Notification Zone Bounding Outline -->
        <g id="debug-notif-outline">
          <rect x="${notif.x}" y="${notif.y}" width="${notif.width}" height="${notif.height}" 
            fill="none" stroke="#30d158" stroke-width="2" stroke-dasharray="6 4" opacity="0.8" />
          <text x="${notif.x + 12}" y="${notif.y - 10}" fill="#30d158" font-family="monospace" font-size="15" font-weight="bold">
            Notification Chamber (${notif.width}×${notif.height})
          </text>
        </g>
      </svg>
    `;
  }

  public refreshHudModeButtons(): void {
    const currentMode = this.sleepManager?.getMode() || this.clockEngine.getMode();
    const modes: Array<'active' | 'silent' | 'night' | 'sleep'> = [
      'active',
      'silent',
      'night',
      'sleep'
    ];
    for (const m of modes) {
      const btn = this.panelElement.querySelector(`#btn-mode-${m}`);
      if (btn) {
        btn.classList.toggle('active', currentMode === m);
      }
    }
  }

  public toggleHUD(): void {
    this.isVisible = !this.isVisible;
    this.panelElement.classList.toggle('hidden', !this.isVisible);
  }

  public updateWSStatus(status: WSStatus, url?: string): void {
    const wsEl = this.panelElement.querySelector('#debug-ws-readout') as HTMLElement | null;
    if (wsEl) {
      wsEl.textContent = status.toUpperCase();
      if (status === 'connected') {
        wsEl.style.color = '#30d158';
      } else if (status === 'connecting' || status === 'reconnecting') {
        wsEl.style.color = '#ffd60a';
      } else {
        wsEl.style.color = '#ff453a';
      }
      if (url) {
        wsEl.setAttribute('title', url);
      }
    }
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        this.toggleHUD();
      } else if ((e.key === 't' || e.key === 'T') && this.themeManager) {
        e.preventDefault();
        const ids = this.themeManager.getAvailableThemeIds();
        const currentId = this.themeManager.getActiveThemeId();
        const idx = ids.indexOf(currentId);
        const nextId = ids[(idx + 1) % ids.length] || 'pcb_2049';
        this.themeManager.setTheme(nextId);
      }

    });
  }
}
