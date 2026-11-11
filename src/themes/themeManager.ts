import { ThemeManifest } from '../types/theme';
import { Theme, ThemeConfig, ThemeEvent } from './types';
import { ViennaClassicTheme } from './viennaClassic';
import { Pcb2049Theme } from './pcb2049';

export type ThemeFactory = () => Theme;

export interface ThemeDescriptor {
  id: string;
  name: string;
}

export class ThemeManager {
  public static readonly STORAGE_KEY = 'modern_clock_theme';
  public static readonly LEGACY_STORAGE_KEY = 'theme_id';

  private registry: Map<string, { descriptor: ThemeDescriptor; create: ThemeFactory }> = new Map();
  private activeTheme: Theme | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stageElement: HTMLElement;
  private notificationZoneElement: HTMLElement | null;

  private themeChangeListeners: Array<(theme: Theme, manifest: ThemeManifest | null) => void> = [];
  private isTransitioning = false;

  constructor(
    canvas: HTMLCanvasElement,
    stageElement: HTMLElement,
    notificationZoneElement?: HTMLElement | null
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('[ThemeManager] Failed to acquire 2D rendering context from #clock-canvas');
    }
    this.ctx = context;
    this.stageElement = stageElement;
    this.notificationZoneElement = notificationZoneElement || null;

    // Register built-in themes
    this.registerTheme(() => new ViennaClassicTheme());
    this.registerTheme(() => new Pcb2049Theme());
  }

  /**
   * Registers a theme instance or factory into the ThemeManager registry.
   */
  public registerTheme(themeOrFactory: Theme | ThemeFactory): void {
    const sample = typeof themeOrFactory === 'function' ? themeOrFactory() : themeOrFactory;
    const factory: ThemeFactory =
      typeof themeOrFactory === 'function' ? themeOrFactory : () => themeOrFactory;

    this.registry.set(sample.id, {
      descriptor: { id: sample.id, name: sample.name },
      create: factory
    });
  }

  public getAvailableThemes(): ThemeDescriptor[] {
    return Array.from(this.registry.values()).map((entry) => entry.descriptor);
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

    // 8. Notify listeners
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

