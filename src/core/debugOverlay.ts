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
  private onVisibilityChange?: (visible: boolean) => void;
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
    sleepManager?: SleepManager,
    onVisibilityChange?: (visible: boolean) => void
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
    this.onVisibilityChange = onVisibilityChange;

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

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: {
      id?: string;
      className?: string;
      text?: string;
      title?: string;
      attrs?: Record<string, string>;
      style?: Partial<CSSStyleDeclaration>;
    },
    children?: Array<Node | null | undefined>
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (opts?.id) node.id = opts.id;
    if (opts?.className) node.className = opts.className;
    if (opts?.text !== undefined) node.textContent = opts.text;
    if (opts?.title) node.title = opts.title;
    if (opts?.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) {
        node.setAttribute(k, v);
      }
    }
    if (opts?.style) {
      Object.assign(node.style, opts.style);
    }
    if (children) {
      for (const child of children) {
        if (child) node.appendChild(child);
      }
    }
    return node;
  }

  private getThemeIcon(themeId: string): string {
    switch (themeId) {
      case 'pcb_2049':
        return '⚡ ';
      case 'pcb_2049_emerald':
        return '🟢 ';
      case 'nixie_hybrid':
        return '🔥 ';
      case 'tourbillon_3d':
        return '⚙️ ';
      case 'reactor_3d':
        return '☢️ ';
      case 'orrery_3d':
        return '🪐 ';
      case 'mariana_abyss':
        return '🌊 ';
      case 'vector_oscilloscope':
        return '📈 ';
      case 'hybrid_base':
        return '🎛️ ';
      default:
        return '🕰️ ';
    }
  }

  private renderPanelContent(manifest: ThemeManifest): void {
    const activeThemeId = this.themeManager?.getActiveThemeId() || 'pcb_2049';
    const availableThemes = this.themeManager?.getAvailableThemes() || [
      { id: 'pcb_2049', name: 'PCB-2049 / Industrial Silicon' },
      { id: 'vienna_classic', name: 'Vienna Classic' }
    ];

    const makeStat = (label: string, valueId: string, initialText: string) =>
      this.el('div', { className: 'debug-stat' }, [
        this.el('span', { className: 'stat-label', text: label }),
        this.el('span', { id: valueId, className: 'stat-value font-mono', text: initialText })
      ]);

    const makeSection = (titleEl: HTMLElement | string, ...content: HTMLElement[]) =>
      this.el('div', { className: 'debug-section' }, [
        typeof titleEl === 'string'
          ? this.el('div', { className: 'section-title', text: titleEl })
          : titleEl,
        ...content
      ]);

    const header = this.el('div', { className: 'debug-header' }, [
      this.el('div', { className: 'debug-title' }, [
        this.el('span', { className: 'debug-badge', text: 'DEV HUD' }),
        this.el('h3', { text: 'Clock Architecture & Calibration' })
      ]),
      this.el('div', { className: 'debug-actions-top' }, [
        this.el('button', {
          id: 'btn-toggle-crosshairs',
          className: `debug-btn-sm ${this.showCrosshairs ? 'active' : ''}`.trim(),
          text: `Crosshairs: ${this.showCrosshairs ? 'ON' : 'OFF'}`
        }),
        this.el('button', {
          id: 'btn-close-hud',
          className: 'debug-btn-icon',
          title: 'Hide HUD (Press H)',
          text: '✕'
        })
      ])
    ]);

    const statusRow = this.el('div', { className: 'debug-status-row' }, [
      makeStat('Simulated Time', 'debug-time-readout', '--:--:--.---'),
      makeStat('Pendulum θ', 'debug-pendulum-readout', '0.00°'),
      makeStat('Frame Rate', 'debug-fps-readout', '60.0 FPS'),
      makeStat('Mode', 'debug-mode-readout', this.clockEngine.getSecondMode().toUpperCase()),
      makeStat(
        'WebSocket',
        'debug-ws-readout',
        this.wsClient ? this.wsClient.getStatus().toUpperCase() : 'DISABLED'
      )
    ]);

    const themeGrid = this.el(
      'div',
      { className: 'debug-button-grid' },
      availableThemes.map((t) =>
        this.el('button', {
          className: `debug-btn theme-select-btn ${t.id === activeThemeId ? 'active' : ''}`.trim(),
          attrs: { 'data-theme-id': t.id },
          text: `${this.getThemeIcon(t.id)}${t.name}`
        })
      )
    );

    const activeSleepMode = this.sleepManager?.getMode();
    const modeGrid = this.el('div', { className: 'debug-button-grid' }, [
      this.el('button', {
        id: 'btn-mode-active',
        className: `debug-btn mode-btn ${activeSleepMode === 'active' ? 'active' : ''}`.trim(),
        text: '☀️ Active'
      }),
      this.el('button', {
        id: 'btn-mode-silent',
        className: `debug-btn mode-btn ${activeSleepMode === 'silent' ? 'active' : ''}`.trim(),
        text: '🤫 Silent'
      }),
      this.el('button', {
        id: 'btn-mode-night',
        className: `debug-btn mode-btn ${activeSleepMode === 'night' ? 'active' : ''}`.trim(),
        text: '🌙 Night (30 FPS)'
      }),
      this.el('button', {
        id: 'btn-mode-sleep',
        className: `debug-btn mode-btn ${activeSleepMode === 'sleep' ? 'active' : ''}`.trim(),
        text: '💤 Sleep (Cat-Safe 1 FPS)'
      })
    ]);

    const actionsGrid = this.el('div', { className: 'debug-button-grid' }, [
      this.el('button', {
        id: 'btn-doorbell',
        className: 'debug-btn debug-btn-accent',
        text: '🔔 Doorbell + Electron Pulse'
      }),
      this.el('button', {
        id: 'btn-urgent-alert',
        className: 'debug-btn debug-btn-danger',
        text: '🚨 Priority Security Alert'
      }),
      this.el('button', {
        id: 'btn-toggle-mode',
        className: 'debug-btn',
        text: '⏱ Toggle Tick / Sweep'
      }),
      this.el('button', {
        id: 'btn-fast-forward',
        className: 'debug-btn',
        text: '⏩ 10x Fast-Forward'
      })
    ]);

    const volumePct = Math.round((this.audioEngine?.getVolume() ?? 0.5) * 100);
    const audioGrid = this.el('div', { className: 'debug-button-grid' }, [
      this.el('button', {
        id: 'btn-toggle-mute',
        className: `debug-btn ${this.audioEngine?.getMuted() ? 'active' : ''}`.trim(),
        text: this.audioEngine?.getMuted() ? '🔇 Audio Muted' : '🔊 Audio Active'
      }),
      this.el('button', {
        id: 'btn-toggle-chimes',
        className: `debug-btn ${this.audioEngine?.getChimesEnabled() ? 'active' : ''}`.trim(),
        text: this.audioEngine?.getChimesEnabled() ? '🔔 Chimes: ON' : '🔕 Chimes: OFF'
      }),
      this.el('button', {
        id: 'btn-test-tick',
        className: 'debug-btn',
        text: '⏱ Test Escapement'
      }),
      this.el('button', {
        id: 'btn-test-chime',
        className: 'debug-btn',
        text: '🎵 Test Hour Chime'
      })
    ]);

    const volumeRow = this.el('div', { className: 'control-row', style: { marginTop: '8px' } }, [
      this.el('label', undefined, [
        document.createTextNode('Master Volume: '),
        this.el('span', { id: 'debug-volume-val', text: `${volumePct}%` })
      ]),
      this.el('input', {
        id: 'input-audio-volume',
        attrs: { type: 'range', min: '0', max: '100', value: String(volumePct) }
      })
    ]);

    const dialTitle = this.el(
      'div',
      {
        className: 'section-title',
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      },
      [
        this.el('span', { text: 'Dial Center (Canvas 1080×1920)' }),
        this.el('button', {
          id: 'btn-reset-dial-center',
          className: 'debug-btn',
          style: { padding: '2px 8px', fontSize: '11px' },
          text: 'Reset (540, 540)'
        })
      ]
    );

    const dialRowX = this.el('div', { className: 'control-row' }, [
      this.el('label', { text: 'Dial Center X' }),
      this.el('input', {
        id: 'input-dial-x',
        attrs: { type: 'range', min: '0', max: '1080', value: String(manifest.dial.center.x) }
      }),
      this.el('input', {
        id: 'num-dial-x',
        className: 'control-num',
        attrs: { type: 'number', min: '0', max: '1080', value: String(manifest.dial.center.x) }
      })
    ]);

    const dialRowY = this.el('div', { className: 'control-row' }, [
      this.el('label', { text: 'Dial Center Y' }),
      this.el('input', {
        id: 'input-dial-y',
        attrs: { type: 'range', min: '0', max: '1920', value: String(manifest.dial.center.y) }
      }),
      this.el('input', {
        id: 'num-dial-y',
        className: 'control-num',
        attrs: { type: 'number', min: '0', max: '1920', value: String(manifest.dial.center.y) }
      })
    ]);

    const pendRow1 = this.el('div', { className: 'control-row' }, [
      this.el('label', { text: 'Pivot X (Canvas)' }),
      this.el('input', {
        id: 'num-pend-pivot-x',
        className: 'control-num',
        attrs: { type: 'number', value: String(manifest.pendulum.pivot.x) }
      }),
      this.el('label', { text: 'Pivot Y (Canvas)' }),
      this.el('input', {
        id: 'num-pend-pivot-y',
        className: 'control-num',
        attrs: { type: 'number', value: String(manifest.pendulum.pivot.y) }
      })
    ]);

    const pendRow2 = this.el('div', { className: 'control-row' }, [
      this.el('label', { text: 'Period T (sec)' }),
      this.el('input', {
        id: 'num-pend-period',
        className: 'control-num',
        attrs: { type: 'number', step: '0.1', value: String(manifest.pendulum.periodSeconds) }
      }),
      this.el('label', { text: 'Max θ (deg)' }),
      this.el('input', {
        id: 'num-pend-angle',
        className: 'control-num',
        attrs: { type: 'number', step: '0.5', value: String(manifest.pendulum.maxAngleDeg) }
      })
    ]);

    const body = this.el('div', { className: 'debug-body' }, [
      statusRow,
      makeSection('Active Theme Engine', themeGrid),
      makeSection('Power & Presence States', modeGrid),
      makeSection('Reactive Telemetry & Actions', actionsGrid),
      makeSection('Procedural Web Audio Engine (Zero External Audio)', audioGrid, volumeRow),
      makeSection(dialTitle, dialRowX, dialRowY),
      makeSection('Pendulum Physics & Hinge', pendRow1, pendRow2)
    ]);

    const footer = this.el('div', { className: 'debug-footer' }, [
      this.el('span', { className: 'shortcut-tip' }, [
        document.createTextNode('Press '),
        this.el('kbd', { text: 'H' }),
        document.createTextNode(' to toggle HUD  •  '),
        this.el('kbd', { text: 'T' }),
        document.createTextNode(' to switch Theme')
      ])
    ]);

    this.panelElement.replaceChildren(header, body, footer);
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

    const btnResetDialCenter = this.panelElement.querySelector('#btn-reset-dial-center');
    btnResetDialCenter?.addEventListener('click', () => {
      syncDialX(540);
      syncDialY(540);
    });

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
      this.crosshairsLayer.replaceChildren();
      return;
    }

    const manifest = this.getActiveManifest();
    if (!manifest) return;

    const dialX = manifest.dial.center.x;
    const dialY = manifest.dial.center.y;
    const pendPivotX = manifest.pendulum.pivot.x;
    const pendPivotY = manifest.pendulum.pivot.y;
    const notif = manifest.notificationZone;

    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const node = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
      }
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const svg = svgEl('svg', {
      viewBox: '0 0 1080 1920',
      width: 1080,
      height: 1920,
      style: 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;'
    });

    const dialGroup = svgEl('g', { id: 'debug-dial-crosshair' });
    dialGroup.append(
      svgEl('line', { x1: dialX - 40, y1: dialY, x2: dialX + 40, y2: dialY, stroke: '#ff3b30', 'stroke-width': 2 }),
      svgEl('line', { x1: dialX, y1: dialY - 40, x2: dialX, y2: dialY + 40, stroke: '#ff3b30', 'stroke-width': 2 }),
      svgEl('circle', { cx: dialX, cy: dialY, r: 6, fill: '#ff3b30' }),
      svgEl('circle', { cx: dialX, cy: dialY, r: 24, stroke: '#ff3b30', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', fill: 'none' }),
      svgEl('text', { x: dialX + 32, y: dialY - 14, fill: '#ff3b30', 'font-family': 'monospace', 'font-size': 16, 'font-weight': 'bold' }, `Dial Center (${dialX}, ${dialY})`)
    );

    const pendGroup = svgEl('g', { id: 'debug-pendulum-pivot' });
    pendGroup.append(
      svgEl('line', { x1: pendPivotX - 30, y1: pendPivotY, x2: pendPivotX + 30, y2: pendPivotY, stroke: '#ff9500', 'stroke-width': 2 }),
      svgEl('line', { x1: pendPivotX, y1: pendPivotY - 30, x2: pendPivotX, y2: pendPivotY + 30, stroke: '#ff9500', 'stroke-width': 2 }),
      svgEl('circle', { cx: pendPivotX, cy: pendPivotY, r: 5, fill: '#ff9500' }),
      svgEl('text', { x: pendPivotX + 36, y: pendPivotY + 5, fill: '#ff9500', 'font-family': 'monospace', 'font-size': 16, 'font-weight': 'bold' }, `Pendulum Pivot (${pendPivotX}, ${pendPivotY})`)
    );

    const notifGroup = svgEl('g', { id: 'debug-notif-outline' });
    notifGroup.append(
      svgEl('rect', { x: notif.x, y: notif.y, width: notif.width, height: notif.height, fill: 'none', stroke: '#30d158', 'stroke-width': 2, 'stroke-dasharray': '6 4', opacity: 0.8 }),
      svgEl('text', { x: notif.x + 12, y: notif.y - 10, fill: '#30d158', 'font-family': 'monospace', 'font-size': 15, 'font-weight': 'bold' }, `Notification Chamber (${notif.width}×${notif.height})`)
    );

    svg.append(dialGroup, pendGroup, notifGroup);
    this.crosshairsLayer.replaceChildren(svg);
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
    this.onVisibilityChange?.(this.isVisible);
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
