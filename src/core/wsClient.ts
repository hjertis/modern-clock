import { ClockEngine } from './clockEngine';
import { NotificationManager } from './notificationManager';
import { ThemeLoader } from './themeLoader';
import { ThemeManager } from '../themes/themeManager';
import { ClockAudioEngine } from './audioEngine';
import { SleepManager, TimeSchedule } from './sleepManager';
import { HandMode, NotificationPayload, ClockMode } from '../types/theme';
import { DisplayOptions, HourFormat } from './timeFormatter';

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WSClientOptions {
  url?: string;
  clockEngine: ClockEngine;
  notificationManager: NotificationManager;
  audioEngine?: ClockAudioEngine;
  sleepManager?: SleepManager;
  themeManager?: ThemeManager;
  themeLoader?: ThemeLoader;
  onStatusChange?: (status: WSStatus, url: string) => void;
}

export interface SetModeActionMessage {
  action: 'set_mode';
  mode: ClockMode;
}

export interface SetScheduleActionMessage {
  action: 'set_schedule';
  schedule?: Partial<TimeSchedule>;
  nightStart?: string;
  sleepStart?: string;
  wakeTime?: string;
  silentStart?: string;
  enabled?: boolean;
}

export interface WakeActionMessage {
  action: 'wake';
}

export interface BackendInitMessage {
  type: 'init';
  connected: boolean;
  version: string;
  config: {
    theme?: string;
    theme_id?: string;
    sleepOverride?: boolean;
    mode?: HandMode;
    muted?: boolean;
    volume?: number;
    chimes?: boolean;
  };
}

export interface BackendNotifyMessage {
  type: 'notify';
  id?: string;
  title: string;
  message: string;
  priority?: 'normal' | 'urgent';
  durationMs?: number;
  timeoutMs?: number;
  category?: 'alert' | 'info' | 'doorbell' | 'securityAlert' | 'calendar' | 'weather';
  timestamp?: string;
}

export interface BackendConfigMessage {
  type: 'config';
  theme?: string;
  theme_id?: string;
  sleepOverride?: boolean;
  mode?: HandMode;
  muted?: boolean;
  volume?: number;
  chimes?: boolean;
  timestamp?: string;
}

export interface SetThemeActionMessage {
  action: 'set_theme';
  theme_id: string;
  theme?: string;
}

export interface SetAudioActionMessage {
  action: 'set_audio';
  muted?: boolean;
  volume?: number;
  chimes?: boolean;
}

export interface SetDisplayOptionsActionMessage {
  action: 'set_display_options';
  hourFormat?: HourFormat;
  hour_format?: HourFormat;
  showSeconds?: boolean;
  show_seconds?: boolean;
  showDate?: boolean;
  show_date?: boolean;
  options?: Partial<DisplayOptions>;
}

export type BackendIncomingMessage =
  | BackendInitMessage
  | BackendNotifyMessage
  | BackendConfigMessage
  | SetThemeActionMessage
  | SetAudioActionMessage
  | SetDisplayOptionsActionMessage
  | SetModeActionMessage
  | SetScheduleActionMessage
  | WakeActionMessage;

export class ClockWebSocketClient {
  public static getDefaultWsUrl(): string {
    if (typeof window !== 'undefined' && window.location?.host) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://127.0.0.1:8088/ws';
  }

  public static get DEFAULT_WS_URL(): string {
    return ClockWebSocketClient.getDefaultWsUrl();
  }

  private url: string;
  private socket: WebSocket | null = null;
  private clockEngine: ClockEngine;
  private notificationManager: NotificationManager;
  private audioEngine?: ClockAudioEngine;
  private sleepManager?: SleepManager;
  private themeManager?: ThemeManager;
  private themeLoader?: ThemeLoader;
  private onStatusChangeCallback?: (status: WSStatus, url: string) => void;

  private status: WSStatus = 'disconnected';
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private initialConnectedNotified = false;

  constructor(options: WSClientOptions) {
    this.clockEngine = options.clockEngine;
    this.notificationManager = options.notificationManager;
    this.audioEngine = options.audioEngine;
    this.themeManager = options.themeManager;
    this.themeLoader = options.themeLoader;
    this.onStatusChangeCallback = options.onStatusChange;

    if (options.sleepManager) {
      this.setSleepManager(options.sleepManager);
    }

    if (options.themeManager) {
      this.setThemeManager(options.themeManager);
    }

    // Priority: Explicit option -> URL query param ?ws= -> VITE_WS_URL -> Dynamic default
    const queryWs =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('ws')
        : null;

    const envWs =
      typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_WS_URL
        ? (import.meta.env.VITE_WS_URL as string)
        : null;

    const proto =
      typeof window !== 'undefined' && window.location?.protocol === 'https:' ? 'wss:' : 'ws:';
    const defaultWsUrl =
      typeof window !== 'undefined' && window.location?.host
        ? `${proto}//${window.location.host}/ws`
        : 'ws://127.0.0.1:8088/ws';

    this.url = options.url || queryWs || envWs || defaultWsUrl;
  }

  public static isDemoMode(): boolean {
    const envDemo =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_STATIC_DEMO === 'true';
    const queryDemo =
      typeof window !== 'undefined' &&
      typeof window.location?.search === 'string' &&
      new URLSearchParams(window.location.search).get('demo') === '1';
    return Boolean(envDemo || queryDemo);
  }

  /**
   * Initiates the WebSocket connection to the backend daemon
   */
  public connect(newUrl?: string): void {
    if (ClockWebSocketClient.isDemoMode() && !newUrl) {
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.setStatus('disconnected');
      return;
    }

    if (newUrl) {
      this.url = newUrl;
    }

    this.shouldReconnect = true;
    this.clearReconnectTimer();

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore closing errors
      }
      this.socket = null;
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    console.log(`[Clock WS] Connecting to ${this.url} (attempt ${this.reconnectAttempts + 1})...`);

    try {
      this.socket = new WebSocket(this.url);
      this.socket.binaryType = 'blob';

      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onerror = this.handleError.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
    } catch (err) {
      console.error('[Clock WS] Failed to construct WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Closes the active socket and stops automatic reconnection
   */
  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.socket) {
      try {
        this.socket.close(1000, 'Client requested disconnect');
      } catch {
        // Ignore
      }
      this.socket = null;
    }

    this.setStatus('disconnected');
    console.log('[Clock WS] Disconnected.');
  }

  public getStatus(): WSStatus {
    return this.status;
  }

  public getUrl(): string {
    return this.url;
  }

  public isConnected(): boolean {
    return this.status === 'connected' && this.socket?.readyState === WebSocket.OPEN;
  }

  public setAudioEngine(audioEngine: ClockAudioEngine): void {
    this.audioEngine = audioEngine;
  }

  public getAudioEngine(): ClockAudioEngine | undefined {
    return this.audioEngine;
  }

  public setSleepManager(sleepManager: SleepManager): void {
    this.sleepManager = sleepManager;
    sleepManager.onModeChange(() => {
      this.broadcastModeState();
    });
    sleepManager.onScheduleChange(() => {
      this.broadcastModeState();
    });
  }

  public getSleepManager(): SleepManager | undefined {
    return this.sleepManager;
  }

  public setThemeManager(themeManager: ThemeManager): void {
    this.themeManager = themeManager;
    themeManager.onThemeRegistryChange(() => {
      this.broadcastThemesRegistration();
    });
    themeManager.onThemeChange(() => {
      this.broadcastThemesRegistration();
    });
  }

  public getThemeManager(): ThemeManager | undefined {
    return this.themeManager;
  }

  /**
   * Broadcasts the list of registered frontend themes to the backend daemon
   * so Home Assistant dynamic MQTT discovery stays fully synchronized.
   */
  public broadcastThemesRegistration(): void {
    if (!this.isConnected() || !this.themeManager) return;
    const themes = this.themeManager.getAvailableThemeIds();
    const activeTheme = this.themeManager.getActiveThemeId();
    const metadata = this.themeManager.getAvailableThemes();
    const payload = {
      type: 'register_themes',
      themes,
      activeTheme,
      metadata,
      timestamp: new Date().toISOString()
    };
    console.log('[Clock WS] Registering available themes with backend:', payload);
    this.send(payload);
  }

  /**
   * Broadcasts the current mode, schedule, and presence state back over WebSocket
   * so Home Assistant and backend daemon stay synchronized.
   */
  public broadcastModeState(): void {
    if (!this.isConnected() || !this.sleepManager) return;
    const state = this.sleepManager.getState();
    const payload = {
      type: 'mode_changed',
      mode: state.mode,
      isSleeping: state.isSleeping,
      sleepOverride: state.isManualOverride,
      manualOverrideMode: state.manualOverrideMode,
      schedule: state.schedule,
      nightDimLevel: state.nightDimLevel,
      sleepOpacity: state.sleepOpacity,
      dampingFactor: state.dampingFactor,
      timestamp: new Date().toISOString()
    };
    console.log('[Clock WS] Broadcasting state change to backend:', payload);
    this.send(payload);
  }

  /**
   * Send JSON message to backend daemon if needed
   */
  public send(data: unknown): boolean {
    if (!this.isConnected() || !this.socket) {
      console.warn('[Clock WS] Cannot send message, socket not connected');
      return false;
    }
    try {
      this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[Clock WS] Error sending payload:', err);
      return false;
    }
  }

  /**
   * Processes an inbound JSON message (either from WebSocket or simulated test dispatch)
   */
  public processMessage(msg: BackendIncomingMessage | Record<string, unknown>): void {
    console.log('[Clock WS] Received message:', msg);

    // 1. Handle `{ "action": "set_theme", "theme_id": "pcb_2049" }`
    if ('action' in msg && msg.action === 'set_theme') {
      const targetTheme =
        (typeof msg.theme_id === 'string' && msg.theme_id) ||
        (typeof msg.theme === 'string' && msg.theme);
      if (targetTheme) {
        this.applyThemeIfChanged(targetTheme, true);
      }
      return;
    }

    // 2. Handle `{ "action": "set_audio", "muted": bool, "volume": number, "chimes": bool }`
    if (
      ('action' in msg && msg.action === 'set_audio') ||
      ('type' in msg && (msg.type === 'set_audio' || msg.type === 'audio'))
    ) {
      const audioMsg = msg as {
        action?: string;
        type?: string;
        muted?: boolean;
        volume?: number;
        chimes?: boolean;
      };
      if (this.audioEngine) {
        if (typeof audioMsg.muted === 'boolean') {
          this.audioEngine.setMuted(audioMsg.muted);
        }
        if (typeof audioMsg.volume === 'number') {
          this.audioEngine.setVolume(audioMsg.volume);
        }
        if (typeof audioMsg.chimes === 'boolean') {
          this.audioEngine.setChimesEnabled(audioMsg.chimes);
        }
        console.log('[Clock WS] Audio settings updated:', this.audioEngine.getState());
      }
      return;
    }

    // 3. Handle `{ "action": "set_mode", "mode": "active" | "silent" | "night" | "sleep" }`
    if (
      ('action' in msg && msg.action === 'set_mode') ||
      ('type' in msg && msg.type === 'set_mode')
    ) {
      const mode = (msg as { mode?: ClockMode }).mode;
      if (mode && ['active', 'silent', 'night', 'sleep'].includes(mode)) {
        console.log(`[Clock WS] Setting mode to '${mode}' via remote command.`);
        this.sleepManager?.setMode(mode, true);
        this.broadcastModeState();
      }
      return;
    }

    // 4. Handle `{ "action": "wake" }`
    if (
      ('action' in msg && msg.action === 'wake') ||
      ('type' in msg && msg.type === 'wake')
    ) {
      console.log('[Clock WS] Remote wake command received.');
      this.sleepManager?.wake('remote');
      this.broadcastModeState();
      return;
    }

    // 5. Handle `{ "action": "set_schedule", ... }`
    if (
      ('action' in msg && msg.action === 'set_schedule') ||
      ('type' in msg && msg.type === 'set_schedule')
    ) {
      const schedMsg = msg as SetScheduleActionMessage;
      const schedPayload = schedMsg.schedule || {
        nightStart: schedMsg.nightStart,
        sleepStart: schedMsg.sleepStart,
        wakeTime: schedMsg.wakeTime,
        silentStart: schedMsg.silentStart,
        enabled: schedMsg.enabled
      };
      console.log('[Clock WS] Setting schedule via remote command:', schedPayload);
      this.sleepManager?.setSchedule(schedPayload);
      this.broadcastModeState();
      return;
    }

    // 6. Handle `{ "action": "test_chime" }` or `{ "action": "chime" }`
    if (
      ('action' in msg &&
        (msg.action === 'test_chime' || msg.action === 'chime' || msg.action === 'play_chime')) ||
      ('type' in msg && (msg.type === 'test_chime' || msg.type === 'chime'))
    ) {
      console.log('[Clock WS] Remote test chime received.');
      if (this.audioEngine) {
        this.audioEngine.unlock();
        this.audioEngine.onHour(new Date().getHours());
      }
      return;
    }

    // 7. Handle `{ "action": "set_display_options", "hourFormat": "24h" | "12h", "showSeconds": bool, "showDate": bool }`
    if (
      ('action' in msg && msg.action === 'set_display_options') ||
      ('type' in msg && msg.type === 'set_display_options')
    ) {
      const dispMsg = msg as SetDisplayOptionsActionMessage & Record<string, unknown>;
      const payload =
        dispMsg.options && typeof dispMsg.options === 'object' ? dispMsg.options : dispMsg;
      const updated = this.clockEngine.setDisplayOptions(payload);
      console.log('[Clock WS] Updated display options:', updated);
      return;
    }

    const typedMsg = msg as BackendIncomingMessage;
    if (!('type' in typedMsg)) return;

    switch (typedMsg.type) {
      case 'init': {
        console.log(`[Clock WS] Server init response: v${typedMsg.version}`);
        if (typedMsg.config) {
          if (
            typedMsg.config.mode &&
            (typedMsg.config.mode === 'tick' || typedMsg.config.mode === 'sweep')
          ) {
            this.clockEngine.setSecondMode(typedMsg.config.mode);
          }
          if (this.audioEngine) {
            if (typeof typedMsg.config.muted === 'boolean') {
              this.audioEngine.setMuted(typedMsg.config.muted);
            }
            if (typeof typedMsg.config.volume === 'number') {
              this.audioEngine.setVolume(typedMsg.config.volume);
            }
            if (typeof typedMsg.config.chimes === 'boolean') {
              this.audioEngine.setChimesEnabled(typedMsg.config.chimes);
            }
          }
          if (this.sleepManager && typeof typedMsg.config.sleepOverride === 'boolean') {
            if (typedMsg.config.sleepOverride) {
              this.sleepManager.setMode('sleep', true);
            } else {
              this.sleepManager.wake('remote');
            }
          }
          const initTheme = typedMsg.config.theme_id || typedMsg.config.theme;
          // Only override localStorage theme on init if backend was explicitly configured to a non-'default' theme
          if (initTheme && initTheme !== 'default') {
            this.applyThemeIfChanged(initTheme, false);
          }
        }
        break;
      }

      case 'notify': {
        const priority = typedMsg.priority || 'normal';
        let category = typedMsg.category;
        if (!category) {
          category = priority === 'urgent' ? 'alert' : 'info';
        }

        const rawDuration =
          typeof typedMsg.durationMs === 'number' && Number.isFinite(typedMsg.durationMs)
            ? typedMsg.durationMs
            : typeof typedMsg.timeoutMs === 'number' && Number.isFinite(typedMsg.timeoutMs)
              ? typedMsg.timeoutMs
              : 8000;
        const duration = Math.max(1000, Math.min(60000, Math.round(rawDuration)));
        const payload: NotificationPayload = {
          id: typedMsg.id,
          title: (typedMsg.title || (priority === 'urgent' ? 'Security Alert' : 'Notification')).slice(0, 120),
          message: (typedMsg.message || '').slice(0, 500),
          priority,
          category,
          timeoutMs: duration,
          timestamp: typedMsg.timestamp ? new Date(typedMsg.timestamp) : new Date()
        };

        this.notificationManager.notify(payload);
        break;
      }

      case 'config': {
        if (typedMsg.mode && (typedMsg.mode === 'tick' || typedMsg.mode === 'sweep')) {
          this.clockEngine.setSecondMode(typedMsg.mode);
        }
        if (this.audioEngine) {
          if (typeof typedMsg.muted === 'boolean') {
            this.audioEngine.setMuted(typedMsg.muted);
          }
          if (typeof typedMsg.volume === 'number') {
            this.audioEngine.setVolume(typedMsg.volume);
          }
          if (typeof typedMsg.chimes === 'boolean') {
            this.audioEngine.setChimesEnabled(typedMsg.chimes);
          }
        }
        if (this.sleepManager && typeof typedMsg.sleepOverride === 'boolean') {
          if (typedMsg.sleepOverride) {
            this.sleepManager.setMode('sleep', true);
          } else {
            this.sleepManager.wake('remote');
          }
        }
        const cfgTheme = typedMsg.theme_id || typedMsg.theme;
        if (cfgTheme) {
          this.applyThemeIfChanged(cfgTheme, true);
        }
        break;
      }

      default:
        if (this.themeManager) {
          this.themeManager.handleInboundMessage(msg as Record<string, unknown>);
        }
    }
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.setStatus('connected');
    console.log(`[Clock WS] Successfully connected to ${this.url}`);

    // Broadcast current mode & schedule state immediately on link establishment
    this.broadcastModeState();

    // Broadcast registered theme list to backend for dynamic Home Assistant discovery
    this.broadcastThemesRegistration();

    if (!this.initialConnectedNotified) {
      this.initialConnectedNotified = true;
      this.notificationManager.notify({
        category: 'info',
        title: 'Backend Linked',
        message: `Connected to daemon (${this.url.replace(/^ws:\/\//, '')})`,
        timeoutMs: 4000
      });
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;

    try {
      const data = JSON.parse(event.data) as BackendIncomingMessage;
      this.processMessage(data);
    } catch (err) {
      console.warn('[Clock WS] Failed to parse message JSON:', event.data, err);
    }
  }

  private async applyThemeIfChanged(themeId: string, forceTransition = false): Promise<void> {
    if (this.themeManager) {
      const resolved = this.themeManager.resolveThemeId(themeId);
      if (!forceTransition && this.themeManager.getActiveThemeId() === resolved) {
        return;
      }
      try {
        console.log(`[Clock WS] Switching theme via ThemeManager to '${resolved}'...`);
        await this.themeManager.setTheme(resolved);
      } catch (err) {
        console.error(`[Clock WS] Failed to switch theme to '${themeId}':`, err);
      }
      return;
    }

    if (this.themeLoader) {
      const current = this.themeLoader.getManifest();
      if (current && current.name.toLowerCase() === themeId.toLowerCase()) {
        return;
      }
      try {
        const base =
          (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || './';
        const normalizedBase = base.endsWith('/') ? base : `${base}/`;
        const manifest = await this.themeLoader.loadTheme(`${normalizedBase}themes/${themeId}/theme.json`);
        this.clockEngine.setManifest(manifest);
      } catch (err) {
        console.error(`[Clock WS] Failed to switch theme via ThemeLoader to '${themeId}':`, err);
      }
    }
  }

  private handleError(event: Event): void {
    console.warn('[Clock WS] Socket error encountered:', event);
  }

  private handleClose(event: CloseEvent): void {
    console.warn(`[Clock WS] Connection closed (code: ${event.code}, reason: "${event.reason}")`);
    this.socket = null;
    this.setStatus('disconnected');

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    // Exponential backoff: 1s, 2s, 3s, 5s... max 10s + jitter
    const delay =
      Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts)) + Math.random() * 500;
    this.reconnectAttempts++;

    this.setStatus('reconnecting');
    console.log(
      `[Clock WS] Scheduling reconnect in ${(delay / 1000).toFixed(1)}s (attempt ${
        this.reconnectAttempts
      })...`
    );

    this.reconnectTimer = window.setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: WSStatus): void {
    this.status = status;
    this.clockEngine.setWSStatus(status, this.url);
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status, this.url);
    }
  }
}
