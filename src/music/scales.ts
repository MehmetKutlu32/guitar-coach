import type { Key } from '../i18n';
import { FLAT_NAMES, mod12, SHARP_NAMES } from './theory';

export type ScaleId =
  | 'major'
  | 'minor'
  | 'minorPent'
  | 'majorPent'
  | 'blues'
  | 'dorian'
  | 'mixolydian'
  | 'harmonicMinor'
  | 'phrygian'
  | 'lydian'
  | 'locrian'
  | 'melodicMinor';

export interface ScaleDef {
  name: Key;
  intervals: number[];
  /** Gam kökünden, aynı notaları paylaşan majör gamın köküne yarım ton farkı (nota yazımı için). */
  parentMajor: number;
}

export const SCALES: Record<ScaleId, ScaleDef> = {
  major: { name: 'scale.major', intervals: [0, 2, 4, 5, 7, 9, 11], parentMajor: 0 },
  minor: { name: 'scale.minor', intervals: [0, 2, 3, 5, 7, 8, 10], parentMajor: 3 },
  minorPent: { name: 'scale.minorPent', intervals: [0, 3, 5, 7, 10], parentMajor: 3 },
  majorPent: { name: 'scale.majorPent', intervals: [0, 2, 4, 7, 9], parentMajor: 0 },
  blues: { name: 'scale.blues', intervals: [0, 3, 5, 6, 7, 10], parentMajor: 3 },
  dorian: { name: 'scale.dorian', intervals: [0, 2, 3, 5, 7, 9, 10], parentMajor: 10 },
  mixolydian: { name: 'scale.mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], parentMajor: 5 },
  harmonicMinor: { name: 'scale.harmonicMinor', intervals: [0, 2, 3, 5, 7, 8, 11], parentMajor: 3 },
  phrygian: { name: 'scale.phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], parentMajor: 8 },
  lydian: { name: 'scale.lydian', intervals: [0, 2, 4, 6, 7, 9, 11], parentMajor: 7 },
  locrian: { name: 'scale.locrian', intervals: [0, 1, 3, 5, 6, 8, 10], parentMajor: 1 },
  melodicMinor: { name: 'scale.melodicMinor', intervals: [0, 2, 3, 5, 7, 9, 11], parentMajor: 3 },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

/** Bemollü yazılan majör tonlar: F, Bb, Eb, Ab, Db, Gb. */
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6]);

/** Bir majör ton için uygun nota adları (diyezli ya da bemollü). */
export function namesForMajorKey(root: number): readonly string[] {
  return FLAT_MAJOR_KEYS.has(mod12(root)) ? FLAT_NAMES : SHARP_NAMES;
}

export function namesForScale(root: number, id: ScaleId): readonly string[] {
  return namesForMajorKey(root + SCALES[id].parentMajor);
}

/** Gamın perde sınıfları, kökten başlayarak. */
export function scalePitchClasses(root: number, id: ScaleId): number[] {
  return SCALES[id].intervals.map((i) => mod12(root + i));
}

export function scaleNoteNames(root: number, id: ScaleId): string[] {
  const names = namesForScale(root, id);
  // Blues gamındaki "mavi nota" alışıldığı üzere bemollü yazılır (A blues: A C D Eb E G).
  return scalePitchClasses(root, id).map((pc, i) => (id === 'blues' && i === 3 ? FLAT_NAMES[pc] : names[pc]));
}

/** Gam adı için kök yazımı, ör. "Bb" (minör gamlarda "Bb", "A#" değil). */
export function scaleRootName(root: number, id: ScaleId): string {
  return namesForScale(root, id)[mod12(root)];
}
