import { ThemeManifest, HandMode, ClockMode } from '../types/theme';
import { calculateHandAngles, calculatePendulumAngle } from '../utils/math';
import { ClockDomElements } from './themeLoader';
import { ThemeManager } from '../themes/themeManager';
import { TimeData, PhysicsData, TelemetryData } from '../themes/types';
import { WSStatus } from './wsClient';
import { ClockAudioEngine } from './audioEngine';
import { SleepManager } from './sleepManager';

export interface ClockEngineOptions {
  secondMode?: HandMode;
  timeMultiplier?: number;
  themeManager?: ThemeManager;
  audioEngine?: ClockAudioEngine;
  sleepManager?: SleepManager;
}

export class ClockEngine {
  private elements?: ClockDomElements;
  private themeManager: ThemeManager | null = null;
  private audioEngine: ClockAudioEngine | null = null;
  private sleepManager: SleepManager | null = null;
  private manifest: ThemeManifest | null = null;
  private isRunning = false;
  private animationFrameId: number | null = null;

  // Power & presence mode: 'active' | 'silent' | 'night' | 'sleep'
  private currentMode: ClockMode = 'active';
  private targetMaxFps: number | null = null; // null = uncapped, 30 for night, 1 for sleep
  private lastRenderPerfTimeMs = 0;

  // Second hand mode
  private secondMode: HandMode = 'sweep';

  // Time simulation variables
  private timeMultiplier = 1.0;
  private baseSimulatedTime = Date.now();
  private baseRealTime = performance.now();
  private lastFrameTimeMs = performance.now();

  // Zero-drift phase-locked audio tracking
  private lastPendulumAngleDeg: number | null = null;
  private lastSimulatedMinute = -1;

  // Telemetry state
  private smoothedFps = 60.0;
  private smoothedFrameTimeMs = 16.67;
  private wsStatus: WSStatus = 'disconnected';
  private wsUrl = 'ws://192.168.0.69:8088/ws';
  private showDebugGrid = false;
  private activeNotificationsProvider: () => number = () => 0;

  // Callbacks for HUD/Overlay updates
  private onTickListeners: Array<(currentDate: Date, pendulumAngle: number, fps: number) => void> = [];

  constructor(elements?: ClockDomElements, options?: ClockEngineOptions) {
    this.elements = elements;
    if (options?.themeManager) {
      this.themeManager = options.themeManager;
    }
    if (options?.audioEngine) {
      this.audioEngine = options.audioEngine;
    }
    if (options?.secondMode) {
      this.secondMode = options.secondMode;
    }
    if (options?.timeMultiplier) {
      this.timeMultiplier = options.timeMultiplier;
    }
    if (options?.sleepManager) {
      this.setSleepManager(options.sleepManager);
    }
  }

  public setMode(mode: ClockMode): void {
    this.currentMode = mode;
    if (mode === 'sleep') {
      this.targetMaxFps = 1;
    } else if (mode === 'night') {
      this.targetMaxFps = 30;
    } else {
      this.targetMaxFps = null;
    }
  }

  public getMode(): ClockMode {
    return this.currentMode;
  }

  public setSleepManager(sleepManager: SleepManager): void {
    this.sleepManager = sleepManager;
    this.setMode(sleepManager.getMode());
    sleepManager.onModeChange((mode) => {
      this.setMode(mode);
    });
  }

  public getSleepManager(): SleepManager | null {
    return this.sleepManager;
  }

  public setAudioEngine(audioEngine: ClockAudioEngine): void {
    this.audioEngine = audioEngine;
  }

  public getAudioEngine(): ClockAudioEngine | null {
    return this.audioEngine;
  }

  public setThemeManager(themeManager: ThemeManager): void {
    this.themeManager = themeManager;
    const manifest = themeManager.getActiveManifest();
    if (manifest) {
      this.setManifest(manifest);
    }
  }

  public setManifest(manifest: ThemeManifest): void {
    this.manifest = manifest;
    if (manifest.hands.second.mode) {
      this.secondMode = manifest.hands.second.mode;
    }
  }

  public getManifest(): ThemeManifest | null {
    return this.themeManager?.getActiveManifest() || this.manifest;
  }

  public setWSStatus(status: WSStatus, url?: string): void {
    this.wsStatus = status;
    if (url) {
      this.wsUrl = url;
    }
  }

  public setActiveNotificationsProvider(provider: () => number): void {
    this.activeNotificationsProvider = provider;
  }

  public setShowDebugGrid(show: boolean): void {
    this.showDebugGrid = show;
  }

  public getFps(): number {
    return this.smoothedFps;
  }

  /**
   * Starts the synchronized requestAnimationFrame loop
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.baseRealTime = performance.now();
    this.lastFrameTimeMs = this.baseRealTime;
    this.baseSimulatedTime = Date.now();
    this.lastPendulumAngleDeg = null;
    this.lastSimulatedMinute = -1;

    const loop = () => {
      if (!this.isRunning) return;
      this.tick();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Stops the master loop
   */
  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Master frame update
   */
  private tick(): void {
    const nowPerf = performance.now();

    // 0. FPS Throttling for Power & Presence States
    // 'night': capped to 30 FPS. 'sleep': throttled to 1 FPS. 'active' / 'silent': uncapped.
    if (this.targetMaxFps !== null && this.targetMaxFps > 0) {
      const minIntervalMs = 1000 / this.targetMaxFps;
      if (nowPerf - this.lastRenderPerfTimeMs < minIntervalMs - 1.5) {
        return; // Throttled
      }
    }
    this.lastRenderPerfTimeMs = nowPerf;

    const rawDeltaMs = Math.max(1, nowPerf - this.lastFrameTimeMs);
    this.lastFrameTimeMs = nowPerf;

    const instantFps = Math.min(240, 1000 / rawDeltaMs);
    this.smoothedFps = this.smoothedFps * 0.92 + instantFps * 0.08;
    this.smoothedFrameTimeMs = this.smoothedFrameTimeMs * 0.92 + rawDeltaMs * 0.08;

    const elapsedRealMs = nowPerf - this.baseRealTime;
    const currentSimulatedMs = this.baseSimulatedTime + elapsedRealMs * this.timeMultiplier;
    const currentDate = new Date(currentSimulatedMs);

    // Dynamic sleep evaluation & damping factor
    const dampingFactor = this.sleepManager
      ? this.sleepManager.update(currentDate, nowPerf)
      : this.currentMode === 'sleep'
        ? 0.0
        : 1.0;
    const isSleeping = this.sleepManager
      ? this.sleepManager.getIsSleeping()
      : this.currentMode === 'sleep';

    const activeManifest = this.themeManager?.getActiveManifest() || this.manifest;
    const periodSeconds = activeManifest?.pendulum.periodSeconds ?? 2.0;
    const maxAngleDeg = activeManifest?.pendulum.maxAngleDeg ?? 6.0;
    const pivot = activeManifest?.pendulum.pivot ?? { x: 540, y: 990 };

    // 1. Calculate Hand Angles
    const angles = calculateHandAngles(currentDate, this.secondMode);
    if (isSleeping) {
      // In sleep (cat-safe) mode: update minute/hour hands only, lock second hand to minute hand
      angles.second = angles.minute;
    }

    // 2. Simple Harmonic Motion for Pendulum: θ(t) = θ_max * cos((2π / T) * t)
    const tSeconds = currentSimulatedMs / 1000;
    const omega = periodSeconds > 0 ? (2 * Math.PI) / periodSeconds : Math.PI;
    const phaseRad = ((omega * tSeconds) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const phaseNorm = phaseRad / (2 * Math.PI);

    let pendulumAngleDeg = calculatePendulumAngle(tSeconds, periodSeconds, maxAngleDeg);
    let pendulumAngleRad = (pendulumAngleDeg * Math.PI) / 180;
    let angularVelocityNorm = -Math.sin(phaseRad);
    let angularVelocityRad = -((maxAngleDeg * Math.PI) / 180) * omega * Math.sin(phaseRad);

    if (isSleeping || dampingFactor <= 0.001) {
      pendulumAngleDeg = 0;
      pendulumAngleRad = 0;
      angularVelocityNorm = 0;
      angularVelocityRad = 0;
    } else if (dampingFactor < 0.999) {
      pendulumAngleDeg *= dampingFactor;
      pendulumAngleRad *= dampingFactor;
      angularVelocityNorm *= dampingFactor;
      angularVelocityRad *= dampingFactor;
    }

    // 2b. Zero-Drift Sync: Trigger escapement tick directly from pendulum zero-crossing
    // Escapement ticks are only active in 'active' mode
    if (
      this.currentMode === 'active' &&
      !isSleeping &&
      this.lastPendulumAngleDeg !== null &&
      this.timeMultiplier <= 3.0
    ) {
      if (this.lastPendulumAngleDeg < 0 && pendulumAngleDeg >= 0) {
        // Left-to-right zero-crossing -> 'tick'
        this.audioEngine?.onEscapementTick('tick');
      } else if (this.lastPendulumAngleDeg > 0 && pendulumAngleDeg <= 0) {
        // Right-to-left zero-crossing -> 'tock'
        this.audioEngine?.onEscapementTick('tock');
      }
    }
    this.lastPendulumAngleDeg = pendulumAngleDeg;

    // 2c. Hourly and Quarter-Hourly Procedural Chimes
    // Chimes are only active in 'active' mode
    const currentMinute = currentDate.getMinutes();
    const currentHour = currentDate.getHours();
    if (this.lastSimulatedMinute !== -1 && this.lastSimulatedMinute !== currentMinute) {
      if (
        this.currentMode === 'active' &&
        !isSleeping &&
        this.timeMultiplier <= 2.0 &&
        this.audioEngine
      ) {
        if (currentMinute === 0) {
          this.audioEngine.onHour(currentHour);
        } else if (currentMinute === 15 || currentMinute === 30 || currentMinute === 45) {
          this.audioEngine.onQuarter(currentMinute);
        }
      }
    }
    this.lastSimulatedMinute = currentMinute;

    const activeNotificationsCount = this.activeNotificationsProvider();
    const dimmed = activeNotificationsCount > 0;

    // 3. Render Pluggable Active Theme onto Canvas
    const activeTheme = this.themeManager?.getActiveTheme();
    if (this.themeManager && activeTheme) {
      const ctx = this.themeManager.getCanvasContext();
      this.themeManager.resetCanvas();

      const timeData: TimeData = {
        date: currentDate,
        hours: currentDate.getHours(),
        minutes: currentDate.getMinutes(),
        seconds: currentDate.getSeconds(),
        milliseconds: currentDate.getMilliseconds(),
        angles,
        secondMode: this.secondMode,
        timestampMs: currentSimulatedMs,
        realTimeMs: nowPerf,
        deltaTimeSec: rawDeltaMs / 1000
      };

      const physicsData: PhysicsData = {
        angleDeg: pendulumAngleDeg,
        angleRad: pendulumAngleRad,
        angularVelocityNorm,
        angularVelocityRad,
        phase: phaseNorm,
        phaseRad,
        periodSeconds,
        maxAngleDeg,
        dampingFactor,
        dimmed,
        pivot,
        timeSec: isSleeping ? 0 : tSeconds
      };

      const telemetryData: TelemetryData = {
        fps: this.smoothedFps,
        frameTimeMs: this.smoothedFrameTimeMs,
        wsStatus: this.wsStatus,
        wsUrl: this.wsUrl,
        pendulumAngleDeg,
        pendulumPhaseDeg: phaseNorm * 360,
        pendulumAngularVelocity: angularVelocityRad,
        pendulumPeriodSec: periodSeconds,
        secondMode: this.secondMode,
        timeMultiplier: this.timeMultiplier,
        isSleeping,
        mode: this.currentMode,
        showDebugGrid: this.showDebugGrid,
        activeNotificationsCount,
        currentDate
      };

      // In sleep mode: completely hide pendulum so there is no motion to attract pets
      if (!isSleeping) {
        activeTheme.renderPendulum(ctx, physicsData);
      }
      activeTheme.renderDial(ctx, timeData);
      activeTheme.renderOverlay(ctx, telemetryData);
    } else if (this.elements) {
      // Legacy DOM fallback if no ThemeManager is attached
      this.elements.handHour.style.transform = `rotate(${angles.hour.toFixed(3)}deg)`;
      this.elements.handMinute.style.transform = `rotate(${angles.minute.toFixed(3)}deg)`;
      this.elements.handSecond.style.transform = `rotate(${angles.second.toFixed(3)}deg)`;
      if (!isSleeping) {
        this.elements.pendulum.style.display = '';
        this.elements.pendulum.style.transform = `rotate(${pendulumAngleDeg.toFixed(3)}deg)`;
      } else {
        this.elements.pendulum.style.display = 'none';
      }
    }

    // Notify HUD/tick listeners
    for (const listener of this.onTickListeners) {
      listener(currentDate, pendulumAngleDeg, this.smoothedFps);
    }
  }

  /**
   * Set second hand mode: 'tick' or 'sweep'
   */
  public setSecondMode(mode: HandMode): void {
    this.secondMode = mode;
  }

  public getSecondMode(): HandMode {
    return this.secondMode;
  }

  public toggleSecondMode(): HandMode {
    this.secondMode = this.secondMode === 'tick' ? 'sweep' : 'tick';
    return this.secondMode;
  }

  /**
   * Sets the time speed multiplier (1.0 = normal, 10.0 = 10x fast forward)
   */
  public setTimeMultiplier(multiplier: number): void {
    const currentSimulatedMs = this.getCurrentSimulatedTime().getTime();
    this.baseSimulatedTime = currentSimulatedMs;
    this.baseRealTime = performance.now();
    this.timeMultiplier = multiplier;
  }

  public getTimeMultiplier(): number {
    return this.timeMultiplier;
  }

  public getCurrentSimulatedTime(): Date {
    const nowPerf = performance.now();
    const elapsedRealMs = nowPerf - this.baseRealTime;
    return new Date(this.baseSimulatedTime + elapsedRealMs * this.timeMultiplier);
  }

  public addOnTickListener(
    listener: (currentDate: Date, pendulumAngle: number, fps: number) => void
  ): () => void {
    this.onTickListeners.push(listener);
    return () => {
      this.onTickListeners = this.onTickListeners.filter((l) => l !== listener);
    };
  }
}
