import { describe, expect, it } from 'vitest';
import { clampBpm, lcm, LookaheadPump, StepClock, TapTempo, tempoName, type StepEvent } from '../../src/audio/clock';
import { mulberry32 } from '../../src/audio/synth/karplus';
import {
  emptyPattern,
  getMeter,
  isValidPattern,
  METERS,
  nextStroke,
  PRESET_PATTERNS,
  resizePattern,
  slotForStep,
  slotLabel,
} from '../../src/features/metronome/patterns';

/** Zamanlayıcıyı düzensiz aralıklarla (titreşimli setInterval gibi) çalıştırır. */
function run(
  clock: StepClock,
  seconds: number,
  opts: { minGap?: number; maxGap?: number; lookahead?: number; seed?: number; start?: number } = {},
) {
  const events: (StepEvent & { scheduledAt: number })[] = [];
  const pump = new LookaheadPump(clock, (e, at) => events.push({ ...e, scheduledAt: at }), opts.lookahead ?? 0.15);
  const rand = mulberry32(opts.seed ?? 42);
  const minGap = opts.minGap ?? 0.005;
  const maxGap = opts.maxGap ?? 0.09;
  let now = opts.start ?? 0;
  const end = now + seconds;
  while (now < end) {
    pump.pump(now);
    now += minGap + rand() * (maxGap - minGap);
  }
  return events;
}

describe('StepClock + LookaheadPump', () => {
  it('zamanlayıcı titrese de tık zamanları ideal ızgaradan sapmaz', () => {
    const report: string[] = [];
    for (const bpm of [40, 97, 137, 200, 260]) {
      const start = 0.1;
      const stepsPerBeat = 4;
      const clock = new StepClock(start, { bpm, beatsPerBar: 4, stepsPerBeat });
      // 10 dakika, 5–90 ms arası rastgele zamanlayıcı aralıkları.
      const events = run(clock, 600);
      const stepDur = 60 / bpm / stepsPerBeat;
      let worst = 0;
      events.forEach((e, i) => {
        expect(e.index).toBe(i);
        worst = Math.max(worst, Math.abs(e.time - (start + i * stepDur)));
        // Her adım, çalınacağı andan önce planlanmış olmalı.
        expect(e.time).toBeGreaterThanOrEqual(e.scheduledAt);
      });
      expect(events.length).toBeGreaterThan((600 / stepDur) * 0.99);
      // Çift duyarlıklı kayan noktanın sınırında: 10 dakikada kayma yok.
      expect(worst).toBeLessThan(1e-9);
      report.push(`${bpm} BPM: ${(worst * 1e9).toFixed(4)} ns`);
    }
    console.log('[metronom] 10 dk, planlanan tık zamanının ideal ızgaradan en büyük sapması → ' + report.join(', '));
  });

  it('ölçü, vuruş ve alt adım sayaçları doğru ilerler', () => {
    const clock = new StepClock(0, { bpm: 120, beatsPerBar: 3, stepsPerBeat: 2 });
    const seq = Array.from({ length: 8 }, () => clock.next()).map((e) => `${e.bar}.${e.beat}.${e.sub}`);
    expect(seq).toEqual(['0.0.0', '0.0.1', '0.1.0', '0.1.1', '0.2.0', '0.2.1', '1.0.0', '1.0.1']);
  });

  it('tempo değişimi sıradaki adımdan itibaren, boşluk ya da sıçrama olmadan uygulanır', () => {
    const clock = new StepClock(1, { bpm: 60, beatsPerBar: 4, stepsPerBeat: 1 });
    const a = clock.next();
    const b = clock.next();
    expect(b.time - a.time).toBeCloseTo(1, 12);
    clock.setBpm(120);
    expect(clock.currentBpm).toBe(120);
    const c = clock.next(); // eski tempoyla belirlenmiş anda çalar, yeni tempoyu taşır
    expect(c.time - b.time).toBeCloseTo(1, 12);
    expect(c.bpm).toBe(120);
    const d = clock.next();
    const e = clock.next();
    expect(d.time - c.time).toBeCloseTo(0.5, 12);
    expect(e.time - d.time).toBeCloseTo(0.5, 12);
  });

  it('tempo antrenörü her N ölçüde hızlanır ve hedefte durur', () => {
    const clock = new StepClock(0, {
      bpm: 100,
      beatsPerBar: 4,
      stepsPerBeat: 1,
      trainer: { everyBars: 2, increment: 8, maxBpm: 120 },
    });
    const events = Array.from({ length: 4 * 12 }, () => clock.next());
    const bpmPerBar = Array.from({ length: 12 }, (_, bar) => events[bar * 4].bpm);
    expect(bpmPerBar).toEqual([100, 100, 108, 108, 116, 116, 120, 120, 120, 120, 120, 120]);
    // Ölçü içinde tempo sabit ve aralıklar o tempoya uygun.
    for (let i = 1; i < events.length; i++) {
      const dt = events[i].time - events[i - 1].time;
      expect(dt).toBeCloseTo(60 / events[i - 1].bpm, 10);
    }
    // Antrenör kapatılınca tempo sabit kalır.
    clock.setTrainer(null);
    expect(Array.from({ length: 16 }, () => clock.next().bpm).every((b) => b === 120)).toBe(true);
  });

  it('uzun bir duraklamadan sonra geçmiş adımları yığın halinde çalmaz', () => {
    const clock = new StepClock(0, { bpm: 120, beatsPerBar: 4, stepsPerBeat: 1 });
    const events: StepEvent[] = [];
    const pump = new LookaheadPump(clock, (e) => events.push(e), 0.15);
    pump.pump(0);
    pump.pump(0.1);
    const before = events.length;
    // Sekme 5 saniye uyudu.
    pump.pump(5.1);
    const fresh = events.slice(before);
    expect(fresh.length).toBeLessThanOrEqual(1);
    for (const e of fresh) expect(e.time).toBeGreaterThanOrEqual(5.1);
    // Izgara korunur: zamanlar hâlâ 0,5 sn'nin katı.
    pump.pump(5.6);
    for (const e of events) expect(Math.abs(e.time / 0.5 - Math.round(e.time / 0.5))).toBeLessThan(1e-9);
  });
});

describe('TapTempo', () => {
  it('dokunuş aralıklarından tempoyu bulur', () => {
    const tap = new TapTempo();
    expect(tap.tap(0)).toBeNull();
    expect(tap.tap(500)).toBe(120);
    expect(tap.tap(1000)).toBe(120);
    expect(tap.tap(1520)).toBe(118);
  });

  it('uzun aradan sonra sıfırlanır ve sınırlar içinde kalır', () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(600);
    expect(tap.tap(5000)).toBeNull();
    expect(tap.tap(5100)).toBe(260); // 600 BPM → üst sınır
    expect(clampBpm(5)).toBe(30);
    expect(clampBpm(99.6)).toBe(100);
  });
});

describe('yardımcılar', () => {
  it('lcm ve tempo adları', () => {
    expect(lcm(3, 2)).toBe(6);
    expect(lcm(4, 2)).toBe(4);
    expect(lcm(1, 4)).toBe(4);
    expect(tempoName(50)).toBe('Largo');
    expect(tempoName(100)).toBe('Andante');
    expect(tempoName(180)).toBe('Presto');
  });
});

describe('vuruş kalıpları', () => {
  it('hazır kalıplar geçerli ve ölçüleriyle uyumlu', () => {
    const ids = new Set<string>();
    for (const p of PRESET_PATTERNS) {
      expect(isValidPattern(p), p.id).toBe(true);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(METERS.some((m) => m.beats === p.beats)).toBe(true);
      // Her kalıpta en az bir vuruş var.
      expect(p.slots.some((s) => s !== '-')).toBe(true);
    }
    for (const m of METERS) expect(m.accents).toHaveLength(m.beats);
    expect(getMeter('yok').id).toBe('4/4');
  });

  it('saat adımı doğru kalıp hücresine eşlenir', () => {
    // Vuruş başına 4 adım, kalıp sekizlik (2): yalnızca çift alt adımlar hücreye denk gelir.
    expect(slotForStep(0, 0, 4, 2)).toBe(0);
    expect(slotForStep(0, 1, 4, 2)).toBe(-1);
    expect(slotForStep(0, 2, 4, 2)).toBe(1);
    expect(slotForStep(3, 2, 4, 2)).toBe(7);
    // Üçleme (3) ile sekizlik kalıp (2) → 6 adım.
    expect(slotForStep(1, 3, 6, 2)).toBe(3);
    expect(slotForStep(1, 2, 6, 2)).toBe(-1);
    // Izgara kalıbı taşımıyorsa eşleşme yok.
    expect(slotForStep(0, 0, 3, 2)).toBe(-1);
  });

  it('düzenleyici yardımcıları', () => {
    expect(emptyPattern(3, 2)).toEqual(['D', '-', 'D', '-', 'D', '-']);
    expect(nextStroke('-')).toBe('D');
    expect(nextStroke('D')).toBe('U');
    expect(nextStroke('U')).toBe('X');
    expect(nextStroke('X')).toBe('-');
    // Sekizlikten on altılığa: vuruşlar yerinde kalır.
    expect(resizePattern(['D', 'U', 'X', '-'], 2, 2, 4)).toEqual(['D', '-', 'U', '-', 'X', '-', '-', '-']);
    // On altılıktan sekizliğe: ızgaraya oturmayanlar düşer.
    expect(resizePattern(['D', 'U', 'D', 'U', 'D', '-', 'X', '-'], 2, 4, 2)).toEqual(['D', 'D', 'D', 'X']);
    expect([0, 1, 2, 3].map((i) => slotLabel(i, 2))).toEqual(['1', '&', '2', '&']);
    expect([0, 1, 2, 3, 4].map((i) => slotLabel(i, 4))).toEqual(['1', 'e', '&', 'a', '2']);
    expect(isValidPattern({ id: 'x', name: 'a', beats: 2, division: 2, slots: ['D', 'U'] })).toBe(false);
    expect(isValidPattern({ id: 'x', name: 'a', beats: 1, division: 2, slots: ['D', 'Q'] })).toBe(false);
  });
});
