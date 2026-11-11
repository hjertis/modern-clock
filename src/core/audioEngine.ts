/**
 * Zero-dependency Procedural Acoustic Audio Engine
 * Uses Web Audio API to synthesize:
 * 1. Mechanical escapement pallets ("tick" and "tock") with authentic wood/brass acoustics
 * 2. Tubular bell Westminster chimes & hourly strike counts
 */

export class ClockAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5; // 0.0 to 1.0
  private lastTickWasHigh: boolean = false;
  private isUnlocked: boolean = false;

  constructor() {
    // Lazy initialize AudioContext on user interaction to comply with browser autoplay policies
    const unlock = () => {
      this.initAudioContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.isUnlocked = true;
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  public getIsUnlocked(): boolean {
    return this.isUnlocked;
  }

  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  /**
   * Plays mechanical escapement impact (tick or tock)
   * High click on 'tick', lower damped knock on 'tock'
   */
  public playEscapement(forceType?: 'tick' | 'tock'): void {
    if (this.isMuted || this.volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;

    const isHigh = forceType ? forceType === 'tick' : !this.lastTickWasHigh;
    this.lastTickWasHigh = isHigh;

    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.35, t);
    masterGain.connect(this.ctx.destination);

    // 1. High frequency mechanical metallic pallet click
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = isHigh ? 'triangle' : 'sine';
    const baseFreq = isHigh ? 2150 : 1620;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, t + 0.016);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isHigh ? 2400 : 1750, t);
    filter.Q.setValueAtTime(4.0, t);

    oscGain.gain.setValueAtTime(0.8, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + (isHigh ? 0.022 : 0.028));

    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(masterGain);

    osc.start(t);
    osc.stop(t + 0.035);

    // 2. Low resonant wooden case thump / body knock
    const woodOsc = this.ctx.createOscillator();
    const woodGain = this.ctx.createGain();
    woodOsc.type = 'sine';
    woodOsc.frequency.setValueAtTime(isHigh ? 290 : 230, t);
    woodOsc.frequency.exponentialRampToValueAtTime(80, t + 0.04);

    woodGain.gain.setValueAtTime(0.5, t);
    woodGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    woodOsc.connect(woodGain);
    woodGain.connect(masterGain);

    woodOsc.start(t);
    woodOsc.stop(t + 0.05);
  }

  /**
   * Synthesizes a tubular brass bell chime note (fundamental + inharmonic overtones)
   * Classic grandfather clock rod acoustics (f, 2.76f, 5.40f, 8.93f)
   */
  public playBellTone(fundamentalFreq: number, durationSec: number = 3.5, intensity: number = 1.0): void {
    if (this.isMuted || this.volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;

    const t = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * intensity * 0.4, t);
    masterGain.connect(this.ctx.destination);

    // Tubular rod harmonic ratios and damping weights
    const harmonics = [
      { ratio: 1.00, gain: 0.9, decay: durationSec },
      { ratio: 2.76, gain: 0.5, decay: durationSec * 0.75 },
      { ratio: 5.40, gain: 0.25, decay: durationSec * 0.5 },
      { ratio: 8.93, gain: 0.12, decay: durationSec * 0.3 }
    ];

    for (const h of harmonics) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(fundamentalFreq * h.ratio, t);

      // Strike attack & exponential ringing decay
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(h.gain, t + 0.006); // sharp strike
      gain.gain.exponentialRampToValueAtTime(0.0001, t + h.decay);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + h.decay + 0.05);
    }
  }

  /**
   * Plays Westminster hour strike count (e.g. strikes 4 times at 4:00)
   */
  public playHourStrikes(count: number): void {
    if (this.isMuted || this.volume <= 0) return;
    const safeCount = Math.max(1, Math.min(12, count));
    const strikeIntervalSec = 2.4; // 2.4 seconds between deep bell strikes

    for (let i = 0; i < safeCount; i++) {
      setTimeout(() => {
        if (!this.isMuted) {
          // Deep E3 tubular bell (164.81 Hz)
          this.playBellTone(164.81, 4.0, 1.0);
        }
      }, i * strikeIntervalSec * 1000);
    }
  }

  /**
   * Plays modern or alert chime for incoming notifications
   */
  public playNotificationChime(): void {
    if (this.isMuted || this.volume <= 0 || !this.ctx || this.ctx.state !== 'running') return;
    // Pleasant two-tone brass chime (E5 -> B5)
    this.playBellTone(659.25, 2.0, 0.7);
    setTimeout(() => {
      this.playBellTone(987.77, 2.8, 0.85);
    }, 180);
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
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
}

