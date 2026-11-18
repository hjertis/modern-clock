import { ClockMode } from '../types/theme';

export interface TimeSchedule {
  enabled: boolean;
  wakeTime: string;      // e.g. "06:30" -> transitions to 'active'
  nightStart?: string;   // e.g. "22:00" -> transitions to 'night'
  sleepStart?: string;   // e.g. "23:30" -> transitions to 'sleep'
  silentStart?: string;  // optional e.g. "21:00" -> transitions to 'silent'
}

export interface SleepManagerConfig {
  schedule: TimeSchedule;
  nightDimLevel: number;             // Default 0.20 (20% brightness)
  sleepOpacity: number;              // Default 0.05 (~5% opacity)
  dampingDurationSec: number;        // Default 6.0
  catSafeWakeHoldMs: number;         // Default 2500 (2.5s press-and-hold)
  catSafeTripleTapWindowMs: number;  // Default 1000 (3 taps within 1.0s)
}

export interface SleepManagerState {
  mode: ClockMode;
  isSleeping: boolean;
  isManualOverride: boolean;
  manualOverrideMode: ClockMode | null;
  isUrgentOverride: boolean;
  dampingFactor: number;
  nightDimLevel: number;
  sleepOpacity: number;
  schedule: TimeSchedule;
}

/**
 * Unified 4-State Night / Silent / Sleep (Cat-Safe) Mode Manager
 *
 * Supported States:
 * - 'active': Full visuals and FPS, audio enabled per user settings, all notification priorities displayed.
 * - 'silent': Full visuals and FPS, forces audioEngine mute for ticks and chimes while keeping visual alerts active.
 * - 'night': Smooth CSS luminance dim + warm nocturnal tint (configurable dim level, default 20%),
 *            mutes ticks and chimes, caps clockEngine render rate to 30 FPS, suppresses low/normal notifications.
 * - 'sleep' (Cat-Safe Mode): Smooth fade to ~5% opacity, pauses pendulum swing & animated trace ripples,
 *            throttles clockEngine to 1 FPS (minute/hour hands only), mutes all audio, suppresses visual toasts,
 *            and guards against paw taps.
 */
export class SleepManager {
  private stageElement: HTMLElement;
  private config: SleepManagerConfig = {
    schedule: {
      enabled: false,
      wakeTime: '06:30',
      nightStart: '22:00',
      sleepStart: '23:30'
    },
    nightDimLevel: 0.20,
    sleepOpacity: 0.05,
    dampingDurationSec: 6.0,
    catSafeWakeHoldMs: 2500,
    catSafeTripleTapWindowMs: 1000
  };

  private currentMode: ClockMode = 'active';
  private manualOverrideMode: ClockMode | null = null;
  private lastEvaluatedScheduledMode: ClockMode | null = null;
  private isUrgentOverride = false;

  // Damping & transition tracking
  private sleepTransitionStartTime: number | null = null;
  private wakeTransitionStartTime: number | null = null;
  private currentDampingFactor = 1.0;

  // Paw-Proof Wake Guard state
  private holdTimer: number | null = null;
  private pointerDownTime = 0;
  private tapTimestamps: number[] = [];

  // Bound event listeners
  private boundOnPointerDown?: (e: PointerEvent) => void;
  private boundOnPointerUp?: (e: PointerEvent) => void;
  private boundOnPointerCancel?: (e: PointerEvent) => void;
  private boundOnClick?: (e: MouseEvent) => void;

  // Event Listeners
  private onModeChangeListeners: Array<(mode: ClockMode, prevMode: ClockMode) => void> = [];
  private onScheduleChangeListeners: Array<(schedule: TimeSchedule) => void> = [];
  private onSleepStateChangeListeners: Array<(isSleeping: boolean) => void> = [];

  constructor(stageElement: HTMLElement, config?: Partial<SleepManagerConfig>) {
    this.stageElement = stageElement;
    if (config) {
      this.config = {
        ...this.config,
        ...config,
        schedule: { ...this.config.schedule, ...(config.schedule || {}) }
      };
    }

    this.setupWakeGuard();
    this.applyModeVisuals(this.currentMode);
  }

  /**
   * Evaluates schedule and updates dynamic damping factor for the given simulated time.
   * Called every frame in the master clock tick.
   */
  public update(currentDate: Date, nowTimeMs: number): number {
    if (this.config.schedule.enabled) {
      const scheduledMode = this.evaluateScheduleMode(currentDate);

      // Detect scheduled transition boundary
      if (
        this.lastEvaluatedScheduledMode !== null &&
        scheduledMode !== this.lastEvaluatedScheduledMode
      ) {
        // Scheduled transition boundary reached: clear manual override
        if (this.manualOverrideMode !== null) {
          console.log(
            `[SleepManager] Scheduled boundary reached (${this.lastEvaluatedScheduledMode} -> ${scheduledMode}). Clearing manual override.`
          );
          this.manualOverrideMode = null;
        }
      }
      this.lastEvaluatedScheduledMode = scheduledMode;

      const targetMode =
        this.manualOverrideMode !== null ? this.manualOverrideMode : scheduledMode;

      if (targetMode !== this.currentMode) {
        this.setMode(targetMode, false, nowTimeMs);
      }
    }

    // Calculate dynamic damping factor
    const isSleepingNow = this.currentMode === 'sleep' && !this.isUrgentOverride;
    if (isSleepingNow) {
      if (this.sleepTransitionStartTime !== null) {
        const elapsedSec = (nowTimeMs - this.sleepTransitionStartTime) / 1000;
        const progress = Math.min(1.0, elapsedSec / this.config.dampingDurationSec);
        // Exponential decay: e^(-2.5 * progress) down to 0
        this.currentDampingFactor = Math.max(0, (1 - progress) * Math.exp(-progress * 2.5));
        if (progress >= 1.0) {
          this.currentDampingFactor = 0.0;
        }
      } else {
        this.currentDampingFactor = 0.0;
      }
    } else {
      // Waking or awake
      if (this.wakeTransitionStartTime !== null) {
        const elapsedSec = (nowTimeMs - this.wakeTransitionStartTime) / 1000;
        const progress = Math.min(1.0, elapsedSec / 4.0);
        this.currentDampingFactor = progress;
        if (progress >= 1.0) {
          this.wakeTransitionStartTime = null;
          this.currentDampingFactor = 1.0;
        }
      } else {
        this.currentDampingFactor = 1.0;
      }
    }

    return this.currentDampingFactor;
  }

  /**
   * Evaluates the scheduled mode for the given simulated time.
   */
  public evaluateScheduleMode(date: Date): ClockMode {
    if (!this.config.schedule.enabled) {
      return 'active';
    }

    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const transitions: Array<{ minutes: number; mode: ClockMode }> = [];

    const wakeMinutes = this.parseTimeToMinutes(this.config.schedule.wakeTime);
    transitions.push({ minutes: wakeMinutes, mode: 'active' });

    if (this.config.schedule.silentStart) {
      transitions.push({
        minutes: this.parseTimeToMinutes(this.config.schedule.silentStart),
        mode: 'silent'
      });
    }

    if (this.config.schedule.nightStart) {
      transitions.push({
        minutes: this.parseTimeToMinutes(this.config.schedule.nightStart),
        mode: 'night'
      });
    }

    if (this.config.schedule.sleepStart) {
      transitions.push({
        minutes: this.parseTimeToMinutes(this.config.schedule.sleepStart),
        mode: 'sleep'
      });
    }

    // Sort chronologically across the day (0 to 1439 min)
    transitions.sort((a, b) => a.minutes - b.minutes);

    // Find the latest transition that occurred before or at currentMinutes
    let resolvedMode: ClockMode | null = null;
    for (let i = transitions.length - 1; i >= 0; i--) {
      if (currentMinutes >= transitions[i].minutes) {
        resolvedMode = transitions[i].mode;
        break;
      }
    }

    // If before the first transition of the day, wrap around to the last transition of the previous day
    if (resolvedMode === null && transitions.length > 0) {
      resolvedMode = transitions[transitions.length - 1].mode;
    }

    return resolvedMode || 'active';
  }

  /**
   * Sets the active mode ('active' | 'silent' | 'night' | 'sleep').
   * If isManualOverride is true (default), this mode persists until the next scheduled transition.
   */
  public setMode(
    mode: ClockMode,
    isManualOverride = true,
    nowTimeMs: number = performance.now()
  ): void {
    if (isManualOverride) {
      this.manualOverrideMode = mode;
    }

    if (this.currentMode === mode) return;

    const prevMode = this.currentMode;
    this.currentMode = mode;

    if (mode === 'sleep') {
      this.sleepTransitionStartTime = nowTimeMs;
      this.wakeTransitionStartTime = null;
    } else if (prevMode === 'sleep') {
      this.wakeTransitionStartTime = nowTimeMs;
      this.sleepTransitionStartTime = null;
    }

    this.applyModeVisuals(mode);
    this.notifyModeChange(mode, prevMode);

    const prevIsSleeping = prevMode === 'sleep' && !this.isUrgentOverride;
    const currentIsSleeping = mode === 'sleep' && !this.isUrgentOverride;
    if (prevIsSleeping !== currentIsSleeping) {
      this.notifySleepListeners(currentIsSleeping);
    }
  }

  public getMode(): ClockMode {
    return this.currentMode;
  }

  /**
   * Wakes the clock immediately to 'active' mode.
   * Can be triggered by paw-proof hold, triple-tap, or remote MQTT/WS command.
   */
  public wake(reason: 'hold' | 'triple_tap' | 'remote' | 'manual' = 'manual'): void {
    console.log(`[SleepManager] Woken by ${reason}. Switching to 'active'.`);
    this.setMode('active', true);
  }

  /**
   * Updates schedule parameters
   */
  public setSchedule(schedule: Partial<TimeSchedule>): void {
    const cleaned: Partial<TimeSchedule> = {};
    if (schedule.enabled !== undefined) cleaned.enabled = schedule.enabled;
    if (schedule.wakeTime !== undefined) cleaned.wakeTime = schedule.wakeTime;
    if (schedule.nightStart !== undefined) cleaned.nightStart = schedule.nightStart;
    if (schedule.sleepStart !== undefined) cleaned.sleepStart = schedule.sleepStart;
    if (schedule.silentStart !== undefined) cleaned.silentStart = schedule.silentStart;

    this.config.schedule = { ...this.config.schedule, ...cleaned };
    console.log('[SleepManager] Updated schedule:', this.config.schedule);
    for (const listener of this.onScheduleChangeListeners) {
      listener(this.config.schedule);
    }
  }

  public getSchedule(): TimeSchedule {
    return { ...this.config.schedule };
  }

  public isManualOverrideActive(): boolean {
    return this.manualOverrideMode !== null;
  }

  public clearManualOverride(): void {
    this.manualOverrideMode = null;
    if (this.config.schedule.enabled) {
      const scheduled = this.evaluateScheduleMode(new Date());
      this.setMode(scheduled, false);
    }
  }

  public setNightDimLevel(level: number): void {
    this.config.nightDimLevel = Math.max(0.01, Math.min(1.0, level));
    if (this.currentMode === 'night') {
      this.applyModeVisuals('night');
    }
  }

  public getNightDimLevel(): number {
    return this.config.nightDimLevel;
  }

  public setSleepOpacity(opacity: number): void {
    this.config.sleepOpacity = Math.max(0.0, Math.min(1.0, opacity));
    if (this.currentMode === 'sleep') {
      this.applyModeVisuals('sleep');
    }
  }

  public getSleepOpacity(): number {
    return this.config.sleepOpacity;
  }

  /**
   * Urgent override: wakes visuals & audio temporarily during an active critical alert.
   */
  public setUrgentOverride(active: boolean): void {
    this.isUrgentOverride = active;
    if (active) {
      this.stageElement.classList.remove('mode-sleep', 'night-sleep');
      this.notifySleepListeners(false);
    } else if (this.currentMode === 'sleep') {
      this.stageElement.classList.add('mode-sleep', 'night-sleep');
      this.notifySleepListeners(true);
    }
  }

  public getIsUrgentOverride(): boolean {
    return this.isUrgentOverride;
  }

  public getIsSleeping(): boolean {
    return this.currentMode === 'sleep' && !this.isUrgentOverride;
  }

  public getDampingFactor(): number {
    return this.currentDampingFactor;
  }

  public getState(): SleepManagerState {
    return {
      mode: this.currentMode,
      isSleeping: this.getIsSleeping(),
      isManualOverride: this.isManualOverrideActive(),
      manualOverrideMode: this.manualOverrideMode,
      isUrgentOverride: this.isUrgentOverride,
      dampingFactor: this.currentDampingFactor,
      nightDimLevel: this.config.nightDimLevel,
      sleepOpacity: this.config.sleepOpacity,
      schedule: { ...this.config.schedule }
    };
  }

  // --- Backwards Compatibility Helpers ---

  public toggleForceSleep(): boolean {
    const nextMode: ClockMode = this.currentMode === 'sleep' ? 'active' : 'sleep';
    this.setMode(nextMode, true);
    return nextMode === 'sleep';
  }

  public getForceSleep(): boolean {
    return this.currentMode === 'sleep' && this.manualOverrideMode === 'sleep';
  }

  public setEnabled(enabled: boolean): void {
    this.setSchedule({ enabled });
  }

  public getEnabled(): boolean {
    return this.config.schedule.enabled;
  }

  public setQuietHours(startHour: number, endHour: number): void {
    const pad = (n: number) => String(n).padStart(2, '0');
    this.setSchedule({
      nightStart: `${pad(startHour)}:00`,
      sleepStart: `${pad(startHour)}:30`,
      wakeTime: `${pad(endHour)}:00`
    });
  }

  public getQuietHours(): { startHour: number; endHour: number } {
    const nightStart = this.config.schedule.nightStart || '22:00';
    const wakeTime = this.config.schedule.wakeTime || '06:30';
    return {
      startHour: parseInt(nightStart.split(':')[0], 10),
      endHour: parseInt(wakeTime.split(':')[0], 10)
    };
  }

  // --- Event Subscriptions ---

  public onModeChange(listener: (mode: ClockMode, prevMode: ClockMode) => void): () => void {
    this.onModeChangeListeners.push(listener);
    return () => {
      this.onModeChangeListeners = this.onModeChangeListeners.filter((l) => l !== listener);
    };
  }

  public onScheduleChange(listener: (schedule: TimeSchedule) => void): () => void {
    this.onScheduleChangeListeners.push(listener);
    return () => {
      this.onScheduleChangeListeners = this.onScheduleChangeListeners.filter((l) => l !== listener);
    };
  }

  public onSleepStateChange(listener: (isSleeping: boolean) => void): () => void {
    this.onSleepStateChangeListeners.push(listener);
    return () => {
      this.onSleepStateChangeListeners = this.onSleepStateChangeListeners.filter(
        (l) => l !== listener
      );
    };
  }

  // --- Paw-Proof Wake Guard ---

  private setupWakeGuard(): void {
    this.boundOnPointerDown = this.handlePointerDown.bind(this);
    this.boundOnPointerUp = this.handlePointerUp.bind(this);
    this.boundOnPointerCancel = this.handlePointerCancel.bind(this);
    this.boundOnClick = this.handleClick.bind(this);

    // Capture phase on stage ensures all pointer taps/clicks are intercepted during sleep
    this.stageElement.addEventListener('pointerdown', this.boundOnPointerDown, {
      capture: true,
      passive: false
    });
    this.stageElement.addEventListener('pointerup', this.boundOnPointerUp, {
      capture: true,
      passive: false
    });
    this.stageElement.addEventListener('pointercancel', this.boundOnPointerCancel, {
      capture: true,
      passive: false
    });
    this.stageElement.addEventListener('click', this.boundOnClick, {
      capture: true,
      passive: false
    });
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.currentMode !== 'sleep' || this.isUrgentOverride) {
      return;
    }

    // Swallowing click/pointer interaction during sleep mode
    e.preventDefault();
    e.stopPropagation();

    this.pointerDownTime = performance.now();
    this.clearHoldTimer();

    // 2.5-second press-and-hold wake guard
    this.holdTimer = window.setTimeout(() => {
      this.wake('hold');
      this.clearHoldTimer();
    }, this.config.catSafeWakeHoldMs);
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.currentMode !== 'sleep' || this.isUrgentOverride) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const now = performance.now();
    const pressDuration = now - this.pointerDownTime;
    this.clearHoldTimer();

    // Check for triple-tap within 1.0 second (taps must be brief < 400ms)
    if (pressDuration < 400) {
      this.tapTimestamps = this.tapTimestamps.filter(
        (t) => now - t <= this.config.catSafeTripleTapWindowMs
      );
      this.tapTimestamps.push(now);

      if (this.tapTimestamps.length >= 3) {
        this.tapTimestamps = [];
        this.wake('triple_tap');
      }
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.currentMode === 'sleep' && !this.isUrgentOverride) {
      e.preventDefault();
      e.stopPropagation();
      this.clearHoldTimer();
    }
  }

  private handleClick(e: MouseEvent): void {
    if (this.currentMode === 'sleep' && !this.isUrgentOverride) {
      // Swallows single clicks/taps completely
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Updates CSS classes and custom properties on the stage element
   */
  private applyModeVisuals(mode: ClockMode): void {
    this.stageElement.classList.remove(
      'mode-active',
      'mode-silent',
      'mode-night',
      'mode-sleep',
      'night-sleep'
    );
    this.stageElement.classList.add(`mode-${mode}`);

    if (mode === 'sleep') {
      this.stageElement.classList.add('night-sleep');
    }

    this.stageElement.style.setProperty('--night-brightness', String(this.config.nightDimLevel));
    this.stageElement.style.setProperty('--sleep-opacity', String(this.config.sleepOpacity));

    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove(
        'clock-mode-active',
        'clock-mode-silent',
        'clock-mode-night',
        'clock-mode-sleep'
      );
      document.body.classList.add(`clock-mode-${mode}`);
    }
  }

  private notifyModeChange(mode: ClockMode, prevMode: ClockMode): void {
    for (const listener of this.onModeChangeListeners) {
      listener(mode, prevMode);
    }
  }

  private notifySleepListeners(isSleeping: boolean): void {
    for (const listener of this.onSleepStateChangeListeners) {
      listener(isSleeping);
    }
  }

  private parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.trim().split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h % 24) * 60 + (m % 60);
  }

  public destroy(): void {
    this.clearHoldTimer();
    if (this.boundOnPointerDown) {
      this.stageElement.removeEventListener('pointerdown', this.boundOnPointerDown, {
        capture: true
      });
    }
    if (this.boundOnPointerUp) {
      this.stageElement.removeEventListener('pointerup', this.boundOnPointerUp, { capture: true });
    }
    if (this.boundOnPointerCancel) {
      this.stageElement.removeEventListener('pointercancel', this.boundOnPointerCancel, {
        capture: true
      });
    }
    if (this.boundOnClick) {
      this.stageElement.removeEventListener('click', this.boundOnClick, { capture: true });
    }
  }
}
