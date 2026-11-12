/**
 * Pure Procedural Web Audio API Sound Synthesis Engine
 * Zero external audio files or dependencies.
 *
 * Theme-Adaptive Sound Profiles:
 * 1. Vienna Classic (`vienna_classic`):
 *    - Escapement Tick-Tock: Warm, woody Graham deadbeat escapement impulse using
 *      filtered noise bursts + low-mid body resonance (~180 Hz–420 Hz) with asymmetric
 *      pitch/envelope alternation between 'tick' (left-to-right) and 'tock' (right-to-left).
 *    - Hour / Quarter Chimes: Warm brass/bell harmonic chimes (additive sine/triangle partials
 *      with natural exponential decay) on the hour and quarter hour.
 *
 * 2. PCB-2049 & Emerald Rev B (`pcb_2049`, `pcb_2049_emerald`):
 *    - Electromechanical Relay / Solenoid Tick: Crisp miniature reed-relay snap
 *      (high-pass transient click + brief metallic ring around 2.4 kHz–3.8 kHz) synchronized
 *      to pendulum zero-crossings.
 *    - Telemetry Alert Chirp: Dual-tone hardware telemetry chirp scaled by alert priority
 *      when notifications trigger.
 *    - Hour Pulse: Clean, futuristic harmonic quartz FM chime on the hour.
 */

import { ClockMode, NotificationPriority } from '../types/theme';

export type TickDirection =
  | 'tick'
  | 'tock'
  | 'left'
  | 'right'
  | 'left-to-right'
  | 'right-to-left';

export type SoundProfile = 'vienna_classic' | 'pcb_2049' | 'pcb_2049_emerald';

export class ClockAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private clockMode: ClockMode = 'active';
  private volume: number = 0.5; // 0.0 to 1.0
  private chimesEnabled: boolean = true;
  private activeProfile: SoundProfile = 'pcb_2049';
  private lastTickWasTick: boolean = false;
  private isUnlocked: boolean = false;
  private noiseBuffer: AudioBuffer | null = null;
  private activeChimeTimeouts: number[] = [];
  private unlockListeners: Array<{ event: string; fn: () => void }> = [];

  constructor() {
    this.setupAutoplayUnlock();
  }

  /**
   * Sets up graceful AudioContext unlock on first user gesture
   */
  private setupAutoplayUnlock(): void {
    const unlock = () => {
      const audioCtx = this.initAudioContext();
      if (audioCtx.state === 'suspended') {
        audioCtx
          .resume()
          .then(() => {
            this.isUnlocked = true;
          })
          .catch(() => {});
      } else if (audioCtx.state === 'running') {
        this.isUnlocked = true;
      }
      this.cleanupUnlockListeners();
    };

    const events = ['pointerdown', 'click', 'keydown', 'touchstart', 'mousedown'];
    for (const evt of events) {
      const handler = () => unlock();
      this.unlockListeners.push({ event: evt, fn: handler });
      window.addEventListener(evt, handler, { once: true, passive: true });
    }
  }

  private cleanupUnlockListeners(): void {
    for (const { event, fn } of this.unlockListeners) {
      window.removeEventListener(event, fn);
    }
    this.unlockListeners = [];
  }

  public getIsUnlocked(): boolean {
    return this.isUnlocked || (this.ctx !== null && this.ctx.state === 'running');
  }

  /**
   * Explicitly unlocks or resumes the Web Audio AudioContext
   */
  public async unlock(): Promise<boolean> {
    const audioCtx = this.initAudioContext();
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch {
        // Ignore autoplay restriction rejections
      }
    }
    this.isUnlocked = audioCtx.state === 'running';
    return this.isUnlocked;
  }

  public async resume(): Promise<boolean> {
    return this.unlock();
  }

  /**
   * Initializes or returns the singleton AudioContext
   */
  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  /**
   * Generates or retrieves a pre-populated procedural white noise buffer
   * Zero external audio files required.
   */
  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer) {
      const sampleRate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) {
        channel[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  /**
   * Sets the active sound profile based on theme id
   */
  public setTheme(themeId: string): void {
    const clean = themeId.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (clean === 'vienna' || clean === 'vienna_classic' || clean === 'default') {
      this.activeProfile = 'vienna_classic';
    } else if (clean === 'pcb_2049_emerald' || clean.includes('emerald')) {
      this.activeProfile = 'pcb_2049_emerald';
    } else {
      this.activeProfile = 'pcb_2049';
    }
  }

  public getTheme(): SoundProfile {
    return this.activeProfile;
  }

  public setSoundProfile(profile: SoundProfile): void {
    this.activeProfile = profile;
  }

  public getSoundProfile(): SoundProfile {
    return this.activeProfile;
  }

  /**
   * Triggered phase-locked from pendulum zero-crossing in ClockEngine.
   * Alternates between 'tick' (left-to-right) and 'tock' (right-to-left).
   */
  public onEscapementTick(direction?: TickDirection): void {
    // Mode guard: ticks muted in silent, night, and sleep modes
    if (this.clockMode !== 'active') return;
    if (this.isMuted || this.volume <= 0) return;

    // Check context readiness without throwing
    if (!this.ctx) {
      return;
    }
    if (this.ctx.state !== 'running') {
      // AudioContext may be suspended by browser autoplay policy
      return;
    }

    const isTick =
      direction === 'tick' ||
      direction === 'left-to-right' ||
      direction === 'left' ||
      (direction === undefined && !this.lastTickWasTick);
    this.lastTickWasTick = isTick;

    if (this.activeProfile === 'vienna_classic') {
      this.playViennaEscapement(isTick);
    } else {
      const isEmerald = this.activeProfile === 'pcb_2049_emerald';
      this.playRelayEscapement(isTick, isEmerald);
    }
  }

  /**
   * Backwards-compatible alias for onEscapementTick
   */
  public playEscapement(forceType?: 'tick' | 'tock'): void {
    this.onEscapementTick(forceType);
  }

  /**
   * Vienna Classic: Warm woody deadbeat escapement impulse
   * Filtered noise burst + low-mid body resonance (~180 Hz - 420 Hz)
   */
  private playViennaEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.42, t);
    masterGain.connect(this.ctx.destination);

    // 1. Filtered Mechanical Pallet Noise Burst
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const bpFilter = this.ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(isTick ? 2350 : 1680, t);
      bpFilter.Q.setValueAtTime(isTick ? 2.8 : 2.2, t);

      const hpFilter = this.ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.setValueAtTime(isTick ? 1150 : 750, t);

      const noiseGain = this.ctx.createGain();
      const burstDuration = isTick ? 0.022 : 0.028;
      noiseGain.gain.setValueAtTime(isTick ? 0.62 : 0.45, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + burstDuration);

      noiseSource.connect(bpFilter);
      bpFilter.connect(hpFilter);
      hpFilter.connect(noiseGain);
      noiseGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + burstDuration + 0.01);
    }

    // 2. Low-Mid Wooden Body Resonance (~180 Hz - 420 Hz)
    const bodyOsc = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    const bodyFilter = this.ctx.createBiquadFilter();

    bodyOsc.type = 'sine';
    const startFreq = isTick ? 370 : 245;
    const endFreq = isTick ? 175 : 115;
    const bodyDuration = isTick ? 0.042 : 0.055;

    bodyOsc.frequency.setValueAtTime(startFreq, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(endFreq, t + bodyDuration);

    bodyFilter.type = 'bandpass';
    bodyFilter.frequency.setValueAtTime(isTick ? 345 : 215, t);
    bodyFilter.Q.setValueAtTime(isTick ? 3.6 : 3.0, t);

    bodyGain.gain.setValueAtTime(isTick ? 0.52 : 0.68, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + bodyDuration);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(masterGain);

    bodyOsc.start(t);
    bodyOsc.stop(t + bodyDuration + 0.01);

    // 3. Subtle Steel Tooth Clink (Micro-impulse)
    const clinkOsc = this.ctx.createOscillator();
    const clinkGain = this.ctx.createGain();
    clinkOsc.type = 'triangle';
    clinkOsc.frequency.setValueAtTime(isTick ? 2750 : 2080, t);

    const clinkDuration = isTick ? 0.012 : 0.016;
    clinkGain.gain.setValueAtTime(0.16, t);
    clinkGain.gain.exponentialRampToValueAtTime(0.0001, t + clinkDuration);

    clinkOsc.connect(clinkGain);
    clinkGain.connect(masterGain);

    clinkOsc.start(t);
    clinkOsc.stop(t + clinkDuration + 0.005);
  }

  /**
   * PCB-2049 / Emerald Rev B: Crisp miniature reed-relay / solenoid snap
   * High-passed transient click + brief metallic ring around 2.4 kHz - 3.8 kHz
   */
  private playRelayEscapement(isTick: boolean, isEmerald: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.38, t);
    masterGain.connect(this.ctx.destination);

    // 1. High-Passed Transient Click (Contact closure impulse)
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const hpFilter = this.ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.setValueAtTime(isEmerald ? 4600 : 3900, t);
      hpFilter.Q.setValueAtTime(1.4, t);

      const clickGain = this.ctx.createGain();
      const clickDuration = 0.006; // 6ms tight click
      clickGain.gain.setValueAtTime(0.72, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDuration);

      noiseSource.connect(hpFilter);
      hpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + clickDuration + 0.005);
    }

    // 2. Miniature Metallic Reed Ring (2.4 kHz - 3.8 kHz)
    const ringOsc = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    const ringFilter = this.ctx.createBiquadFilter();

    ringOsc.type = 'sine';
    const ringFreq = isEmerald ? (isTick ? 3680 : 3040) : isTick ? 3420 : 2810;
    const ringDuration = isTick ? 0.018 : 0.024;

    ringOsc.frequency.setValueAtTime(ringFreq, t);

    ringFilter.type = 'bandpass';
    ringFilter.frequency.setValueAtTime(ringFreq, t);
    ringFilter.Q.setValueAtTime(isEmerald ? 22 : 18, t);

    ringGain.gain.setValueAtTime(isTick ? 0.65 : 0.52, t);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + ringDuration);

    ringOsc.connect(ringFilter);
    ringFilter.connect(ringGain);
    ringGain.connect(masterGain);

    ringOsc.start(t);
    ringOsc.stop(t + ringDuration + 0.005);

    // 3. Solenoid Micro-Frame Shock
    const frameOsc = this.ctx.createOscillator();
    const frameGain = this.ctx.createGain();
    frameOsc.type = 'triangle';
    frameOsc.frequency.setValueAtTime(isEmerald ? 960 : 840, t);
    frameGain.gain.setValueAtTime(0.20, t);
    frameGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.009);

    frameOsc.connect(frameGain);
    frameGain.connect(masterGain);

    frameOsc.start(t);
    frameOsc.stop(t + 0.012);
  }

  /**
   * Synthesizes a tubular brass bell chime note (fundamental + inharmonic overtones)
   * Warm brass/bell acoustics (f, 2.76f, 5.40f, 8.93f) with additive sine/triangle partials
   */
  public playBellTone(
    fundamentalFreq: number,
    durationSec: number = 3.5,
    intensity: number = 1.0
  ): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * intensity * 0.4, t);
    masterGain.connect(this.ctx.destination);

    // Warm brass bell partials (additive sine/triangle with exponential decay)
    const harmonics: Array<{ ratio: number; gain: number; decay: number; type: OscillatorType }> = [
      { ratio: 1.0, gain: 0.9, decay: durationSec, type: 'sine' },
      { ratio: 2.76, gain: 0.55, decay: durationSec * 0.78, type: 'triangle' },
      { ratio: 5.4, gain: 0.28, decay: durationSec * 0.52, type: 'sine' },
      { ratio: 8.93, gain: 0.14, decay: durationSec * 0.32, type: 'sine' }
    ];

    for (const h of harmonics) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = h.type;
      osc.frequency.setValueAtTime(fundamentalFreq * h.ratio, t);

      // Strike attack & natural exponential ringing decay
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(h.gain, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + h.decay);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + h.decay + 0.05);
    }
  }

  /**
   * Plays Westminster cadence for quarters and hour strike lead-in
   */
  public playWestminsterCadence(): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const cadence = [
      { note: 415.3, delay: 0.0 }, // G#4
      { note: 369.99, delay: 0.55 }, // F#4
      { note: 329.63, delay: 1.1 }, // E4
      { note: 246.94, delay: 1.65 } // B3
    ];

    for (const step of cadence) {
      const timerId = window.setTimeout(() => {
        if (!this.isMuted && this.chimesEnabled) {
          this.playBellTone(step.note, 2.6, 0.75);
        }
      }, step.delay * 1000);
      this.activeChimeTimeouts.push(timerId);
    }
  }

  /**
   * Plays Westminster hour strike count (strikes count times at top of hour)
   */
  public playHourStrikes(count: number): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const safeCount = Math.max(1, Math.min(12, count));
    const strikeIntervalSec = 2.4;

    this.playWestminsterCadence();

    const cadenceOffset = 2.5;
    for (let i = 0; i < safeCount; i++) {
      const timerId = window.setTimeout(() => {
        if (!this.isMuted && this.chimesEnabled) {
          // Deep E3 tubular bell (164.81 Hz)
          this.playBellTone(164.81, 4.2, 1.0);
        }
      }, (cadenceOffset + i * strikeIntervalSec) * 1000);
      this.activeChimeTimeouts.push(timerId);
    }
  }

  /**
   * PCB-2049 / Emerald Rev B: Clean futuristic harmonic quartz/FM chime on the hour
   */
  private playFuturisticQuartzHourPulse(isEmerald: boolean): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const t = this.ctx.currentTime;
    const emeraldMult = isEmerald ? 1.05 : 1.0;

    // Harmonic quartz crystalline chord: C6 (1046.5), G6 (1568), C7 (2093), E7 (2637)
    const notes = [
      { freq: 1046.5 * emeraldMult, time: 0.0, decay: 2.8, gain: 0.7 },
      { freq: 1567.98 * emeraldMult, time: 0.12, decay: 2.6, gain: 0.65 },
      { freq: 2093.0 * emeraldMult, time: 0.24, decay: 2.4, gain: 0.55 },
      { freq: 2637.02 * emeraldMult, time: 0.36, decay: 2.2, gain: 0.45 }
    ];

    for (const note of notes) {
      const noteTime = t + note.time;
      const carrierOsc = this.ctx.createOscillator();
      const carrierGain = this.ctx.createGain();
      const modOsc = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();

      carrierOsc.type = 'sine';
      carrierOsc.frequency.setValueAtTime(note.freq, noteTime);

      // FM Modulator: ratio 2.002 creates quartz crystal harmonic shimmer
      modOsc.type = 'sine';
      modOsc.frequency.setValueAtTime(note.freq * 2.002, noteTime);

      // Modulator index decays rapidly, yielding crisp initial quartz strike then pure sine ring
      modGain.gain.setValueAtTime(note.freq * 1.6, noteTime);
      modGain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.6);

      modOsc.connect(modGain);
      modGain.connect(carrierOsc.frequency);

      carrierGain.gain.setValueAtTime(0.0001, noteTime);
      carrierGain.gain.linearRampToValueAtTime(this.volume * note.gain * 0.35, noteTime + 0.004);
      carrierGain.gain.exponentialRampToValueAtTime(0.0001, noteTime + note.decay);

      carrierOsc.connect(carrierGain);
      carrierGain.connect(this.ctx.destination);

      modOsc.start(noteTime);
      modOsc.stop(noteTime + note.decay + 0.05);
      carrierOsc.start(noteTime);
      carrierOsc.stop(noteTime + note.decay + 0.05);
    }
  }

  /**
   * Top of the hour hook: dispatches theme-adaptive hour chime
   */
  public onHour(hour: number): void {
    // Mode guard: chimes muted in silent, night, and sleep modes
    if (this.clockMode !== 'active') return;
    if (!this.chimesEnabled || this.isMuted || this.volume <= 0) return;
    if (this.activeProfile === 'vienna_classic') {
      const count = hour % 12 || 12;
      this.playHourStrikes(count);
    } else {
      const isEmerald = this.activeProfile === 'pcb_2049_emerald';
      this.playFuturisticQuartzHourPulse(isEmerald);
    }
  }

  /**
   * Quarter hour hook: dispatches subtle quarter strike
   */
  public onQuarter(minute: number): void {
    // Mode guard: chimes muted in silent, night, and sleep modes
    if (this.clockMode !== 'active') return;
    if (!this.chimesEnabled || this.isMuted || this.volume <= 0) return;
    if (this.activeProfile === 'vienna_classic') {
      const phraseCount = minute === 45 ? 3 : minute === 30 ? 2 : 1;
      for (let p = 0; p < phraseCount; p++) {
        const timerId = window.setTimeout(() => {
          if (!this.isMuted && this.chimesEnabled) {
            this.playWestminsterCadence();
          }
        }, p * 2200);
        this.activeChimeTimeouts.push(timerId);
      }
    } else {
      // Subtle quartz ping for futuristic PCB
      if (!this.ctx || this.ctx.state !== 'running') return;
      const isEmerald = this.activeProfile === 'pcb_2049_emerald';
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isEmerald ? 2349.3 : 2093.0, t);

      gain.gain.setValueAtTime(this.volume * 0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 1.25);
    }
  }

  /**
   * PCB-2049 & Emerald Rev B: Dual-tone hardware telemetry chirp
   * Scaled by alert priority (normal vs urgent)
   */
  private playTelemetryChirp(priority: 'normal' | 'urgent', isEmerald: boolean): void {
    if (!this.ctx || this.isMuted || this.volume <= 0 || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const isUrgent = priority === 'urgent';
    const baseGain = this.volume * (isUrgent ? 0.42 : 0.28);

    const playDualTone = (
      startTime: number,
      f1Start: number,
      f1End: number,
      f2Start: number,
      f2End: number,
      duration: number,
      gainScale: number
    ) => {
      if (!this.ctx) return;
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, startTime);
      masterGain.gain.linearRampToValueAtTime(baseGain * gainScale, startTime + 0.004);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      masterGain.connect(this.ctx.destination);

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(f1Start, startTime);
      osc1.frequency.exponentialRampToValueAtTime(f1End, startTime + duration);

      osc2.frequency.setValueAtTime(f2Start, startTime);
      osc2.frequency.exponentialRampToValueAtTime(f2End, startTime + duration);

      osc1.connect(masterGain);
      osc2.connect(masterGain);

      osc1.start(startTime);
      osc1.stop(startTime + duration + 0.01);
      osc2.start(startTime);
      osc2.stop(startTime + duration + 0.01);
    };

    const pitchMult = isEmerald ? 1.08 : 1.0;

    if (!isUrgent) {
      // Gentle affirmative dual chirp (C6 + G6 ramping to E6 + B6)
      playDualTone(
        t,
        1046.5 * pitchMult,
        1318.5 * pitchMult,
        1568.0 * pitchMult,
        1975.5 * pitchMult,
        0.085,
        0.75
      );
    } else {
      // High-priority dual chirp ascending burst
      playDualTone(
        t,
        1396.9 * pitchMult,
        1760.0 * pitchMult,
        2093.0 * pitchMult,
        2637.0 * pitchMult,
        0.055,
        0.9
      );
      playDualTone(
        t + 0.075,
        1760.0 * pitchMult,
        2217.4 * pitchMult,
        2637.0 * pitchMult,
        3322.4 * pitchMult,
        0.07,
        1.0
      );
    }
  }

  /**
   * Dispatches theme-adaptive notification alert sound
   */
  public playNotificationAlert(
    priority?: NotificationPriority | 'normal' | 'urgent',
    category?: string
  ): void {
    // Mode guards
    if (this.clockMode === 'sleep') return; // all audio muted in sleep mode
    if (this.isMuted || this.volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;

    const isUrgent =
      priority === 'urgent' ||
      priority === 'high' ||
      priority === 'critical' ||
      category === 'alert';

    // In night mode, only allow high/critical/urgent alerts
    if (this.clockMode === 'night' && !isUrgent) {
      return;
    }

    if (this.activeProfile === 'vienna_classic') {
      if (isUrgent) {
        // Ascending 3-tone brass chime: E5 -> G#5 -> B5
        this.playBellTone(659.25, 2.2, 0.7);
        setTimeout(() => this.playBellTone(830.61, 2.4, 0.8), 140);
        setTimeout(() => this.playBellTone(987.77, 3.0, 0.9), 280);
      } else {
        // Pleasant two-tone brass chime: E5 -> B5
        this.playBellTone(659.25, 2.0, 0.65);
        setTimeout(() => this.playBellTone(987.77, 2.8, 0.8), 180);
      }
    } else {
      const isEmerald = this.activeProfile === 'pcb_2049_emerald';
      this.playTelemetryChirp(isUrgent ? 'urgent' : 'normal', isEmerald);
    }
  }

  /**
   * Backwards-compatible notification chime method
   */
  public playNotificationChime(): void {
    this.playNotificationAlert('normal');
  }

  /**
   * Stops any pending chime intervals/timeouts
   */
  public stopAllChimes(): void {
    for (const tid of this.activeChimeTimeouts) {
      clearTimeout(tid);
    }
    this.activeChimeTimeouts = [];
  }

  // --- Controls & State ---

  public mute(): void {
    this.setMuted(true);
  }

  public unmute(): void {
    this.setMuted(false);
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stopAllChimes();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  public setChimesEnabled(enabled: boolean): void {
    this.chimesEnabled = enabled;
    if (!enabled) {
      this.stopAllChimes();
    }
  }

  public getChimesEnabled(): boolean {
    return this.chimesEnabled;
  }

  public toggleChimes(): boolean {
    this.setChimesEnabled(!this.chimesEnabled);
    return this.chimesEnabled;
  }

  public setClockMode(mode: ClockMode): void {
    this.clockMode = mode;
    if (mode === 'sleep' || mode === 'night' || mode === 'silent') {
      this.stopAllChimes();
    }
  }

  public getClockMode(): ClockMode {
    return this.clockMode;
  }

  public getState(): {
    muted: boolean;
    volume: number;
    chimesEnabled: boolean;
    theme: SoundProfile;
    isUnlocked: boolean;
    mode: ClockMode;
  } {
    return {
      muted: this.isMuted,
      volume: this.volume,
      chimesEnabled: this.chimesEnabled,
      theme: this.activeProfile,
      isUnlocked: this.getIsUnlocked(),
      mode: this.clockMode
    };
  }
}
