import { chordSymbol, mod12, QUALITIES, type Quality } from './theory';

/** Tanınan akor türleri. */
export const RECOGNIZED_QUALITIES: Quality[] = ['maj', 'min', '7', 'm7', 'maj7', 'sus2', 'sus4', '5', 'add9'];

export interface ChordGuess {
  root: number;
  quality: Quality;
  symbol: string;
  /** 0..1 benzerlik (kosinüs + bas uyumu). */
  score: number;
}

/** Bir notanın harmoniklerinin düştüğü perde sınıfları (kökten yarım ton) ve göreli güçleri. */
const HARMONICS: [offset: number, weight: number][] = [
  [0, 1],
  [0, 0.5],
  [7, 0.25],
  [0, 0.125],
  [4, 0.0625],
  [7, 0.03],
];

/**
 * Bir akorun beklenen kroma şablonu. Yalnızca akor notalarını değil, her notanın
 * harmoniklerinin düştüğü perde sınıflarını da içerir (ör. Do majörde Mi'nin 3. harmoniği Si'dir);
 * böylece harmonikler yanlış akor türüne (Cmaj7) yorumlanmaz. Birim uzunluğa ölçeklenir.
 */
export function chordTemplate(root: number, quality: Quality): Float32Array {
  const t = new Float32Array(12);
  for (const interval of QUALITIES[quality].intervals) {
    for (const [offset, weight] of HARMONICS) t[mod12(root + interval + offset)] += weight;
  }
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += t[i] * t[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 12; i++) t[i] /= norm;
  return t;
}

const TEMPLATES = new Map<string, Float32Array>();

function template(root: number, quality: Quality): Float32Array {
  const key = `${mod12(root)}:${quality}`;
  let t = TEMPLATES.get(key);
  if (!t) {
    t = chordTemplate(root, quality);
    TEMPLATES.set(key, t);
  }
  return t;
}

/** Bas notası akorun kökü ise eklenen puan: aynı notalardan oluşan akorları (Asus2 / Esus4) ayırır. */
export const BASS_BONUS = 0.06;

/** Kroma ile bir akor arasındaki benzerlik (0..1+). */
export function chordSimilarity(chroma: ArrayLike<number>, root: number, quality: Quality, bass = -1): number {
  const t = template(root, quality);
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < 12; i++) {
    dot += chroma[i] * t[i];
    norm += chroma[i] * chroma[i];
  }
  if (norm <= 0) return 0;
  return dot / Math.sqrt(norm) + (bass === mod12(root) ? BASS_BONUS : 0);
}

/** Kromaya en çok benzeyen akorlar, en iyiden başlayarak. */
export function rankChords(chroma: ArrayLike<number>, bass = -1, qualities: Quality[] = RECOGNIZED_QUALITIES): ChordGuess[] {
  const out: ChordGuess[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      out.push({ root, quality, symbol: chordSymbol(root, quality), score: chordSimilarity(chroma, root, quality, bass) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** En olası akor; kroma boşsa null. */
export function recognizeChord(chroma: ArrayLike<number>, bass = -1): ChordGuess | null {
  let any = false;
  for (let i = 0; i < 12; i++) if (chroma[i] > 0) any = true;
  if (!any) return null;
  return rankChords(chroma, bass)[0];
}

export interface ChordTarget {
  root: number;
  quality: Quality;
  symbol: string;
}

/** Bir akorun "çalındı" sayılması için gereken en düşük benzerlik. */
export const MATCH_THRESHOLD = 0.72;

/**
 * Bilinen adaylar arasından hangisinin çalındığını bulur (geçiş egzersizi, şarkı modu).
 * Aday sayısı az olduğundan açık tanımadan çok daha güvenilirdir.
 * @returns Çalınan adayın sırası; hiçbiri yeterince benzemiyorsa ya da ikisi ayırt edilemiyorsa -1.
 */
export function pickTarget(chroma: ArrayLike<number>, bass: number, targets: ChordTarget[], margin = 0.04): number {
  let best = -1;
  let bestScore = 0;
  let second = 0;
  targets.forEach((t, i) => {
    const s = chordSimilarity(chroma, t.root, t.quality, bass);
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = i;
    } else if (s > second) {
      second = s;
    }
  });
  if (best < 0 || bestScore < MATCH_THRESHOLD) return -1;
  if (targets.length > 1 && bestScore - second < margin) return -1;
  return best;
}

/** Beklenen akor gerçekten çalınıyor mu: hem yeterince benziyor hem de en iyi tahminlere yakın. */
export function isChordPlayed(chroma: ArrayLike<number>, bass: number, expected: ChordTarget): boolean {
  const score = chordSimilarity(chroma, expected.root, expected.quality, bass);
  if (score < MATCH_THRESHOLD) return false;
  const top = rankChords(chroma, bass)[0];
  // Aynı kökte yakın türler (C ↔ Cadd9) ya da çok yakın puanlar kabul edilir.
  return top.symbol === expected.symbol || top.score - score < 0.05;
}

/**
 * Geçiş sayacı: kare kare gelen aday sıralarını (-1 = belirsiz) kararlı akor değişimlerine çevirir.
 * Bir akor, art arda `stable` karede duyulunca "tutuldu" sayılır; farklı bir akor tutulunca sayaç artar.
 */
export class TransitionCounter {
  count = 0;
  /** Şu an tutulan aday (yoksa -1). */
  current = -1;
  private pending = -1;
  private run = 0;

  constructor(private readonly stable = 3) {}

  push(index: number): boolean {
    if (index < 0) {
      this.run = 0;
      this.pending = -1;
      return false;
    }
    if (index === this.pending) this.run++;
    else {
      this.pending = index;
      this.run = 1;
    }
    if (this.run >= this.stable && index !== this.current) {
      const changed = this.current >= 0;
      this.current = index;
      if (changed) this.count++;
      return changed;
    }
    return false;
  }

  reset(): void {
    this.count = 0;
    this.current = -1;
    this.pending = -1;
    this.run = 0;
  }
}
