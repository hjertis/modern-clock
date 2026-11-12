import { HandMode } from '../types/theme';
import { HandAngles } from '../utils/math';

export type HourFormat = '24h' | '12h';

export interface DisplayOptions {
  hourFormat: HourFormat;
  showSeconds: boolean;
  showDate: boolean;
}

export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = {
  hourFormat: '24h',
  showSeconds: true,
  showDate: true
};

export const DISPLAY_OPTIONS_STORAGE_KEY = 'modern_clock_display_options';

export type DigitalCellRole = 'h1' | 'h2' | 'sep1' | 'm1' | 'm2' | 'sep2' | 's1' | 's2';

export interface DigitalCell {
  index: number;
  role: DigitalCellRole;
  char: string;
  isSeparator: boolean;
  visible: boolean;
}

export interface SynchronizedTimeTick {
  timestampMs: number;
  date: Date;
  hours24: number;
  displayHours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  meridiem: 'AM' | 'PM';
  showMeridiem: boolean;
  isPm: boolean;
  angles: HandAngles;
  hourDigits: [string, string];
  minuteDigits: [string, string];
  secondDigits: [string, string];
  cells: DigitalCell[];
  formattedTime: string;
  formattedDate: string;
  rawDateText: string;
  options: DisplayOptions;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC'
] as const;

/**
 * Formats a Date into uppercase `DDD DD MMM` (e.g., `THU 12 NOV`).
 */
export function formatClockDate(date: Date): string {
  const dayName = WEEKDAYS[date.getDay()];
  const dayNum = String(date.getDate()).padStart(2, '0');
  const monthName = MONTHS[date.getMonth()];
  return `${dayName} ${dayNum} ${monthName}`;
}

/**
 * Normalizes and validates partial display options against defaults.
 */
export function normalizeDisplayOptions(
  raw?: Partial<DisplayOptions> | Record<string, unknown> | null,
  base: DisplayOptions = DEFAULT_DISPLAY_OPTIONS
): DisplayOptions {
  if (!raw || typeof raw !== 'object') {
    return { ...base };
  }

  const r = raw as Record<string, unknown>;
  const rawHourFormat = r.hourFormat ?? r.hour_format;
  const rawShowSeconds = r.showSeconds ?? r.show_seconds;
  const rawShowDate = r.showDate ?? r.show_date;

  const hourFormat: HourFormat =
    rawHourFormat === '12h' || rawHourFormat === '24h' ? rawHourFormat : base.hourFormat;
  const showSeconds =
    typeof rawShowSeconds === 'boolean' ? rawShowSeconds : base.showSeconds;
  const showDate = typeof rawShowDate === 'boolean' ? rawShowDate : base.showDate;

  return {
    hourFormat,
    showSeconds,
    showDate
  };
}

/**
 * Derives synchronized analog hand angles and discrete digital character cells
 * from a single timestamp tick so analog hands and digital digits never drift.
 */
export function formatSynchronizedTime(
  input: Date | number,
  options?: Partial<DisplayOptions>,
  secondMode: HandMode = 'tick'
): SynchronizedTimeTick {
  const date = typeof input === 'number' ? new Date(input) : new Date(input.getTime());
  const timestampMs = date.getTime();
  const resolvedOptions = normalizeDisplayOptions(options, DEFAULT_DISPLAY_OPTIONS);

  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();

  const isPm = hours24 >= 12;
  const meridiem: 'AM' | 'PM' = isPm ? 'PM' : 'AM';
  const showMeridiem = resolvedOptions.hourFormat === '12h';

  const displayHours =
    resolvedOptions.hourFormat === '12h' ? hours24 % 12 || 12 : hours24;

  const hStr = String(displayHours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  const sStr = String(seconds).padStart(2, '0');

  const hourDigits: [string, string] = [hStr[0], hStr[1]];
  const minuteDigits: [string, string] = [mStr[0], mStr[1]];
  const secondDigits: [string, string] = [sStr[0], sStr[1]];

  let secondAngle: number;
  if (secondMode === 'sweep') {
    // Continuous fractional seconds (smooth at 60 FPS while digital cells step on integer seconds)
    secondAngle = ((seconds + milliseconds / 1000) / 60) * 360;
  } else {
    // Discrete integer stepping
    secondAngle = seconds * 6; // 360 / 60 = 6 deg/sec
  }

  const angles: HandAngles = {
    hour: ((hours24 % 12) + minutes / 60 + seconds / 3600) * 30,
    minute: (minutes + seconds / 60 + milliseconds / 60000) * 6,
    second: secondAngle
  };

  const cells: DigitalCell[] = [
    { index: 0, role: 'h1', char: hourDigits[0], isSeparator: false, visible: true },
    { index: 1, role: 'h2', char: hourDigits[1], isSeparator: false, visible: true },
    { index: 2, role: 'sep1', char: ':', isSeparator: true, visible: true },
    { index: 3, role: 'm1', char: minuteDigits[0], isSeparator: false, visible: true },
    { index: 4, role: 'm2', char: minuteDigits[1], isSeparator: false, visible: true },
    {
      index: 5,
      role: 'sep2',
      char: ':',
      isSeparator: true,
      visible: resolvedOptions.showSeconds
    },
    {
      index: 6,
      role: 's1',
      char: secondDigits[0],
      isSeparator: false,
      visible: resolvedOptions.showSeconds
    },
    {
      index: 7,
      role: 's2',
      char: secondDigits[1],
      isSeparator: false,
      visible: resolvedOptions.showSeconds
    }
  ];

  const formattedTime = resolvedOptions.showSeconds
    ? `${hStr}:${mStr}:${sStr}`
    : `${hStr}:${mStr}`;

  const rawDateText = formatClockDate(date);
  const formattedDate = resolvedOptions.showDate ? rawDateText : '';

  return {
    timestampMs,
    date,
    hours24,
    displayHours,
    minutes,
    seconds,
    milliseconds,
    meridiem,
    showMeridiem,
    isPm,
    angles,
    hourDigits,
    minuteDigits,
    secondDigits,
    cells,
    formattedTime,
    formattedDate,
    rawDateText,
    options: resolvedOptions
  };
}

/**
 * Loads persisted DisplayOptions from localStorage, falling back to defaults.
 */
export function loadDisplayOptions(): DisplayOptions {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DISPLAY_OPTIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return normalizeDisplayOptions(parsed, DEFAULT_DISPLAY_OPTIONS);
      }
    }
  } catch {
    // Ignore storage access or parse errors in restricted kiosk environments
  }
  return { ...DEFAULT_DISPLAY_OPTIONS };
}

/**
 * Persists DisplayOptions to localStorage.
 */
export function saveDisplayOptions(options: DisplayOptions): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISPLAY_OPTIONS_STORAGE_KEY, JSON.stringify(options));
    }
  } catch {
    // Ignore quota / security errors
  }
}

/**
 * Reactive store for display options with localStorage persistence.
 */
export class DisplayOptionsStore {
  private current: DisplayOptions;
  private listeners: Array<(options: DisplayOptions) => void> = [];

  constructor(initial?: Partial<DisplayOptions>) {
    const stored = loadDisplayOptions();
    this.current = initial ? normalizeDisplayOptions(initial, stored) : stored;
    if (initial) {
      saveDisplayOptions(this.current);
    }
  }

  public getOptions(): DisplayOptions {
    return { ...this.current };
  }

  public setOptions(patch: Partial<DisplayOptions> | Record<string, unknown>): DisplayOptions {
    const next = normalizeDisplayOptions(patch, this.current);
    const changed =
      next.hourFormat !== this.current.hourFormat ||
      next.showSeconds !== this.current.showSeconds ||
      next.showDate !== this.current.showDate;

    this.current = next;
    saveDisplayOptions(this.current);

    if (changed) {
      for (const listener of this.listeners) {
        listener(this.getOptions());
      }
    }
    return this.getOptions();
  }

  public reset(): DisplayOptions {
    this.current = { ...DEFAULT_DISPLAY_OPTIONS };
    saveDisplayOptions(this.current);
    for (const listener of this.listeners) {
      listener(this.getOptions());
    }
    return this.getOptions();
  }

  public onChange(listener: (options: DisplayOptions) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const sharedDisplayOptions = new DisplayOptionsStore();

