import { ThemeManifest } from '../types/theme';
import { ClockTheme, Theme, ThemeConfig, ThemeEvent } from './types';
import { adaptClockThemeToTheme, isClockTheme } from './helpers';
import { ViennaClassicTheme } from './viennaClassic';
import { Pcb2049Theme } from './pcb2049';
import { HybridBaseTheme } from './hybrid_base';
import { NixieHybridTheme } from './nixie_hybrid';
import { Tourbillon3DTheme } from './tourbillon_3d';
import { Reactor3DTheme } from './reactor_3d';
import { Orrery3DTheme } from './orrery_3d';
import { MarianaAbyssTheme } from './mariana_abyss';
import { VectorOscilloscopeTheme } from './vector-oscilloscope';
import { ClockAudioEngine } from '../core/audioEngine';

export type ThemeFactory = () => Theme;
export type AnyThemeOrFactory = Theme | ClockTheme | (() => Theme | ClockTheme);

export interface ThemeDescriptor {
  id: string;
  name: string;
}

export class ThemeManager {
  public static readonly STORAGE_KEY = 'modern_clock_theme';
  public static readonly LEGACY_STORAGE_KEY = 'theme_id';

  private registry: Map<string, { descriptor: ThemeDescriptor; create: ThemeFactory }> = new Map();
  private activeTheme: Theme | null = null;
  private audioEngine: ClockAudioEngine | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stageElement: HTMLElement;
  private notificationZoneElement: HTMLElement | null;

  private themeChangeListeners: Array<(theme: Theme, manifest: ThemeManifest | null) => void> = [];
  private themeRegistryListeners: Array<(themes: ThemeDescriptor[]) => void> = [];
  private isTransitioning = false;

  constructor(
    canvas: HTMLCanvasElement,
    stageElement: HTMLElement,
    notificationZoneElement?: HTMLElement | null,
    audioEngine?: ClockAudioEngine | null
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('[ThemeManager] Failed to acquire 2D rendering context from #clock-canvas');
    }
    this.ctx = context;
    this.stageElement = stageElement;
    this.notificationZoneElement = notificationZoneElement || null;
    if (audioEngine) {
      this.audioEngine = audioEngine;
    }

    // Register built-in themes
    this.registerTheme(() => new ViennaClassicTheme());
    this.registerTheme(() => new Pcb2049Theme('standard'));
    this.registerTheme(() => new Pcb2049Theme('emerald'));
    this.registerTheme(() => new HybridBaseTheme());
    this.registerTheme(() => new NixieHybridTheme());
    this.registerTheme(() => new Tourbillon3DTheme());
    this.registerTheme(() => new Reactor3DTheme());
    this.registerTheme(() => new Orrery3DTheme());
    this.registerTheme(() => new MarianaAbyssTheme());
    this.registerTheme(() => new VectorOscilloscopeTheme());
  }


  /**
   * Registers a theme instance or factory into the ThemeManager registry.
   * Supports both legacy `Theme` and unified `ClockTheme` implementations.
   */
  public registerTheme(themeOrFactory: AnyThemeOrFactory): void {
    const rawSample = typeof themeOrFactory === 'function' ? themeOrFactory() : themeOrFactory;
    const sample = isClockTheme(rawSample) ? adaptClockThemeToTheme(rawSample) : rawSample;
    const factory: ThemeFactory =
      typeof themeOrFactory === 'function'
        ? () => {
            const instance = themeOrFactory();
            return isClockTheme(instance) ? adaptClockThemeToTheme(instance) : instance;
          }
        : () => sample;

    this.registry.set(sample.id, {
      descriptor: { id: sample.id, name: sample.name },
      create: factory
    });

    for (const listener of this.themeRegistryListeners) {
      try {
        listener(this.getAvailableThemes());
      } catch (err) {
        console.error('[ThemeManager] Error notifying theme registry listener:', err);
      }
    }
  }

  public onThemeRegistryChange(listener: (themes: ThemeDescriptor[]) => void): () => void {
    this.themeRegistryListeners.push(listener);
    return () => {
      this.themeRegistryListeners = this.themeRegistryListeners.filter((l) => l !== listener);
    };
  }

  public setAudioEngine(audioEngine: ClockAudioEngine): void {
    this.audioEngine = audioEngine;
    this.audioEngine.setTheme(this.getActiveThemeId());
  }

  public getAudioEngine(): ClockAudioEngine | null {
    return this.audioEngine;
  }

  public getAvailableThemes(): ThemeDescriptor[] {
    return Array.from(this.registry.values()).map((entry) => entry.descriptor);
  }

  public getAvailableThemeIds(): string[] {
    return Array.from(this.registry.keys());
  }

  public getActiveTheme(): Theme | null {
    return this.activeTheme;
  }

  public getActiveThemeId(): string {
    return this.activeTheme?.id || 'pcb_2049';
  }

  public getActiveManifest(): ThemeManifest | null {
    if (this.activeTheme && typeof this.activeTheme.getManifest === 'function') {
      return this.activeTheme.getManifest();
    }
    return null;
  }

  public getCanvasContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Resolves aliases (e.g. 'default', 'vienna-classic', 'pcb2049') to canonical registered theme IDs.
   */
  public resolveThemeId(rawId: string): string {
    const cleaned = rawId.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (this.registry.has(cleaned)) {
      return cleaned;
    }
    if (cleaned === 'default' || cleaned === 'vienna' || cleaned === 'vienna_classic') {
      return 'vienna_classic';
    }
    if (
      cleaned === 'pcb' ||
      cleaned === 'pcb2049' ||
      cleaned === 'pcb_2049' ||
      cleaned === 'industrial_silicon'
    ) {
      return 'pcb_2049';
    }
    if (
      cleaned === 'pcb_2049_emerald' ||
      cleaned === 'pcb2049_emerald' ||
      cleaned === 'emerald' ||
      cleaned === 'silicon_master' ||
      cleaned === 'silicon_master_rev_b'
    ) {
      return 'pcb_2049_emerald';
    }
    if (
      cleaned === 'hybrid' ||
      cleaned === 'hybrid_base' ||
      cleaned === 'hybrid_analog_digital' ||
      cleaned === 'hybrid_analog/digital'
    ) {
      return 'hybrid_base';
    }
    if (
      cleaned === 'nixie' ||
      cleaned === 'nixie_hybrid' ||
      cleaned === 'nixie_chronograph'
    ) {
      return 'nixie_hybrid';
    }
    if (
      cleaned === 'tourbillon' ||
      cleaned === 'tourbillon_3d' ||
      cleaned === 'horological_tourbillon' ||
      cleaned === 'horological_tourbillon_3d'
    ) {
      return 'tourbillon_3d';
    }
    if (
      cleaned === 'reactor' ||
      cleaned === 'reactor_3d' ||
      cleaned === 'chrono_containment_reactor' ||
      cleaned === 'chrono_reactor'
    ) {
      return 'reactor_3d';
    }
    if (
      cleaned === 'orrery' ||
      cleaned === 'orrery_3d' ||
      cleaned === 'celestial_astrolabe' ||
      cleaned === 'celestial_orrery' ||
      cleaned === 'celestial_astrolabe_&_orrery'
    ) {
      return 'orrery_3d';
    }
    if (
      cleaned === 'mariana' ||
      cleaned === 'mariana_abyss' ||
      cleaned === 'abyss'
    ) {
      return 'mariana_abyss';
    }
    if (
      cleaned === 'vector_oscilloscope' ||
      cleaned === 'oscilloscope' ||
      cleaned === 'vector_crt' ||
      cleaned === 'vector_crt_oscilloscope'
    ) {
      return 'vector_oscilloscope';
    }

    // Match by display name
    for (const [id, entry] of this.registry.entries()) {
      if (entry.descriptor.name.toLowerCase() === rawId.trim().toLowerCase()) {
        return id;
      }
    }
    return cleaned;
  }

  /**
   * Loads the saved theme from URL query `?theme=` or `localStorage`,
   * falling back to `defaultThemeId` ('pcb_2049').
   */
  public async initDefaultOrSavedTheme(defaultThemeId = 'pcb_2049'): Promise<Theme> {
    let targetId = defaultThemeId;

    try {
      const urlTheme =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('theme')
          : null;
      const savedTheme =
        typeof window !== 'undefined'
          ? localStorage.getItem(ThemeManager.STORAGE_KEY) ||
            localStorage.getItem(ThemeManager.LEGACY_STORAGE_KEY)
          : null;

      if (urlTheme) {
        targetId = this.resolveThemeId(urlTheme);
      } else if (savedTheme) {
        targetId = this.resolveThemeId(savedTheme);
      }
    } catch {
      // Ignore storage access errors in restricted kiosk modes
    }

    if (!this.registry.has(targetId)) {
      targetId = defaultThemeId;
    }

    return this.setTheme(targetId, { animateTransition: false });
  }

  /**
   * Switches the active theme with a smooth alpha transition and clean canvas reset,
   * then persists the selection to localStorage.
   */
  public async setTheme(
    themeId: string,
    options?: { animateTransition?: boolean; config?: Partial<ThemeConfig> }
  ): Promise<Theme> {
    const resolvedId = this.resolveThemeId(themeId);
    const entry = this.registry.get(resolvedId);
    if (!entry) {
      throw new Error(
        `[ThemeManager] Theme '${themeId}' (resolved: '${resolvedId}') is not registered. Available: ${Array.from(
          this.registry.keys()
        ).join(', ')}`
      );
    }

    const animate = options?.animateTransition ?? (this.activeTheme !== null);

    if (animate && !this.isTransitioning) {
      this.isTransitioning = true;
      this.canvas.style.transition = 'opacity 160ms ease-out';
      this.canvas.style.opacity = '0.15';
      await new Promise((r) => setTimeout(r, 150));
    }

    // 1. Destroy previous theme instance
    if (this.activeTheme) {
      try {
        this.activeTheme.destroy();
      } catch (err) {
        console.warn('[ThemeManager] Error destroying previous theme:', err);
      }
      this.activeTheme = null;
    }

    // 2. Clean canvas reset
    this.resetCanvas();

    // 3. Instantiate and mount new theme
    const nextTheme = entry.create();
    this.activeTheme = nextTheme;

    // 4. Update DOM data-theme attributes for reactive CSS (toast cards, stage background)
    this.stageElement.setAttribute('data-theme', resolvedId);
    document.body.setAttribute('data-theme', resolvedId);

    const mountConfig: ThemeConfig = {
      width: this.canvas.width || 1080,
      height: this.canvas.height || 1920,
      stageElement: this.stageElement,
      ...options?.config
    };

    await nextTheme.mount(this.ctx, mountConfig);

    // 5. Sync notification zone bounds from theme manifest
    const manifest = this.getActiveManifest();
    if (manifest && this.notificationZoneElement) {
      const nz = manifest.notificationZone;
      this.notificationZoneElement.style.position = 'absolute';
      this.notificationZoneElement.style.left = `${nz.x}px`;
      this.notificationZoneElement.style.top = `${nz.y}px`;
      this.notificationZoneElement.style.width = `${nz.width}px`;
      this.notificationZoneElement.style.height = `${nz.height}px`;
      this.notificationZoneElement.style.transform = '';
    }

    // 6. Persist selection to localStorage
    try {
      localStorage.setItem(ThemeManager.STORAGE_KEY, resolvedId);
      localStorage.setItem(ThemeManager.LEGACY_STORAGE_KEY, resolvedId);
    } catch {
      // Ignore storage quota / security errors
    }

    // 7. Fade canvas back in smoothly
    if (animate) {
      requestAnimationFrame(() => {
        this.canvas.style.transition = 'opacity 220ms ease-in';
        this.canvas.style.opacity = '1';
        this.isTransitioning = false;
      });
    } else {
      this.canvas.style.opacity = '1';
      this.isTransitioning = false;
    }

    // 8. Sync audio engine sound profile to match active theme
    this.audioEngine?.setTheme(resolvedId);

    // 9. Notify listeners
    for (const listener of this.themeChangeListeners) {
      listener(nextTheme, manifest);
    }

    console.log(`[ThemeManager] Activated theme '${nextTheme.name}' (${nextTheme.id})`);
    return nextTheme;
  }

  /**
   * Handles inbound WebSocket messages such as:
   * `{ "action": "set_theme", "theme_id": "pcb_2049" }`
   */
  public handleInboundMessage(msg: Record<string, unknown>): boolean {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.action === 'set_theme' && typeof msg.theme_id === 'string') {
      this.setTheme(msg.theme_id).catch((err) => {
        console.error('[ThemeManager] Failed to switch theme from WS action:', err);
      });
      return true;
    }

    if (msg.type === 'set_theme' && typeof msg.theme_id === 'string') {
      this.setTheme(msg.theme_id).catch((err) => {
        console.error('[ThemeManager] Failed to switch theme from WS type:', err);
      });
      return true;
    }

    return false;
  }

  /**
   * Dispatches a reactive event (e.g., WebSocket notification pulse) to the active theme.
   */
  public dispatchEvent(event: ThemeEvent): void {
    this.activeTheme?.onEvent(event);
  }

  public onThemeChange(
    listener: (theme: Theme, manifest: ThemeManifest | null) => void
  ): () => void {
    this.themeChangeListeners.push(listener);
    return () => {
      this.themeChangeListeners = this.themeChangeListeners.filter((l) => l !== listener);
    };
  }

  public resetCanvas(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1.0;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

