import { ThemeManifest } from '../types/theme';

export interface ClockDomElements {
  stage: HTMLElement;
  bg: HTMLImageElement;
  pendulum: HTMLImageElement;
  notificationZone: HTMLElement;
  dial: HTMLImageElement;
  handHour: HTMLImageElement;
  handMinute: HTMLImageElement;
  handSecond: HTMLImageElement;
  handCap: HTMLImageElement;
}

export class ThemeLoader {
  private currentManifest: ThemeManifest | null = null;
  private currentThemePath: string = '';
  private elements: ClockDomElements;

  constructor(elements: ClockDomElements) {
    this.elements = elements;
  }

  /**
   * Resolves a relative asset path against the theme directory
   */
  private resolveAssetUrl(assetPath: string): string {
    if (assetPath.startsWith('http://') || assetPath.startsWith('https://') || assetPath.startsWith('data:')) {
      return assetPath;
    }
    // Clean trailing slashes from theme path and leading slashes from asset path
    const base = this.currentThemePath.replace(/\/+$/, '');
    const cleanAsset = assetPath.replace(/^\/+/, '');
    return `${base}/${cleanAsset}`;
  }

  /**
   * Loads a theme from a given directory or JSON URL (e.g. 'themes/default' or './themes/default/theme.json')
   */
  public async loadTheme(themePathOrUrl: string): Promise<ThemeManifest> {
    let manifestUrl = themePathOrUrl;
    if (!manifestUrl.endsWith('.json')) {
      manifestUrl = `${themePathOrUrl.replace(/\/+$/, '')}/theme.json`;
    }
    if (!/^(https?:|data:|blob:)/i.test(manifestUrl)) {
      const base =
        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || './';
      const normalizedBase = base.endsWith('/') ? base : `${base}/`;
      manifestUrl = `${normalizedBase}${manifestUrl.replace(/^\.?\//, '')}`;
    }

    // Determine theme base path
    this.currentThemePath = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));

    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Failed to load theme manifest from ${manifestUrl}: ${response.status} ${response.statusText}`);
    }

    const manifest: ThemeManifest = await response.json();
    this.currentManifest = manifest;

    // Apply assets and dynamic geometry
    await this.applyTheme(manifest);
    return manifest;
  }

  /**
   * Applies the theme manifest to DOM elements
   */
  public async applyTheme(manifest: ThemeManifest): Promise<void> {
    this.currentManifest = manifest;

    // 1. Background
    this.elements.bg.src = this.resolveAssetUrl(manifest.background);
    this.elements.bg.style.position = 'absolute';
    this.elements.bg.style.left = '0px';
    this.elements.bg.style.top = '0px';
    this.elements.bg.style.width = '1080px';
    this.elements.bg.style.height = '1920px';

    // 2. Set image sources for dial and hands
    this.elements.dial.src = this.resolveAssetUrl(manifest.dial.image);
    this.elements.handHour.src = this.resolveAssetUrl(manifest.hands.hour.image);
    this.elements.handMinute.src = this.resolveAssetUrl(manifest.hands.minute.image);
    this.elements.handSecond.src = this.resolveAssetUrl(manifest.hands.second.image);
    this.elements.handCap.src = this.resolveAssetUrl(manifest.hands.cap.image);
    this.elements.pendulum.src = this.resolveAssetUrl(manifest.pendulum.image);

    // Wait for dial image to load dimensions if needed
    await Promise.all([
      this.ensureImageLoaded(this.elements.dial),
      this.ensureImageLoaded(this.elements.handHour),
      this.ensureImageLoaded(this.elements.handMinute),
      this.ensureImageLoaded(this.elements.handSecond),
      this.ensureImageLoaded(this.elements.handCap),
      this.ensureImageLoaded(this.elements.pendulum)
    ]);

    // Apply dynamic placement calculations
    this.applyPlacement();
  }

  /**
   * Computes left, top, and transform-origin dynamically so hands always rotate
   * around dial.center and the pendulum hinges exactly around pendulum.pivot.
   */
  public applyPlacement(): void {
    if (!this.currentManifest) return;
    const { dial, hands, pendulum, notificationZone } = this.currentManifest;

    // 1. Dial Placement
    const dialW = this.elements.dial.naturalWidth || 900;
    const dialH = this.elements.dial.naturalHeight || 900;
    this.elements.dial.style.position = 'absolute';
    this.elements.dial.style.left = `${dial.center.x - dialW / 2}px`;
    this.elements.dial.style.top = `${dial.center.y - dialH / 2}px`;
    this.elements.dial.style.width = `${dialW}px`;
    this.elements.dial.style.height = `${dialH}px`;

    // 2. Hour Hand Placement
    this.elements.handHour.style.position = 'absolute';
    this.elements.handHour.style.left = `${dial.center.x - hands.hour.pivot.x}px`;
    this.elements.handHour.style.top = `${dial.center.y - hands.hour.pivot.y}px`;
    this.elements.handHour.style.transformOrigin = `${hands.hour.pivot.x}px ${hands.hour.pivot.y}px`;

    // 3. Minute Hand Placement
    this.elements.handMinute.style.position = 'absolute';
    this.elements.handMinute.style.left = `${dial.center.x - hands.minute.pivot.x}px`;
    this.elements.handMinute.style.top = `${dial.center.y - hands.minute.pivot.y}px`;
    this.elements.handMinute.style.transformOrigin = `${hands.minute.pivot.x}px ${hands.minute.pivot.y}px`;

    // 4. Second Hand Placement
    this.elements.handSecond.style.position = 'absolute';
    this.elements.handSecond.style.left = `${dial.center.x - hands.second.pivot.x}px`;
    this.elements.handSecond.style.top = `${dial.center.y - hands.second.pivot.y}px`;
    this.elements.handSecond.style.transformOrigin = `${hands.second.pivot.x}px ${hands.second.pivot.y}px`;

    // 5. Center Cap Placement
    this.elements.handCap.style.position = 'absolute';
    this.elements.handCap.style.left = `${dial.center.x - hands.cap.center.x}px`;
    this.elements.handCap.style.top = `${dial.center.y - hands.cap.center.y}px`;

    // 6. Pendulum Placement
    this.elements.pendulum.style.position = 'absolute';
    this.elements.pendulum.style.left = `${pendulum.pivot.x - pendulum.anchor.x}px`;
    this.elements.pendulum.style.top = `${pendulum.pivot.y - pendulum.anchor.y}px`;
    this.elements.pendulum.style.transformOrigin = `${pendulum.anchor.x}px ${pendulum.anchor.y}px`;

    // 7. Notification Zone Placement
    this.elements.notificationZone.style.position = 'absolute';
    this.elements.notificationZone.style.left = `${notificationZone.x}px`;
    this.elements.notificationZone.style.top = `${notificationZone.y}px`;
    this.elements.notificationZone.style.width = `${notificationZone.width}px`;
    this.elements.notificationZone.style.height = `${notificationZone.height}px`;
  }

  public getManifest(): ThemeManifest | null {
    return this.currentManifest;
  }

  private ensureImageLoaded(img: HTMLImageElement): Promise<void> {
    return new Promise((resolve) => {
      if (img.complete && img.naturalWidth !== 0) {
        resolve();
      } else {
        img.onload = () => resolve();
        img.onerror = () => {
          console.warn(`[ThemeLoader] Failed to load image: ${img.src}`);
          resolve();
        };
      }
    });
  }
}

