import { NotificationPayload, ClockMode } from '../types/theme';
import { ThemeEvent } from '../themes/types';
import { ClockAudioEngine } from './audioEngine';

export class NotificationManager {
  private zoneElement: HTMLElement;
  private pendulumElement: HTMLElement | null;
  private audioEngine: ClockAudioEngine | null = null;
  private activeNotifications: Map<string, { element: HTMLElement; timerId: number | null }> = new Map();
  private queuedNotifications: NotificationPayload[] = [];
  private clockMode: ClockMode = 'active';
  private notificationCounter = 0;
  private onEventListeners: Array<(event: ThemeEvent) => void> = [];

  constructor(
    zoneElement: HTMLElement,
    pendulumElement?: HTMLElement | null,
    audioEngine?: ClockAudioEngine | null
  ) {
    this.zoneElement = zoneElement;
    this.pendulumElement = pendulumElement || null;
    this.audioEngine = audioEngine || null;
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
    const timeoutMs = payload.timeoutMs !== undefined ? payload.timeoutMs : 6000;
    const priority = payload.priority || 'normal';
    const isHighOrCritical =
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'critical' ||
      payload.category === 'alert' ||
      payload.category === 'securityAlert' ||
      payload.category === 'doorbell';
    const isCriticalSleepToast =
      payload.category === 'doorbell' ||
      payload.category === 'securityAlert' ||
      payload.category === 'alert' ||
      priority === 'critical' ||
      priority === 'urgent';
    const isUrgent =
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'critical' ||
      payload.category === 'alert' ||
      payload.category === 'securityAlert';
    const category = payload.category || (isUrgent ? 'alert' : 'info');

    // 1. In 'sleep' mode (Cat-Safe 1 FPS): suppress non-critical info toasts completely;
    // allow critical doorbell / securityAlert toasts in ultra-low-glare ember style.
    if (this.clockMode === 'sleep' && !isCriticalSleepToast) {
      this.queuedNotifications.push({ ...payload, id });
      return id;
    }

    // 2. In 'night' mode: queues/suppresses low and normal priority notifications (only allowing high/critical)
    if (this.clockMode === 'night' && !isHighOrCritical) {
      this.queuedNotifications.push({ ...payload, id });
      return id;
    }

    // Create card element
    const card = document.createElement('div');
    const presenceClass =
      this.clockMode === 'sleep'
        ? 'presence-sleep'
        : this.clockMode === 'night'
          ? 'presence-night'
          : '';
    card.className = `notification-card ${category} ${isUrgent ? 'priority-urgent' : 'priority-normal'}${presenceClass ? ` ${presenceClass}` : ''}`;
    card.setAttribute('data-id', id);

    const timeStr = (payload.timestamp || new Date()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const iconSvg = this.getCategoryIcon(category);

    card.innerHTML = `
      <div class="notification-circuit-trace" aria-hidden="true"></div>
      <div class="notification-header">
        <div class="notification-title-wrap">
          <span class="notification-icon">${iconSvg}</span>
          <span class="notification-title">${this.escapeHtml(payload.title)}</span>
        </div>
        <span class="notification-time">${timeStr}</span>
      </div>
      <div class="notification-body">
        <p class="notification-message">${this.escapeHtml(payload.message)}</p>
      </div>
      <button class="notification-close" aria-label="Dismiss">✕</button>
      <div class="notification-progress" style="animation-duration: ${timeoutMs}ms"></div>
    `;

    // Close button handler
    const closeBtn = card.querySelector('.notification-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismiss(id);
      });
    }

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

    this.activeNotifications.set(id, { element: card, timerId });
    this.updatePendulumState();

    // Trigger theme-adaptive procedural telemetry chirp / chime
    const effectivePriority: 'normal' | 'urgent' = isUrgent ? 'urgent' : 'normal';
    this.audioEngine?.playNotificationAlert(
      payload.priority || effectivePriority,
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
      payload,
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

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getCategoryIcon(category?: string): string {
    switch (category) {
      case 'doorbell':
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
      case 'alert':
      case 'securityAlert':
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
      case 'calendar':
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
      case 'weather':
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
  }
}
