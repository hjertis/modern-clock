import { ThemeManifest } from '../types/theme';
import { ClockEngine } from './clockEngine';
import { ThemeLoader } from './themeLoader';
import { NotificationManager } from './notificationManager';

export class DebugOverlay {
  private container: HTMLElement;
  private crosshairsLayer: HTMLElement;
  private panelElement!: HTMLElement;
  private clockEngine: ClockEngine;
  private themeLoader: ThemeLoader;
  private notificationManager: NotificationManager;
  private isVisible = true;
  private showCrosshairs = true;

  constructor(
    container: HTMLElement,
    crosshairsLayer: HTMLElement,
    clockEngine: ClockEngine,
    themeLoader: ThemeLoader,
    notificationManager: NotificationManager
  ) {
    this.container = container;
    this.crosshairsLayer = crosshairsLayer;
    this.clockEngine = clockEngine;
    this.themeLoader = themeLoader;
    this.notificationManager = notificationManager;

    this.initPanel();
    this.setupKeyboardShortcuts();
    this.updateCrosshairs();
  }

  private initPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'debug-hud-panel';
    panel.className = 'debug-panel';
    this.panelElement = panel;

    const manifest = this.themeLoader.getManifest();
    if (!manifest) return;

    this.renderPanelContent(manifest);
    this.container.appendChild(panel);

    // Subscribe to clock tick for live clock readout
    const timeDisplay = panel.querySelector('#debug-time-readout');
    const pendulumDisplay = panel.querySelector('#debug-pendulum-readout');

    this.clockEngine.addOnTickListener((currentDate, pendulumAngle) => {
      if (!this.isVisible) return;
      if (timeDisplay) {
        timeDisplay.textContent = currentDate.toLocaleTimeString() + '.' + String(currentDate.getMilliseconds()).padStart(3, '0');
      }
      if (pendulumDisplay) {
        pendulumDisplay.textContent = `${pendulumAngle > 0 ? '+' : ''}${pendulumAngle.toFixed(2)}°`;
      }
    });
  }

  private renderPanelContent(manifest: ThemeManifest): void {
    this.panelElement.innerHTML = `
      <div class="debug-header">
        <div class="debug-title">
          <span class="debug-badge">DEV HUD</span>
          <h3>Grandfather Clock Calibration</h3>
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
            <span class="stat-label">Mode</span>
            <span id="debug-mode-readout" class="stat-value font-mono">${this.clockEngine.getSecondMode().toUpperCase()}</span>
          </div>
        </div>

        <!-- Quick Action Buttons -->
        <div class="debug-section">
          <div class="section-title">Quick Actions</div>
          <div class="debug-button-grid">
            <button id="btn-doorbell" class="debug-btn debug-btn-accent">
              🔔 Simulate Doorbell
            </button>
            <button id="btn-toggle-mode" class="debug-btn">
              ⏱ Toggle Tick / Sweep
            </button>
            <button id="btn-fast-forward" class="debug-btn">
              ⏩ 10x Fast-Forward
            </button>
            <button id="btn-copy-manifest" class="debug-btn">
              📋 Copy theme.json
            </button>
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
          <div class="section-title">Hand Pivots (Local SVG Coordinates)</div>
          <div class="control-group-box">
            <div class="box-subtitle">Hour Hand Pivot</div>
            <div class="control-row compact">
              <label>X</label>
              <input type="number" id="num-hour-x" class="control-num" value="${manifest.hands.hour.pivot.x}" />
              <label>Y</label>
              <input type="number" id="num-hour-y" class="control-num" value="${manifest.hands.hour.pivot.y}" />
            </div>
          </div>
          <div class="control-group-box">
            <div class="box-subtitle">Minute Hand Pivot</div>
            <div class="control-row compact">
              <label>X</label>
              <input type="number" id="num-minute-x" class="control-num" value="${manifest.hands.minute.pivot.x}" />
              <label>Y</label>
              <input type="number" id="num-minute-y" class="control-num" value="${manifest.hands.minute.pivot.y}" />
            </div>
          </div>
          <div class="control-group-box">
            <div class="box-subtitle">Second Hand Pivot</div>
            <div class="control-row compact">
              <label>X</label>
              <input type="number" id="num-second-x" class="control-num" value="${manifest.hands.second.pivot.x}" />
              <label>Y</label>
              <input type="number" id="num-second-y" class="control-num" value="${manifest.hands.second.pivot.y}" />
            </div>
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
            <label>Anchor X (SVG)</label>
            <input type="number" id="num-pend-anchor-x" class="control-num" value="${manifest.pendulum.anchor.x}" />
            <label>Anchor Y (SVG)</label>
            <input type="number" id="num-pend-anchor-y" class="control-num" value="${manifest.pendulum.anchor.y}" />
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
        <span class="shortcut-tip">Press <kbd>H</kbd> to toggle HUD</span>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const manifest = this.themeLoader.getManifest();
    if (!manifest) return;

    // Toggle crosshairs button
    const btnCrosshairs = this.panelElement.querySelector('#btn-toggle-crosshairs') as HTMLButtonElement;
    if (btnCrosshairs) {
      btnCrosshairs.addEventListener('click', () => {
        this.showCrosshairs = !this.showCrosshairs;
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
          title: 'Front Doorbell',
          message: 'Motion detected at front entrance — package arrived.',
          timeoutMs: 6500
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
    const btnFastForward = this.panelElement.querySelector('#btn-fast-forward') as HTMLButtonElement;
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

    // Copy manifest button
    const btnCopy = this.panelElement.querySelector('#btn-copy-manifest');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const json = JSON.stringify(manifest, null, 2);
        navigator.clipboard.writeText(json).then(() => {
          btnCopy.textContent = '✓ Copied to Clipboard!';
          setTimeout(() => {
            btnCopy.textContent = '📋 Copy theme.json';
          }, 2000);
        });
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
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };

    const syncDialY = (val: number) => {
      manifest.dial.center.y = val;
      inputDialY.value = String(val);
      numDialY.value = String(val);
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };

    inputDialX?.addEventListener('input', (e) => syncDialX(Number((e.target as HTMLInputElement).value)));
    numDialX?.addEventListener('change', (e) => syncDialX(Number((e.target as HTMLInputElement).value)));
    inputDialY?.addEventListener('input', (e) => syncDialY(Number((e.target as HTMLInputElement).value)));
    numDialY?.addEventListener('change', (e) => syncDialY(Number((e.target as HTMLInputElement).value)));

    // Hour Hand Pivot
    const numHourX = this.panelElement.querySelector('#num-hour-x') as HTMLInputElement;
    const numHourY = this.panelElement.querySelector('#num-hour-y') as HTMLInputElement;
    const updateHour = () => {
      manifest.hands.hour.pivot.x = Number(numHourX.value);
      manifest.hands.hour.pivot.y = Number(numHourY.value);
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };
    numHourX?.addEventListener('change', updateHour);
    numHourY?.addEventListener('change', updateHour);

    // Minute Hand Pivot
    const numMinX = this.panelElement.querySelector('#num-minute-x') as HTMLInputElement;
    const numMinY = this.panelElement.querySelector('#num-minute-y') as HTMLInputElement;
    const updateMinute = () => {
      manifest.hands.minute.pivot.x = Number(numMinX.value);
      manifest.hands.minute.pivot.y = Number(numMinY.value);
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };
    numMinX?.addEventListener('change', updateMinute);
    numMinY?.addEventListener('change', updateMinute);

    // Second Hand Pivot
    const numSecX = this.panelElement.querySelector('#num-second-x') as HTMLInputElement;
    const numSecY = this.panelElement.querySelector('#num-second-y') as HTMLInputElement;
    const updateSecond = () => {
      manifest.hands.second.pivot.x = Number(numSecX.value);
      manifest.hands.second.pivot.y = Number(numSecY.value);
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };
    numSecX?.addEventListener('change', updateSecond);
    numSecY?.addEventListener('change', updateSecond);

    // Pendulum Inputs
    const numPendPivotX = this.panelElement.querySelector('#num-pend-pivot-x') as HTMLInputElement;
    const numPendPivotY = this.panelElement.querySelector('#num-pend-pivot-y') as HTMLInputElement;
    const numPendAnchorX = this.panelElement.querySelector('#num-pend-anchor-x') as HTMLInputElement;
    const numPendAnchorY = this.panelElement.querySelector('#num-pend-anchor-y') as HTMLInputElement;
    const numPendPeriod = this.panelElement.querySelector('#num-pend-period') as HTMLInputElement;
    const numPendAngle = this.panelElement.querySelector('#num-pend-angle') as HTMLInputElement;

    const updatePendulum = () => {
      manifest.pendulum.pivot.x = Number(numPendPivotX.value);
      manifest.pendulum.pivot.y = Number(numPendPivotY.value);
      manifest.pendulum.anchor.x = Number(numPendAnchorX.value);
      manifest.pendulum.anchor.y = Number(numPendAnchorY.value);
      manifest.pendulum.periodSeconds = Number(numPendPeriod.value);
      manifest.pendulum.maxAngleDeg = Number(numPendAngle.value);
      this.themeLoader.applyPlacement();
      this.updateCrosshairs();
    };

    numPendPivotX?.addEventListener('change', updatePendulum);
    numPendPivotY?.addEventListener('change', updatePendulum);
    numPendAnchorX?.addEventListener('change', updatePendulum);
    numPendAnchorY?.addEventListener('change', updatePendulum);
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

    const manifest = this.themeLoader.getManifest();
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

  public toggleHUD(): void {
    this.isVisible = !this.isVisible;
    this.panelElement.classList.toggle('hidden', !this.isVisible);
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      // Toggle HUD on 'H' or 'h' (unless inside an input field)
      if (e.key === 'h' || e.key === 'H') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          this.toggleHUD();
        }
      }
    });
  }
}

