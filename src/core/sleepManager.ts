/**
 * Cat-Safe Night Silence & Sleep Mode Manager
 * Handles:
 * 1. Scheduled quiet hours (e.g. 23:00 to 07:00)
 * 2. Exponential pendulum amplitude damping down to 0.0° dead-center park over 6s
 * 3. Audio muting during quiet hours
 * 4. Display dimming with luminescent dial glow
 * 5. Urgent notification override
 */

export interface SleepConfig {
  enabled: boolean;
  startHour: number; // e.g. 23 (23:00)
  endHour: number;   // e.g. 7 (07:00)
  dampingDurationSec: number; // e.g. 6.0
}

export class SleepManager {
  private stageElement: HTMLElement;
  private config: SleepConfig = {
    enabled: true,
    startHour: 23,
    endHour: 7,
    dampingDurationSec: 6.0
  };

  private isSleeping = false;
  private isForceSleep = false;
  private isUrgentOverride = false;
  private sleepTransitionStartTime: number | null = null;
  private wakeTransitionStartTime: number | null = null;
  private currentDampingFactor = 1.0; // 1.0 = full amplitude, 0.0 = parked at 0 deg

  private onSleepStateChangeListeners: Array<(isSleeping: boolean) => void> = [];

  constructor(stageElement: HTMLElement, config?: Partial<SleepConfig>) {
    this.stageElement = stageElement;
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Evaluates sleep state for the given simulated time
   * Called every frame in the master clock tick
   */
  public update(currentDate: Date, nowTimeMs: number): number {
    const shouldSleep = this.evaluateShouldSleep(currentDate);

    // State transition detection
    if (shouldSleep && !this.isSleeping) {
      this.enterSleep(nowTimeMs);
    } else if (!shouldSleep && this.isSleeping) {
      this.exitSleep(nowTimeMs);
    }

    // Calculate dynamic damping factor
    if (this.isSleeping && !this.isUrgentOverride) {
      if (this.sleepTransitionStartTime !== null) {
        const elapsedSec = (nowTimeMs - this.sleepTransitionStartTime) / 1000;
        const progress = Math.min(1.0, elapsedSec / this.config.dampingDurationSec);
        // Exponential decay: e^(-3 * progress) down to 0
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

  private evaluateShouldSleep(date: Date): boolean {
    if (this.isForceSleep) return true;
    if (!this.config.enabled) return false;

    const hour = date.getHours();
    const { startHour, endHour } = this.config;

    if (startHour > endHour) {
      // Overnight window: e.g. 23:00 to 07:00
      return hour >= startHour || hour < endHour;
    } else {
      // Daytime window
      return hour >= startHour && hour < endHour;
    }
  }

  private enterSleep(nowTimeMs: number): void {
    this.isSleeping = true;
    this.sleepTransitionStartTime = nowTimeMs;
    this.wakeTransitionStartTime = null;
    this.stageElement.classList.add('night-sleep');
    this.notifyListeners(true);
  }

  private exitSleep(nowTimeMs: number): void {
    this.isSleeping = false;
    this.wakeTransitionStartTime = nowTimeMs;
    this.sleepTransitionStartTime = null;
    this.stageElement.classList.remove('night-sleep');
    this.notifyListeners(false);
  }

  /**
   * Sets urgent override (wakes display & audio during an active critical alert)
   */
  public setUrgentOverride(active: boolean): void {
    this.isUrgentOverride = active;
    if (active) {
      this.stageElement.classList.remove('night-sleep');
    } else if (this.isSleeping) {
      this.stageElement.classList.add('night-sleep');
    }
  }

  public getIsSleeping(): boolean {
    return this.isSleeping && !this.isUrgentOverride;
  }

  public toggleForceSleep(): boolean {
    this.isForceSleep = !this.isForceSleep;
    const now = performance.now();
    if (this.isForceSleep) {
      this.enterSleep(now);
    } else {
      this.exitSleep(now);
    }
    return this.isForceSleep;
  }

  public getForceSleep(): boolean {
    return this.isForceSleep;
  }

  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  public getEnabled(): boolean {
    return this.config.enabled;
  }

  public setQuietHours(startHour: number, endHour: number): void {
    this.config.startHour = startHour;
    this.config.endHour = endHour;
  }

  public getQuietHours(): { startHour: number; endHour: number } {
    return { startHour: this.config.startHour, endHour: this.config.endHour };
  }

  public onSleepStateChange(listener: (isSleeping: boolean) => void): () => void {
    this.onSleepStateChangeListeners.push(listener);
    return () => {
      this.onSleepStateChangeListeners = this.onSleepStateChangeListeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(isSleeping: boolean): void {
    for (const listener of this.onSleepStateChangeListeners) {
      listener(isSleeping);
    }
  }
}

