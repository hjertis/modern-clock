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

export type SoundProfile =
  | 'vienna_classic'
  | 'pcb_2049'
  | 'pcb_2049_emerald'
  | 'hybrid_base'
  | 'nixie_hybrid'
  | 'tourbillon_3d'
  | 'reactor_3d'
  | 'orrery_3d'
  | 'mariana_abyss';

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
    const clean = themeId.trim().toLowerCase().replace(/[\s/-]+/g, '_');
    if (clean === 'vienna' || clean === 'vienna_classic' || clean === 'default') {
      this.activeProfile = 'vienna_classic';
    } else if (
      clean === 'tourbillon_3d' ||
      clean === 'tourbillon' ||
      clean === 'horological_tourbillon' ||
      clean === 'horological_tourbillon_3d'
    ) {
      this.activeProfile = 'tourbillon_3d';
    } else if (
      clean === 'reactor_3d' ||
      clean === 'reactor' ||
      clean === 'chrono_containment_reactor' ||
      clean === 'chrono_reactor'
    ) {
      this.activeProfile = 'reactor_3d';
    } else if (
      clean === 'orrery_3d' ||
      clean === 'orrery' ||
      clean === 'celestial_astrolabe' ||
      clean === 'celestial_orrery' ||
      clean === 'celestial_astrolabe_&_orrery'
    ) {
      this.activeProfile = 'orrery_3d';
    } else if (
      clean === 'mariana_abyss' ||
      clean === 'mariana' ||
      clean === 'abyss'
    ) {
      this.activeProfile = 'mariana_abyss';
    } else if (
      clean === 'nixie_hybrid' ||
      clean === 'nixie' ||
      clean === 'nixie_chronograph'
    ) {
      this.activeProfile = 'nixie_hybrid';
    } else if (
      clean === 'hybrid_base' ||
      clean === 'hybrid' ||
      clean === 'hybrid_analog_digital'
    ) {
      this.activeProfile = 'hybrid_base';
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
    } else if (this.activeProfile === 'tourbillon_3d') {
      this.playTourbillonEscapement(isTick);
    } else if (this.activeProfile === 'reactor_3d') {
      this.playReactorEscapement(isTick);
    } else if (this.activeProfile === 'orrery_3d' || this.activeProfile === 'mariana_abyss') {
      this.playOrreryEscapement(isTick);
    } else if (this.activeProfile === 'nixie_hybrid') {
      this.playNixieReedEscapement(isTick);
    } else if (this.activeProfile === 'hybrid_base') {
      this.playHybridEscapement(isTick);
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
   * Hybrid Base: Clean precision mechanical escapement tick + subtle chime profile
   */
  private playHybridEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.36, t);
    masterGain.connect(this.ctx.destination);

    // 1. Crisp mechanical pallet impulse
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const bpFilter = this.ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(isTick ? 2900 : 2300, t);
      bpFilter.Q.setValueAtTime(3.2, t);

      const clickGain = this.ctx.createGain();
      const duration = isTick ? 0.011 : 0.014;
      clickGain.gain.setValueAtTime(0.6, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      noiseSource.connect(bpFilter);
      bpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + duration + 0.005);
    }

    // 2. Damped machined alloy body resonance
    const bodyOsc = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(isTick ? 620 : 480, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(isTick ? 280 : 210, t + 0.024);

    bodyGain.gain.setValueAtTime(0.45, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(masterGain);

    bodyOsc.start(t);
    bodyOsc.stop(t + 0.03);
  }

  private playHybridChime(isHour: boolean): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const t = this.ctx.currentTime;
    const notes = isHour
      ? [
          { freq: 587.33, offset: 0.0, decay: 2.0, gain: 0.55 }, // D5
          { freq: 880.0, offset: 0.16, decay: 2.4, gain: 0.65 } // A5
        ]
      : [{ freq: 880.0, offset: 0.0, decay: 1.4, gain: 0.4 }];

    for (const n of notes) {
      const startTime = t + n.offset;
      const osc = this.ctx.createOscillator();
      const overtone = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, startTime);

      overtone.type = 'triangle';
      overtone.frequency.setValueAtTime(n.freq * 2.0, startTime);

      const overtoneGain = this.ctx.createGain();
      overtoneGain.gain.setValueAtTime(0.22, startTime);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + n.decay * 0.5);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(this.volume * n.gain * 0.35, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + n.decay);

      osc.connect(gain);
      overtone.connect(overtoneGain);
      overtoneGain.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + n.decay + 0.05);
      overtone.start(startTime);
      overtone.stop(startTime + n.decay * 0.5 + 0.05);
    }
  }

  /**
   * Nixie Hybrid: Crisp dry-reed relay click inside a glass envelope + warm brass case resonance
   */
  private playNixieReedEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.38, t);
    masterGain.connect(this.ctx.destination);

    // 1. Crisp dry-reed switch contact snap
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const hpFilter = this.ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.setValueAtTime(isTick ? 3600 : 3100, t);
      hpFilter.Q.setValueAtTime(2.0, t);

      const clickGain = this.ctx.createGain();
      const clickDur = 0.007;
      clickGain.gain.setValueAtTime(0.68, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDur);

      noiseSource.connect(hpFilter);
      hpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + clickDur + 0.004);
    }

    // 2. Borosilicate glass envelope micro-ping + walnut/brass mount resonance
    const glassOsc = this.ctx.createOscillator();
    const glassGain = this.ctx.createGain();
    glassOsc.type = 'sine';
    glassOsc.frequency.setValueAtTime(isTick ? 4180 : 3520, t);
    glassGain.gain.setValueAtTime(0.28, t);
    glassGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);

    glassOsc.connect(glassGain);
    glassGain.connect(masterGain);
    glassOsc.start(t);
    glassOsc.stop(t + 0.026);

    const brassOsc = this.ctx.createOscillator();
    const brassGain = this.ctx.createGain();
    brassOsc.type = 'triangle';
    brassOsc.frequency.setValueAtTime(isTick ? 440 : 330, t);
    brassOsc.frequency.exponentialRampToValueAtTime(isTick ? 210 : 165, t + 0.032);
    brassGain.gain.setValueAtTime(0.36, t);
    brassGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.034);

    brassOsc.connect(brassGain);
    brassGain.connect(masterGain);
    brassOsc.start(t);
    brassOsc.stop(t + 0.038);
  }

  /**
   * Nixie Hybrid: Warm resonant brass-and-glass harmonic chime
   */
  private playNixieBrassGlassChime(isHour: boolean): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const t = this.ctx.currentTime;
    const sequence = isHour
      ? [
          { freq: 523.25, delay: 0.0, decay: 2.8, gain: 0.65 }, // C5 warm brass fundamental
          { freq: 783.99, delay: 0.22, decay: 3.1, gain: 0.72 }, // G5 fifth
          { freq: 1174.66, delay: 0.44, decay: 3.4, gain: 0.58 } // D6 glass harmonic
        ]
      : [{ freq: 783.99, delay: 0.0, decay: 2.0, gain: 0.5 }];

    for (const step of sequence) {
      const startTime = t + step.delay;
      const brassOsc = this.ctx.createOscillator();
      const glassHarmonic = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      const glassGain = this.ctx.createGain();

      brassOsc.type = 'sine';
      brassOsc.frequency.setValueAtTime(step.freq, startTime);

      // Inharmonic borosilicate glass overtone (2.756x)
      glassHarmonic.type = 'sine';
      glassHarmonic.frequency.setValueAtTime(step.freq * 2.756, startTime);

      glassGain.gain.setValueAtTime(0.26, startTime);
      glassGain.gain.exponentialRampToValueAtTime(0.0001, startTime + step.decay * 0.65);

      noteGain.gain.setValueAtTime(0.0001, startTime);
      noteGain.gain.linearRampToValueAtTime(this.volume * step.gain * 0.38, startTime + 0.006);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + step.decay);

      brassOsc.connect(noteGain);
      glassHarmonic.connect(glassGain);
      glassGain.connect(noteGain);
      noteGain.connect(this.ctx.destination);

      brassOsc.start(startTime);
      brassOsc.stop(startTime + step.decay + 0.05);
      glassHarmonic.start(startTime);
      glassHarmonic.stop(startTime + step.decay * 0.65 + 0.05);
    }
  }

  /**
   * Tourbillon 3D: Rich mechanical Swiss lever ruby-pallet escapement tick +
   * Breguet hairspring overtone ring + deep walnut/brass cabinet resonance.
   */
  private playTourbillonEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.44, t);
    masterGain.connect(this.ctx.destination);

    // 1. Ruby pallet locking & impulse snap
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const bpFilter = this.ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(isTick ? 3150 : 2540, t);
      bpFilter.Q.setValueAtTime(3.6, t);

      const clickGain = this.ctx.createGain();
      const clickDur = isTick ? 0.015 : 0.019;
      clickGain.gain.setValueAtTime(isTick ? 0.7 : 0.56, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDur);

      noiseSource.connect(bpFilter);
      bpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + clickDur + 0.005);
    }

    // 2. Breguet hairspring & escape wheel tooth metallic micro-ring
    const ringOsc = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ringOsc.type = 'sine';
    ringOsc.frequency.setValueAtTime(isTick ? 3480 : 2890, t);
    ringGain.gain.setValueAtTime(0.24, t);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);

    ringOsc.connect(ringGain);
    ringGain.connect(masterGain);
    ringOsc.start(t);
    ringOsc.stop(t + 0.032);

    // 3. Deep walnut chamber & heavy brass bridge acoustic resonance
    const bodyOsc = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(isTick ? 295 : 215, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(isTick ? 130 : 98, t + 0.052);

    bodyGain.gain.setValueAtTime(0.58, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(masterGain);
    bodyOsc.start(t);
    bodyOsc.stop(t + 0.06);
  }

  /**
   * Tourbillon 3D: Deep resonant cathedral gong chime (fundamental + sub-octave hum + bronze overtones)
   */
  private playCathedralChime(isHour: boolean, hourCount = 1): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const strikeCathedralBell = (freq: number, durationSec: number, gainScale: number) => {
      if (!this.ctx || this.isMuted || !this.chimesEnabled) return;
      const now = this.ctx.currentTime;
      const bellMaster = this.ctx.createGain();
      bellMaster.gain.setValueAtTime(this.volume * gainScale * 0.44, now);
      bellMaster.connect(this.ctx.destination);

      // Deep cathedral bronze partials: sub-hum (0.5x), fundamental (1.0x), minor third/fifth/bell overtones
      const partials: Array<{ ratio: number; gain: number; decay: number; type: OscillatorType }> = [
        { ratio: 0.5, gain: 0.65, decay: durationSec * 1.15, type: 'sine' },
        { ratio: 1.0, gain: 0.95, decay: durationSec, type: 'sine' },
        { ratio: 1.5, gain: 0.52, decay: durationSec * 0.82, type: 'triangle' },
        { ratio: 2.756, gain: 0.36, decay: durationSec * 0.64, type: 'sine' },
        { ratio: 5.404, gain: 0.16, decay: durationSec * 0.4, type: 'sine' }
      ];

      for (const p of partials) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = p.type;
        osc.frequency.setValueAtTime(freq * p.ratio, now);

        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(p.gain, now + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

        osc.connect(g);
        g.connect(bellMaster);
        osc.start(now);
        osc.stop(now + p.decay + 0.05);
      }
    };

    if (!isHour) {
      // Deep cathedral fifth cadence on quarter-hour: B2 (123.47 Hz) -> E2 (82.41 Hz)
      strikeCathedralBell(123.47, 3.4, 0.72);
      const tid = window.setTimeout(() => strikeCathedralBell(82.41, 4.2, 0.85), 680);
      this.activeChimeTimeouts.push(tid);
      return;
    }

    // Hour strike: deep cathedral chord lead-in followed by low C2/E2 (82.41 Hz) tolling strikes
    const safeCount = Math.max(1, Math.min(12, hourCount));
    strikeCathedralBell(164.81, 3.8, 0.75); // E3
    const leadId = window.setTimeout(() => strikeCathedralBell(123.47, 4.2, 0.82), 650); // B2
    this.activeChimeTimeouts.push(leadId);

    const strikeOffsetSec = 1.6;
    const strikeIntervalSec = 2.5;
    for (let i = 0; i < safeCount; i++) {
      const tid = window.setTimeout(() => {
        strikeCathedralBell(82.41, 5.2, 1.0); // Deep E2 cathedral bourdon bell
      }, (strikeOffsetSec + i * strikeIntervalSec) * 1000);
      this.activeChimeTimeouts.push(tid);
    }
  }

  /**
   * Reactor 3D: Crisp high-voltage vacuum relay tick + copper busbar ring + magnetic coil thump.
   */
  private playReactorEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.42, t);
    masterGain.connect(this.ctx.destination);

    // 1. High-voltage vacuum contactor snap
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const hpFilter = this.ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.setValueAtTime(isTick ? 4200 : 3500, t);
      hpFilter.Q.setValueAtTime(2.2, t);

      const clickGain = this.ctx.createGain();
      const clickDur = 0.008;
      clickGain.gain.setValueAtTime(isTick ? 0.78 : 0.64, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDur);

      noiseSource.connect(hpFilter);
      hpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + clickDur + 0.004);
    }

    // 2. Metallic copper busbar transient ring
    const ringOsc = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ringOsc.type = 'sine';
    ringOsc.frequency.setValueAtTime(isTick ? 2880 : 2340, t);
    ringGain.gain.setValueAtTime(0.32, t);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);

    ringOsc.connect(ringGain);
    ringGain.connect(masterGain);
    ringOsc.start(t);
    ringOsc.stop(t + 0.026);

    // 3. Low magnetic containment coil thump
    const coilOsc = this.ctx.createOscillator();
    const coilGain = this.ctx.createGain();
    coilOsc.type = 'triangle';
    coilOsc.frequency.setValueAtTime(isTick ? 145 : 118, t);
    coilOsc.frequency.exponentialRampToValueAtTime(65, t + 0.042);

    coilGain.gain.setValueAtTime(0.52, t);
    coilGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

    coilOsc.connect(coilGain);
    coilGain.connect(masterGain);
    coilOsc.start(t);
    coilOsc.stop(t + 0.05);
  }

  /**
   * Reactor 3D: Deep harmonic containment chime (tokamak sub-bass + fifth + FM Cherenkov overtones).
   */
  private playReactorContainmentChime(isHour: boolean, hourCount = 1): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const triggerContainmentResonance = (baseFreq: number, durationSec: number, scale: number) => {
      if (!this.ctx || this.isMuted || !this.chimesEnabled) return;
      const now = this.ctx.currentTime;
      const master = this.ctx.createGain();
      master.gain.setValueAtTime(this.volume * scale * 0.42, now);
      master.connect(this.ctx.destination);

      const partials: Array<{ freq: number; gain: number; decay: number; type: OscillatorType }> = [
        { freq: baseFreq, gain: 0.9, decay: durationSec, type: 'sine' }, // D2 / A2 sub-bass
        { freq: baseFreq * 1.5, gain: 0.55, decay: durationSec * 0.9, type: 'triangle' }, // Fifth
        { freq: 220.0, gain: 0.42, decay: durationSec * 0.78, type: 'sine' },
        { freq: 329.63, gain: 0.28, decay: durationSec * 0.64, type: 'sine' },
        { freq: 440.0, gain: 0.2, decay: durationSec * 0.52, type: 'sine' }
      ];

      for (const p of partials) {
        const osc = this.ctx.createOscillator();
        const mod = this.ctx.createOscillator();
        const modGain = this.ctx.createGain();
        const g = this.ctx.createGain();

        osc.type = p.type;
        osc.frequency.setValueAtTime(p.freq, now);

        mod.type = 'sine';
        mod.frequency.setValueAtTime(p.freq * 2.003, now);
        modGain.gain.setValueAtTime(p.freq * 0.35, now);
        modGain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);

        mod.connect(modGain);
        modGain.connect(osc.frequency);

        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(p.gain, now + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

        osc.connect(g);
        g.connect(master);

        mod.start(now);
        mod.stop(now + p.decay + 0.05);
        osc.start(now);
        osc.stop(now + p.decay + 0.05);
      }
    };

    if (!isHour) {
      triggerContainmentResonance(110.0, 3.2, 0.72); // A2 containment quarter pulse
      return;
    }

    const safeCount = Math.max(1, Math.min(12, hourCount));
    triggerContainmentResonance(110.0, 3.6, 0.78);
    const tid = window.setTimeout(() => {
      triggerContainmentResonance(73.42, 4.8, 0.95); // Deep D2 tokamak harmonic
    }, 520);
    this.activeChimeTimeouts.push(tid);

    for (let i = 0; i < Math.min(3, safeCount); i++) {
      const pulseId = window.setTimeout(() => {
        triggerContainmentResonance(146.83, 2.8, 0.55); // D3 harmonic lock pulse
      }, (1.8 + i * 1.4) * 1000);
      this.activeChimeTimeouts.push(pulseId);
    }
  }

  /**
   * Orrery 3D: Crisp astronomical observatory regulator tick + warm brass meridian gear ring.
   */
  private playOrreryEscapement(isTick: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.4, t);
    masterGain.connect(this.ctx.destination);

    // 1. Precision chronometer impulse noise
    const noiseBuffer = this.getNoiseBuffer();
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const bpFilter = this.ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(isTick ? 3450 : 2760, t);
      bpFilter.Q.setValueAtTime(3.2, t);

      const clickGain = this.ctx.createGain();
      const clickDur = 0.012;
      clickGain.gain.setValueAtTime(isTick ? 0.68 : 0.54, t);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDur);

      noiseSource.connect(bpFilter);
      bpFilter.connect(clickGain);
      clickGain.connect(masterGain);

      noiseSource.start(t, Math.random() * 1.5);
      noiseSource.stop(t + clickDur + 0.005);
    }

    // 2. Aged astronomical brass astrolabe ring resonance
    const brassOsc = this.ctx.createOscillator();
    const brassGain = this.ctx.createGain();
    brassOsc.type = 'sine';
    brassOsc.frequency.setValueAtTime(isTick ? 2420 : 1960, t);
    brassGain.gain.setValueAtTime(0.28, t);
    brassGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

    brassOsc.connect(brassGain);
    brassGain.connect(masterGain);
    brassOsc.start(t);
    brassOsc.stop(t + 0.036);

    // 3. Walnut observatory case low warmth
    const woodOsc = this.ctx.createOscillator();
    const woodGain = this.ctx.createGain();
    woodOsc.type = 'triangle';
    woodOsc.frequency.setValueAtTime(isTick ? 220 : 172, t);
    woodOsc.frequency.exponentialRampToValueAtTime(88, t + 0.048);

    woodGain.gain.setValueAtTime(0.46, t);
    woodGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.052);

    woodOsc.connect(woodGain);
    woodGain.connect(masterGain);
    woodOsc.start(t);
    woodOsc.stop(t + 0.058);
  }

  /**
   * Orrery 3D: Resonant astronomical observatory chime (glass celestial harmonics + deep brass gong).
   */
  private playOrreryObservatoryChime(isHour: boolean, hourCount = 1): void {
    if (
      this.isMuted ||
      !this.chimesEnabled ||
      this.volume <= 0 ||
      !this.ctx ||
      this.ctx.state !== 'running'
    )
      return;

    const strikeObservatoryBell = (freq: number, durationSec: number, gainScale: number) => {
      if (!this.ctx || this.isMuted || !this.chimesEnabled) return;
      const now = this.ctx.currentTime;
      const master = this.ctx.createGain();
      master.gain.setValueAtTime(this.volume * gainScale * 0.42, now);
      master.connect(this.ctx.destination);

      const partials: Array<{ ratio: number; gain: number; decay: number; type: OscillatorType }> = [
        { ratio: 0.5, gain: 0.52, decay: durationSec * 1.1, type: 'sine' },
        { ratio: 1.0, gain: 0.9, decay: durationSec, type: 'sine' },
        { ratio: 1.5, gain: 0.48, decay: durationSec * 0.85, type: 'sine' },
        { ratio: 2.0, gain: 0.34, decay: durationSec * 0.72, type: 'triangle' },
        { ratio: 3.12, gain: 0.22, decay: durationSec * 0.55, type: 'sine' }
      ];

      for (const p of partials) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = p.type;
        osc.frequency.setValueAtTime(freq * p.ratio, now);

        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(p.gain, now + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

        osc.connect(g);
        g.connect(master);
        osc.start(now);
        osc.stop(now + p.decay + 0.05);
      }
    };

    if (!isHour) {
      // Quarter-hour celestial triad: D4 -> A3
      strikeObservatoryBell(293.66, 3.0, 0.68);
      const tid = window.setTimeout(() => strikeObservatoryBell(220.0, 3.8, 0.82), 540);
      this.activeChimeTimeouts.push(tid);
      return;
    }

    const safeCount = Math.max(1, Math.min(12, hourCount));
    strikeObservatoryBell(293.66, 3.4, 0.72); // D4
    const leadId = window.setTimeout(() => strikeObservatoryBell(220.0, 4.0, 0.8), 520); // A3
    this.activeChimeTimeouts.push(leadId);

    for (let i = 0; i < Math.min(4, safeCount); i++) {
      const tid = window.setTimeout(() => {
        strikeObservatoryBell(146.83, 4.8, 0.96); // Deep D3 meridian gong
      }, (1.45 + i * 2.1) * 1000);
      this.activeChimeTimeouts.push(tid);
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
    } else if (this.activeProfile === 'tourbillon_3d') {
      const count = hour % 12 || 12;
      this.playCathedralChime(true, count);
    } else if (this.activeProfile === 'reactor_3d') {
      const count = hour % 12 || 12;
      this.playReactorContainmentChime(true, count);
    } else if (this.activeProfile === 'orrery_3d' || this.activeProfile === 'mariana_abyss') {
      const count = hour % 12 || 12;
      this.playOrreryObservatoryChime(true, count);
    } else if (this.activeProfile === 'nixie_hybrid') {
      this.playNixieBrassGlassChime(true);
    } else if (this.activeProfile === 'hybrid_base') {
      this.playHybridChime(true);
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
    } else if (this.activeProfile === 'tourbillon_3d') {
      this.playCathedralChime(false);
    } else if (this.activeProfile === 'reactor_3d') {
      this.playReactorContainmentChime(false);
    } else if (this.activeProfile === 'orrery_3d' || this.activeProfile === 'mariana_abyss') {
      this.playOrreryObservatoryChime(false);
    } else if (this.activeProfile === 'nixie_hybrid') {
      this.playNixieBrassGlassChime(false);
    } else if (this.activeProfile === 'hybrid_base') {
      this.playHybridChime(false);
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

    if (this.activeProfile === 'vienna_classic' || this.activeProfile === 'tourbillon_3d') {
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
    } else if (this.activeProfile === 'reactor_3d' || this.activeProfile === 'mariana_abyss') {
      this.playTelemetryChirp(isUrgent ? 'urgent' : 'normal', false);
      if (isUrgent) {
        this.playReactorContainmentChime(false);
      }
    } else if (this.activeProfile === 'orrery_3d') {
      if (isUrgent) {
        this.playOrreryObservatoryChime(false);
      } else {
        this.playBellTone(587.33, 2.2, 0.72);
        setTimeout(() => this.playBellTone(880.0, 2.8, 0.8), 160);
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
