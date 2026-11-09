import { ThemeManifest, HandMode } from '../types/theme';
import { calculateHandAngles, calculatePendulumAngle } from '../utils/math';
import { ClockDomElements } from './themeLoader';

export interface ClockEngineOptions {
  secondMode?: HandMode;
  timeMultiplier?: number;
}

export class ClockEngine {
  private elements: ClockDomElements;
  private manifest: ThemeManifest | null = null;
  private isRunning = false;
  private animationFrameId: number | null = null;

  // Second hand mode
  private secondMode: HandMode = 'tick';

  // Time simulation variables
  private timeMultiplier = 1.0;
  private baseSimulatedTime = Date.now();
  private baseRealTime = performance.now();

  // Callbacks for HUD/Overlay updates
  private onTickListeners: Array<(currentDate: Date, pendulumAngle: number) => void> = [];

  constructor(elements: ClockDomElements, options?: ClockEngineOptions) {
    this.elements = elements;
    if (options?.secondMode) {
      this.secondMode = options.secondMode;
    }
    if (options?.timeMultiplier) {
      this.timeMultiplier = options.timeMultiplier;
    }
  }

  public setManifest(manifest: ThemeManifest): void {
    this.manifest = manifest;
    if (manifest.hands.second.mode) {
      this.secondMode = manifest.hands.second.mode;
    }
  }

  /**
   * Starts the synchronized requestAnimationFrame loop
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.baseRealTime = performance.now();
    this.baseSimulatedTime = Date.now();

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
    if (!this.manifest) return;

    // Calculate current simulated time
    const nowPerf = performance.now();
    const elapsedRealMs = nowPerf - this.baseRealTime;
    const currentSimulatedMs = this.baseSimulatedTime + elapsedRealMs * this.timeMultiplier;
    const currentDate = new Date(currentSimulatedMs);

    // 1. Calculate Hand Angles
    const angles = calculateHandAngles(currentDate, this.secondMode);

    // 2. Apply Rotations to Hands
    this.elements.handHour.style.transform = `rotate(${angles.hour.toFixed(3)}deg)`;
    this.elements.handMinute.style.transform = `rotate(${angles.minute.toFixed(3)}deg)`;
    this.elements.handSecond.style.transform = `rotate(${angles.second.toFixed(3)}deg)`;

    // 3. Simple Harmonic Motion for Pendulum
    // Pendulum phase is locked to epoch time in seconds
    const tSeconds = currentSimulatedMs / 1000;
    const pendulumAngle = calculatePendulumAngle(
      tSeconds,
      this.manifest.pendulum.periodSeconds,
      this.manifest.pendulum.maxAngleDeg
    );

    this.elements.pendulum.style.transform = `rotate(${pendulumAngle.toFixed(3)}deg)`;

    // Notify listeners
    for (const listener of this.onTickListeners) {
      listener(currentDate, pendulumAngle);
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

  public addOnTickListener(listener: (currentDate: Date, pendulumAngle: number) => void): () => void {
    this.onTickListeners.push(listener);
    return () => {
      this.onTickListeners = this.onTickListeners.filter((l) => l !== listener);
    };
  }
}

