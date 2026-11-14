import { describe, expect, it } from 'vitest';
import {
  accrue,
  activityTotals,
  addDays,
  clockText,
  dailyTotals,
  dayKey,
  durationParts,
  isSessionRecord,
  keyToDate,
  streaks,
  toRecord,
  totalSeconds,
  type ActiveSession,
  type SessionRecord,
} from '../../src/features/log/stats';

let seq = 0;
/** Yerel saate göre verilen günde bir oturum. */
function session(y: number, m: number, d: number, seconds: number, activities?: Record<string, number>, hour = 18): SessionRecord {
  return {
    id: `s${seq++}`,
    type: 'session',
    date: new Date(y, m - 1, d, hour).getTime(),
    seconds,
    activities: activities ?? { free: seconds },
  };
}

describe('gün anahtarları', () => {
  it('yerel güne göre anahtar üretir; ay ve yıl sınırlarını aşar', () => {
    expect(dayKey(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
    expect(dayKey(new Date(2026, 10, 15, 0, 0))).toBe('2026-11-15');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(dayKey(keyToDate('2026-03-09'))).toBe('2026-03-09');
    // Yaz saati geçişlerinde gün atlanmaz/tekrarlanmaz.
    let k = '2026-03-20';
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(k);
      k = addDays(k, 1);
    }
    expect(seen.size).toBe(20);
    expect(k).toBe('2026-04-09');
  });
});

describe('seri', () => {
  const today = '2026-11-14';

  it('kayıt yokken sıfır', () => {
    expect(streaks([], today)).toEqual({ current: 0, longest: 0, practicedToday: false });
  });

  it('bugün dahil kesintisiz günleri sayar', () => {
    const s = [session(2026, 11, 14, 600), session(2026, 11, 13, 300), session(2026, 11, 12, 900), session(2026, 11, 10, 900)];
    expect(streaks(s, today)).toEqual({ current: 3, longest: 3, practicedToday: true });
  });

  it('bugün henüz çalışılmadıysa seri dünden sayılır', () => {
    const s = [session(2026, 11, 13, 300), session(2026, 11, 12, 900)];
    expect(streaks(s, today)).toEqual({ current: 2, longest: 2, practicedToday: false });
  });

  it('bir gün atlanınca seri sıfırlanır; en uzun seri korunur', () => {
    const s = [
      session(2026, 11, 12, 600),
      session(2026, 11, 5, 600),
      session(2026, 11, 4, 600),
      session(2026, 11, 3, 600),
      session(2026, 11, 2, 600),
    ];
    expect(streaks(s, today)).toEqual({ current: 0, longest: 4, practicedToday: false });
  });

  it('bir dakikadan az çalışılan gün sayılmaz; aynı günün oturumları toplanır', () => {
    expect(streaks([session(2026, 11, 14, 40)], today).current).toBe(0);
    expect(streaks([session(2026, 11, 14, 40, undefined, 9), session(2026, 11, 14, 30, undefined, 21)], today).current).toBe(1);
  });

  it('ay sınırını aşan seri', () => {
    const s = [session(2026, 11, 2, 600), session(2026, 11, 1, 600), session(2026, 10, 31, 600), session(2026, 10, 30, 600)];
    expect(streaks(s, '2026-11-02').current).toBe(4);
  });
});

describe('toplamlar', () => {
  const today = '2026-11-14';
  const s = [
    session(2026, 11, 14, 600, { chords: 400, tuning: 200 }),
    session(2026, 11, 14, 300, { rhythm: 300 }, 9),
    session(2026, 11, 12, 1200, { chords: 1200 }),
    session(2026, 11, 1, 900, { free: 900 }),
  ];

  it('günlük toplamlar eskiden yeniye, boş günler sıfır', () => {
    const week = dailyTotals(s, 7, today);
    expect(week.map((d) => d.key)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(week.map((d) => d.seconds)).toEqual([0, 0, 0, 0, 1200, 0, 900]);
    const month = dailyTotals(s, 30, today);
    expect(month).toHaveLength(30);
    expect(month.reduce((sum, d) => sum + d.seconds, 0)).toBe(3000);
  });

  it('egzersiz türüne göre dağılım çoktan aza, dönemle sınırlı', () => {
    expect(activityTotals(s, '2026-11-08')).toEqual([
      { activity: 'chords', seconds: 1600 },
      { activity: 'rhythm', seconds: 300 },
      { activity: 'tuning', seconds: 200 },
    ]);
    expect(activityTotals(s, '2026-11-01').find((a) => a.activity === 'free')?.seconds).toBe(900);
    expect(totalSeconds(s, '2026-11-08')).toBe(2100);
    expect(totalSeconds(s)).toBe(3000);
  });
});

describe('süre biçimleri', () => {
  it('sayaç ve süre parçaları', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(65.9)).toBe('01:05');
    expect(clockText(3729)).toBe('1:02:09');
    expect(durationParts(3729)).toEqual({ h: 1, m: 2, s: 9 });
    expect(durationParts(59.6)).toEqual({ h: 0, m: 1, s: 0 });
  });
});

describe('oturum sayacı', () => {
  const base: ActiveSession = { startedAt: 1000, seconds: 0, activities: {}, paused: false, lastTick: 1000 };

  it('geçen süreyi etkin egzersize yazar', () => {
    let s = accrue(base, 'tuning', 2000);
    s = accrue(s, 'tuning', 3500);
    s = accrue(s, 'chords', 4500);
    expect(s.seconds).toBeCloseTo(3.5, 6);
    expect(s.activities.tuning).toBeCloseTo(2.5, 6);
    expect(s.activities.chords).toBeCloseTo(1, 6);
  });

  it('duraklatılmışken ve uzun boşluklarda süre birikmez', () => {
    const paused = accrue({ ...base, paused: true }, 'free', 60_000);
    expect(paused.seconds).toBe(0);
    expect(paused.lastTick).toBe(60_000);
    // Cihaz 10 dakika uyudu: en fazla 5 sn sayılır.
    expect(accrue(base, 'free', 601_000).seconds).toBe(5);
    // Saat geri alınırsa negatif süre yazılmaz.
    expect(accrue(base, 'free', 0).seconds).toBe(0);
  });

  it('kayda çevirme: yuvarlama, kısa oturumu atma', () => {
    expect(toRecord({ ...base, seconds: 9.4, activities: { free: 9.4 } }, 'x')).toBeNull();
    const r = toRecord({ ...base, seconds: 115.4, activities: { tuning: 30.2, rhythm: 85, free: 0.2 } }, 'x')!;
    expect(r).toEqual({ id: 'x', type: 'session', date: 1000, seconds: 115, activities: { tuning: 30, rhythm: 85 } });
    expect(isSessionRecord(r)).toBe(true);
    expect(isSessionRecord({ id: 'x', date: 1 })).toBe(false);
  });
});
