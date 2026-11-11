import { ClockEngine } from './clockEngine';
import { NotificationManager } from './notificationManager';
import { ThemeLoader } from './themeLoader';
import { HandMode, NotificationPayload } from '../types/theme';

export type WSStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WSClientOptions {
  url?: string;
  clockEngine: ClockEngine;
  notificationManager: NotificationManager;
  themeLoader: ThemeLoader;
  onStatusChange?: (status: WSStatus, url: string) => void;
}

export interface BackendInitMessage {
  type: 'init';
  connected: boolean;
  version: string;
  config: {
    theme?: string;
    sleepOverride?: boolean;
    mode?: HandMode;
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
  category?: 'alert' | 'info' | 'doorbell' | 'calendar' | 'weather';
  timestamp?: string;
}

export interface BackendConfigMessage {
  type: 'config';
  theme?: string;
  sleepOverride?: boolean;
  mode?: HandMode;
  timestamp?: string;
}

export type BackendIncomingMessage = BackendInitMessage | BackendNotifyMessage | BackendConfigMessage;

export class ClockWebSocketClient {
  public static readonly DEFAULT_WS_URL = 'ws://192.168.0.69:8088/ws';

  private url: string;
  private socket: WebSocket | null = null;
  private clockEngine: ClockEngine;
  private notificationManager: NotificationManager;
  private themeLoader: ThemeLoader;
  private onStatusChangeCallback?: (status: WSStatus, url: string) => void;

  private status: WSStatus = 'disconnected';
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private initialConnectedNotified = false;

  constructor(options: WSClientOptions) {
    this.clockEngine = options.clockEngine;
    this.notificationManager = options.notificationManager;
    this.themeLoader = options.themeLoader;
    this.onStatusChangeCallback = options.onStatusChange;

    // Priority: Explicit option -> URL query param ?ws= -> Default
    const queryWs = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('ws')
      : null;

    this.url = options.url || queryWs || ClockWebSocketClient.DEFAULT_WS_URL;
  }

  /**
   * Initiates the WebSocket connection to the backend daemon
   */
  public connect(newUrl?: string): void {
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

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.setStatus('connected');
    console.log(`[Clock WS] Successfully connected to ${this.url}`);

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

  private processMessage(msg: BackendIncomingMessage): void {
    console.log('[Clock WS] Received message:', msg);

    switch (msg.type) {
      case 'init': {
        console.log(`[Clock WS] Server init response: v${msg.version}`);
        if (msg.config) {
          if (msg.config.mode && (msg.config.mode === 'tick' || msg.config.mode === 'sweep')) {
            this.clockEngine.setSecondMode(msg.config.mode);
          }
          if (msg.config.theme) {
            this.applyThemeIfChanged(msg.config.theme);
          }
        }
        break;
      }

      case 'notify': {
        const priority = msg.priority || 'normal';
        let category = msg.category;
        if (!category) {
          category = priority === 'urgent' ? 'alert' : 'info';
        }

        const duration = msg.durationMs || msg.timeoutMs || 8000;
        const payload: NotificationPayload = {
          id: msg.id,
          title: msg.title || (priority === 'urgent' ? 'Security Alert' : 'Notification'),
          message: msg.message || '',
          category,
          timeoutMs: duration,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
        };

        this.notificationManager.notify(payload);
        break;
      }

      case 'config': {
        if (msg.mode && (msg.mode === 'tick' || msg.mode === 'sweep')) {
          this.clockEngine.setSecondMode(msg.mode);
        }
        if (msg.theme) {
          this.applyThemeIfChanged(msg.theme);
        }
        break;
      }

      default:
        console.log('[Clock WS] Unknown message type:', msg);
    }
  }

  private async applyThemeIfChanged(themeName: string): Promise<void> {
    const current = this.themeLoader.getManifest();
    if (current && current.name.toLowerCase() === themeName.toLowerCase()) {
      return;
    }

    try {
      console.log(`[Clock WS] Switching theme to '${themeName}'...`);
      const manifest = await this.themeLoader.loadTheme(`/themes/${themeName}/theme.json`);
      this.clockEngine.setManifest(manifest);
    } catch (err) {
      console.error(`[Clock WS] Failed to switch theme to '${themeName}':`, err);
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
    const delay = Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts)) + Math.random() * 500;
    this.reconnectAttempts++;

    this.setStatus('reconnecting');
    console.log(`[Clock WS] Scheduling reconnect in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);

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
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status, this.url);
    }
  }
}

