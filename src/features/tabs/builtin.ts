import { buildTab, type NoteSpec, type Tab } from '../../music/tab';

/**
 * Hazır tab egzersizleri. Hepsi bu uygulama için yazılmış genel teknik alıştırmalardır;
 * hiçbir mevcut eserden riff ya da melodi içermez.
 */

/** Kromatik ısınma: her telde 1-2-3-4. perdeler, sekizlik notalarla, kalın telden inceye. */
const chromatic: NoteSpec[] = [];
for (let s = 0; s < 6; s++) {
  for (let i = 0; i < 4; i++) chromatic.push([s * 8 + i * 2, 6 - s, i + 1]);
}

/** La minör pentatonik, 1. kalıp (5. perde): çıkış ve iniş. */
const PENTA: [stringNumber: number, frets: number[]][] = [
  [6, [5, 8]],
  [5, [5, 7]],
  [4, [5, 7]],
  [3, [5, 7]],
  [2, [5, 8]],
  [1, [5, 8]],
];
const up: [number, number][] = PENTA.flatMap(([s, frets]) => frets.map((f): [number, number] => [s, f]));
const down = [...up].reverse().slice(1);
const pentatonic: NoteSpec[] = [...up, ...down].map(([s, f], i) => [i * 2, s, f]);

/** Boogie eşliği: kalın iki telde kök–beşli ile kök–altılı arasında gidip gelen sekizlikler (E ve A). */
const boogie: NoteSpec[] = [];
const addBoogie = (bar: number, rootString: number) => {
  for (let i = 0; i < 8; i++) {
    const step = bar * 16 + i * 2;
    boogie.push([step, rootString, 0]);
    boogie.push([step, rootString - 1, i % 4 < 2 ? 2 : 4]);
  }
};
addBoogie(0, 6);
addBoogie(1, 6);
addBoogie(2, 5);
addBoogie(3, 6);

/** Power akor ritmi: E5 ve G5, susturulmuş vuruşlarla. */
const power: NoteSpec[] = [];
const addPower = (step: number, fret: number, muted: boolean) => {
  if (muted) {
    power.push([step, 6, -2], [step, 5, -2], [step, 4, -2]);
  } else {
    power.push([step, 6, fret], [step, 5, fret + 2], [step, 4, fret + 2]);
  }
};
for (let bar = 0; bar < 2; bar++) {
  const fret = bar === 0 ? 0 : 3;
  const base = bar * 16;
  addPower(base, fret, false);
  addPower(base + 4, fret, true);
  addPower(base + 6, fret, false);
  addPower(base + 8, fret, true);
  addPower(base + 10, fret, false);
  addPower(base + 12, fret, false);
  addPower(base + 14, fret, true);
}

/** Tel atlama: açık teller arasında dönüşümlü pena çalışması. */
const skipping: NoteSpec[] = [6, 4, 5, 3, 4, 2, 3, 1, 3, 2, 4, 3, 5, 4, 6, 5].map((s, i) => [i * 2, s, 0]);

export const BUILTIN_TABS: Tab[] = [
  buildTab('builtin:kromatik', 'Kromatik ısınma (1-2-3-4)', 72, 3, chromatic, true),
  buildTab('builtin:pentatonik', 'La minör pentatonik — çıkış ve iniş', 80, 3, pentatonic, true),
  buildTab('builtin:boogie', 'Boogie eşliği (E – A)', 96, 4, boogie, true),
  buildTab('builtin:power', 'Power akor ritmi (E5 – G5)', 100, 2, power, true),
  buildTab('builtin:tel-atlama', 'Tel atlama (açık teller)', 76, 2, skipping, true),
];
