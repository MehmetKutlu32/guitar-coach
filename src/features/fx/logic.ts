import { DELAY_DIVISIONS, MAX_DECAY, MAX_DELAY_MS, MIN_DECAY, MIN_DELAY_MS, type DelayDivision } from '../../dsp/fx';

/** Canlı efektlerin ayarları ve hazır sesler (saf; Vitest ile sınanır). */

export interface DriveParams {
  on: boolean;
  drive: number;
  tone: number;
  level: number;
}

export interface DelayParams {
  on: boolean;
  timeMs: number;
  /** % (en fazla %90 uygulanır). */
  feedback: number;
  mix: number;
  /** Süre metronom temposundan hesaplansın. */
  sync: boolean;
  division: DelayDivision;
}

export interface ReverbParams {
  on: boolean;
  size: number;
  /** T60 (saniye). */
  decay: number;
  mix: number;
}

/** Hazır seslerin kapsadığı ayarlar. Giriş kazancı, kapı ve ana ses cihaza bağlıdır; hazır sesle değişmez. */
export interface FxPreset {
  drive: DriveParams;
  delay: DelayParams;
  reverb: ReverbParams;
}

export interface InputParams {
  /** Giriş kazancı (dB). */
  gainDb: number;
  gateOn: boolean;
  /** Kapının açılma eşiği (dBFS). */
  gateDb: number;
}

export const GAIN_RANGE = { min: -12, max: 18 } as const;
export const GATE_RANGE = { min: -80, max: -20 } as const;
/** Ekran her açıldığında ses kapalı başlar; ana ses varsayılanı da kısık. */
export const DEFAULT_VOLUME = 30;

export const DEFAULT_INPUT: InputParams = { gainDb: 0, gateOn: false, gateDb: -55 };

const OFF_DRIVE: DriveParams = { on: false, drive: 40, tone: 55, level: 60 };
const OFF_DELAY: DelayParams = { on: false, timeMs: 350, feedback: 30, mix: 25, sync: false, division: '1/8.' };

export const BUILTIN_PRESETS: { id: string; preset: FxPreset }[] = [
  {
    id: 'clean',
    preset: { drive: OFF_DRIVE, delay: OFF_DELAY, reverb: { on: true, size: 30, decay: 1.2, mix: 15 } },
  },
  {
    id: 'crunch',
    preset: {
      drive: { on: true, drive: 45, tone: 55, level: 75 },
      delay: OFF_DELAY,
      reverb: { on: true, size: 25, decay: 0.9, mix: 12 },
    },
  },
  {
    id: 'lead',
    preset: {
      drive: { on: true, drive: 78, tone: 62, level: 75 },
      delay: { on: true, timeMs: 380, feedback: 30, mix: 22, sync: false, division: '1/8.' },
      reverb: { on: true, size: 45, decay: 1.8, mix: 18 },
    },
  },
  {
    id: 'ambient',
    preset: {
      drive: OFF_DRIVE,
      delay: { on: true, timeMs: 450, feedback: 55, mix: 40, sync: true, division: '1/8.' },
      reverb: { on: true, size: 85, decay: 4.5, mix: 45 },
    },
  },
];

export const DEFAULT_PRESET: FxPreset = BUILTIN_PRESETS[0].preset;

function num(v: unknown, fallback: number, min: number, max: number, step = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = Math.min(max, Math.max(min, v));
  return step > 0 ? Math.round(c / step) * step : c;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Kayıttan ya da içe aktarılan dosyadan gelen değeri geçerli bir hazır sese çevirir (eksik alan → varsayılan). */
export function sanitizePreset(raw: unknown, base: FxPreset = DEFAULT_PRESET): FxPreset {
  const r = obj(raw);
  const d = obj(r.drive);
  const e = obj(r.delay);
  const v = obj(r.reverb);
  const division = DELAY_DIVISIONS.includes(e.division as DelayDivision) ? (e.division as DelayDivision) : base.delay.division;
  return {
    drive: {
      on: bool(d.on, base.drive.on),
      drive: num(d.drive, base.drive.drive, 0, 100, 1),
      tone: num(d.tone, base.drive.tone, 0, 100, 1),
      level: num(d.level, base.drive.level, 0, 100, 1),
    },
    delay: {
      on: bool(e.on, base.delay.on),
      timeMs: num(e.timeMs, base.delay.timeMs, MIN_DELAY_MS, MAX_DELAY_MS, 1),
      feedback: num(e.feedback, base.delay.feedback, 0, 90, 1),
      mix: num(e.mix, base.delay.mix, 0, 100, 1),
      sync: bool(e.sync, base.delay.sync),
      division,
    },
    reverb: {
      on: bool(v.on, base.reverb.on),
      size: num(v.size, base.reverb.size, 0, 100, 1),
      decay: num(v.decay, base.reverb.decay, MIN_DECAY, MAX_DECAY, 0.1),
      mix: num(v.mix, base.reverb.mix, 0, 100, 1),
    },
  };
}

export function sanitizeInput(raw: unknown): InputParams {
  const r = obj(raw);
  return {
    gainDb: num(r.gainDb, DEFAULT_INPUT.gainDb, GAIN_RANGE.min, GAIN_RANGE.max, 1),
    gateOn: bool(r.gateOn, DEFAULT_INPUT.gateOn),
    gateDb: num(r.gateDb, DEFAULT_INPUT.gateDb, GATE_RANGE.min, GATE_RANGE.max, 1),
  };
}

export function samePreset(a: FxPreset, b: FxPreset): boolean {
  return JSON.stringify(sanitizePreset(a)) === JSON.stringify(sanitizePreset(b));
}

/** Kullanıcının kaydettiği ses (`items` deposu, `type: 'fxpreset'`). */
export interface UserPreset {
  id: string;
  type: 'fxpreset';
  date: number;
  name: string;
  preset: FxPreset;
  [key: string]: unknown;
}

export function isUserPreset(v: unknown): v is UserPreset {
  const r = obj(v);
  return r.type === 'fxpreset' && typeof r.id === 'string' && typeof r.name === 'string' && !!r.preset;
}

export function presetName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 40);
}

// ---------- Gecikme göstergesi ----------

export interface LatencyInput {
  /** AudioContext.baseLatency (s): işleme arabelleği. */
  base: number;
  /** AudioContext.outputLatency (s); tarayıcı bildirmiyorsa 0. */
  output: number;
  /** Giriş izinin bildirdiği gecikme (s); bilinmiyorsa null. */
  input: number | null;
  /** Efekt zincirinin eklediği (s). */
  chain: number;
  /** Ayarlar'da ölçülmüş toplam gecikme (ms); yoksa null. */
  calibratedMs: number | null;
}

export interface LatencyEstimate {
  /** Gösterilen değer (ms, tam sayı). */
  ms: number;
  /** Değer ölçümden mi geliyor, tarayıcının bildirdiklerinden mi? */
  source: 'calibrated' | 'reported';
  /** Tarayıcının bildirdiklerinden toplanan (ms). */
  reportedMs: number;
  inputKnown: boolean;
  rating: LatencyRating;
}

export type LatencyRating = 'good' | 'ok' | 'high';

/** ≤ 12 ms fark edilmez; ≤ 25 ms alışılır; üstü çalarken rahatsız eder. */
export function latencyRating(ms: number): LatencyRating {
  if (ms <= 12) return 'good';
  if (ms <= 25) return 'ok';
  return 'high';
}

/**
 * Gidiş-dönüş gecikme tahmini: giriş + işleme + çıkış + zincir. Giriş gecikmesini tarayıcı bildirmiyorsa
 * işleme arabelleği kadar sayılır (çoğu sürücüde giriş ve çıkış arabellekleri eşittir).
 * Kullanıcı Ayarlar'da gecikmeyi ölçtüyse o değer gösterilir (hoparlör→mikrofon gerçek yolu ölçer).
 */
export function estimateLatency(x: LatencyInput): LatencyEstimate {
  const input = x.input ?? x.base;
  const reportedMs = Math.round((Math.max(0, input) + Math.max(0, x.base) + Math.max(0, x.output) + Math.max(0, x.chain)) * 1000);
  const calibrated = x.calibratedMs !== null && x.calibratedMs > 0 ? Math.round(x.calibratedMs + x.chain * 1000) : null;
  const ms = calibrated ?? reportedMs;
  return {
    ms,
    source: calibrated !== null ? 'calibrated' : 'reported',
    reportedMs,
    inputKnown: x.input !== null,
    rating: latencyRating(ms),
  };
}
