import { NotificationPayload, ClockMode } from '../types/theme';
import { ThemeEvent } from '../themes/types';
import { ClockAudioEngine } from './audioEngine';
import type { SleepManager } from './sleepManager';

const MAX_TITLE_CHARS = 120;
const MAX_MESSAGE_CHARS = 500;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_TIMEOUT_MS = 6000;

export class NotificationManager {
  private zoneElement: HTMLElement;
  private pendulumElement: HTMLElement | null;
  private audioEngine: ClockAudioEngine | null = null;
  private sleepManager: SleepManager | null = null;
  private activeNotifications: Map<
    string,
    { element: HTMLElement; timerId: number | null; isCriticalWake: boolean }
  > = new Map();
  private queuedNotifications: NotificationPayload[] = [];
  private clockMode: ClockMode = 'active';
  private notificationCounter = 0;
  private onEventListeners: Array<(event: ThemeEvent) => void> = [];

  constructor(
    zoneElement: HTMLElement,
    pendulumElement?: HTMLElement | null,
    audioEngine?: ClockAudioEngine | null,
    sleepManager?: SleepManager | null
  ) {
    this.zoneElement = zoneElement;
    this.pendulumElement = pendulumElement || null;
    this.audioEngine = audioEngine || null;
    this.sleepManager = sleepManager || null;
  }

  public setSleepManager(sleepManager: SleepManager | null): void {
    this.sleepManager = sleepManager;
  }

  public setAudioEngine(audioEngine: ClockAudioEngine): void {
    this.audioEngine = audioEngine;
  }

  public getAudioEngine(): ClockAudioEngine | null {
    return this.audioEngine;
  }

  public addEventListener(listener: (event: ThemeEvent) => void): () => void {
    this.onEventListeners.push(listener);
    return () => {
      this.onEventListeners = this.onEventListeners.filter((l) => l !== listener);
    };
  }

  public setMode(mode: ClockMode): void {
    const prevMode = this.clockMode;
    this.clockMode = mode;
    this.zoneElement.setAttribute?.('data-presence-mode', mode);
    if (
      (prevMode === 'night' || prevMode === 'sleep') &&
      (mode === 'active' || mode === 'silent')
    ) {
      this.flushQueue();
    }
  }

  public getMode(): ClockMode {
    return this.clockMode;
  }

  public flushQueue(): NotificationPayload[] {
    const queued = [...this.queuedNotifications];
    this.queuedNotifications = [];
    for (const item of queued) {
      this.notify(item);
    }
    return queued;
  }

  public getQueuedNotifications(): NotificationPayload[] {
    return [...this.queuedNotifications];
  }

  public clearQueue(): void {
    this.queuedNotifications = [];
  }

  public getActiveCount(): number {
    return this.activeNotifications.size;
  }

  public hasActiveNotifications(): boolean {
    return this.activeNotifications.size > 0;
  }

  /**
   * Spawns a notification card into the notification chamber
   */
  public notify(payload: NotificationPayload): string {
    const id = payload.id || `notif_${Date.now()}_${++this.notificationCounter}`;
    const rawTimeout = payload.timeoutMs;
    const timeoutMs =
      typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)
        ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(rawTimeout)))
        : DEFAULT_TIMEOUT_MS;
    const safeTitle = String(payload.title ?? '').slice(0, MAX_TITLE_CHARS);
    const safeMessage = String(payload.message ?? '').slice(0, MAX_MESSAGE_CHARS);
    const safePayload: NotificationPayload = {
      ...payload,
      id,
      title: safeTitle,
      message: safeMessage,
      timeoutMs
    };

    const priority = safePayload.priority || 'normal';
    const isHighOrCritical =
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'critical' ||
      safePayload.category === 'alert' ||
      safePayload.category === 'securityAlert' ||
      safePayload.category === 'doorbell';
    const isCriticalSleepToast =
      safePayload.category === 'doorbell' ||
      safePayload.category === 'securityAlert' ||
      safePayload.category === 'alert' ||
      priority === 'critical' ||
      priority === 'urgent';
    const isWakeCategory =
      safePayload.category === 'doorbell' || safePayload.category === 'securityAlert';
    const isUrgent =
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'critical' ||
      safePayload.category === 'alert' ||
      safePayload.category === 'securityAlert';
    const category = safePayload.category || (isUrgent ? 'alert' : 'info');

    // 1. In 'sleep' mode (Cat-Safe 1 FPS): suppress non-critical info toasts completely;
    // allow critical doorbell / securityAlert toasts and wake visuals via urgentOverride.
    if (this.clockMode === 'sleep' && !isCriticalSleepToast) {
      this.queuedNotifications.push(safePayload);
      return id;
    }

    // 2. In 'night' mode: queues/suppresses low and normal priority notifications (only allowing high/critical)
    if (this.clockMode === 'night' && !isHighOrCritical) {
      this.queuedNotifications.push(safePayload);
      return id;
    }

    if (this.clockMode === 'sleep' && isWakeCategory) {
      this.sleepManager?.setUrgentOverride(true);
    }

    // Create card element strictly via createElement + textContent (zero innerHTML)
    const card = document.createElement('div');
    const presenceClass =
      this.clockMode === 'sleep'
        ? 'presence-sleep'
        : this.clockMode === 'night'
          ? 'presence-night'
          : '';
    card.className = `notification-card ${category} ${isUrgent ? 'priority-urgent' : 'priority-normal'}${presenceClass ? ` ${presenceClass}` : ''}`;
    card.setAttribute('data-id', id);

    const timeStr = (safePayload.timestamp || new Date()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const traceEl = document.createElement('div');
    traceEl.className = 'notification-circuit-trace';
    traceEl.setAttribute('aria-hidden', 'true');

    const headerEl = document.createElement('div');
    headerEl.className = 'notification-header';

    const titleWrapEl = document.createElement('div');
    titleWrapEl.className = 'notification-title-wrap';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'notification-icon';
    const iconEl = this.createCategoryIconElement(category);
    if (iconEl) {
      this.appendChildSafe(iconSpan, iconEl);
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'notification-title';
    titleSpan.textContent = safeTitle;

    this.appendChildSafe(titleWrapEl, iconSpan);
    this.appendChildSafe(titleWrapEl, titleSpan);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'notification-time';
    timeSpan.textContent = timeStr;

    this.appendChildSafe(headerEl, titleWrapEl);
    this.appendChildSafe(headerEl, timeSpan);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'notification-body';

    const messageP = document.createElement('p');
    messageP.className = 'notification-message';
    messageP.textContent = safeMessage;
    this.appendChildSafe(bodyEl, messageP);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss(id);
    });

    const progressEl = document.createElement('div');
    progressEl.className = 'notification-progress';
    progressEl.style.animationDuration = `${timeoutMs}ms`;

    this.appendChildSafe(card, traceEl);
    this.appendChildSafe(card, headerEl);
    this.appendChildSafe(card, bodyEl);
    this.appendChildSafe(card, closeBtn);
    this.appendChildSafe(card, progressEl);

    // Dismiss on clicking card
    card.addEventListener('click', () => {
      this.dismiss(id);
    });

    // Add to DOM (top of list)
    this.zoneElement.prepend(card);

    // Trigger entrance animation next frame
    requestAnimationFrame(() => {
      card.classList.add('visible');
    });

    // Set auto-dismiss timer if timeoutMs > 0
    let timerId: number | null = null;
    if (timeoutMs > 0) {
      timerId = window.setTimeout(() => {
        this.dismiss(id);
      }, timeoutMs);
    }

    this.activeNotifications.set(id, {
      element: card,
      timerId,
      isCriticalWake: isWakeCategory
    });
    this.updatePendulumState();

    // Trigger theme-adaptive procedural telemetry chirp / chime
    const effectivePriority: 'normal' | 'urgent' = isUrgent ? 'urgent' : 'normal';
    this.audioEngine?.playNotificationAlert(
      safePayload.priority || effectivePriority,
      category === 'securityAlert' ? 'alert' : category
    );

    // Emit reactive theme event so active theme can pulse lateral trace buses
    const eventType: ThemeEvent['type'] =
      category === 'doorbell'
        ? 'doorbell'
        : category === 'securityAlert'
          ? 'securityAlert'
          : isUrgent
            ? 'priority_alert'
            : 'notification';
    const themeEvent: ThemeEvent = {
      type: eventType,
      priority: isUrgent ? 'urgent' : 'normal',
      category,
      payload: safePayload,
      timestamp: Date.now()
    };
    for (const listener of this.onEventListeners) {
      listener(themeEvent);
    }

    return id;
  }

  /**
   * Dismisses a specific notification with smooth exit animation
   */
  public dismiss(id: string): void {
    const item = this.activeNotifications.get(id);
    if (!item) return;

    if (item.timerId !== null) {
      clearTimeout(item.timerId);
    }

    item.element.classList.remove('visible');
    item.element.classList.add('exiting');

    setTimeout(() => {
      if (item.element.parentNode) {
        item.element.parentNode.removeChild(item.element);
      }
      this.activeNotifications.delete(id);
      this.updatePendulumState();
      this.syncUrgentOverride();
    }, 450);
  }

  /**
   * Clears all notifications immediately
   */
  public clearAll(): void {
    for (const id of Array.from(this.activeNotifications.keys())) {
      this.dismiss(id);
    }
  }

  /**
   * Dims the pendulum while notifications are active
   */
  private updatePendulumState(): void {
    const hasActive = this.activeNotifications.size > 0;
    if (hasActive) {
      this.pendulumElement?.classList.add('dimmed');
      this.zoneElement.classList.add('active');
    } else {
      this.pendulumElement?.classList.remove('dimmed');
      this.zoneElement.classList.remove('active');
    }
  }

  private syncUrgentOverride(): void {
    if (!this.sleepManager) return;
    const hasCriticalWake = Array.from(this.activeNotifications.values()).some(
      (item) => item.isCriticalWake
    );
    if (!hasCriticalWake && this.sleepManager.getIsUrgentOverride()) {
      this.sleepManager.setUrgentOverride(false);
    }
  }

  private appendChildSafe(parent: HTMLElement, child: Node): void {
    if (typeof parent.appendChild === 'function') {
      parent.appendChild(child);
    }
  }

  private createCategoryIconElement(category?: string): SVGSVGElement | null {
    if (typeof document.createElementNS !== 'function') {
      return null;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');

    const addEl = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
      svg.appendChild(el);
    };

    switch (category) {
      case 'doorbell':
        addEl('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' });
        addEl('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' });
        break;
      case 'alert':
      case 'securityAlert':
        addEl('polygon', {
          points: '7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2'
        });
        addEl('line', { x1: '12', y1: '8', x2: '12', y2: '12' });
        addEl('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' });
        break;
      case 'calendar':
        addEl('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' });
        addEl('line', { x1: '16', y1: '2', x2: '16', y2: '6' });
        addEl('line', { x1: '8', y1: '2', x2: '8', y2: '6' });
        addEl('line', { x1: '3', y1: '10', x2: '21', y2: '10' });
        break;
      case 'weather':
        addEl('path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' });
        break;
      default:
        addEl('circle', { cx: '12', cy: '12', r: '10' });
        addEl('line', { x1: '12', y1: '16', x2: '12', y2: '12' });
        addEl('line', { x1: '12', y1: '8', x2: '12.01', y2: '8' });
        break;
    }

    return svg;
  }
}
