import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

/**
 * Oyunlaştırma: XP, seviye, günlük görevler ve rozetler kayıtlı veriden türetilir.
 * Tarih sabitlenir (2026-11-19 öğle, yerel saat): görevler güne göre döndüğü için testler gece yarısı kaymaz.
 * Bu günün görevleri: 15 dakika çalış + havuzdan iki görev.
 */
const NOON = new Date(2026, 10, 19, 12, 0, 0);

async function fixDate(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOON);
}

/** Uygulama açılıp oyun durumu ilk kez yazılana kadar bekler (sonra eklenen veri "yeni" sayılır). */
async function openHome(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('game-card')).toBeVisible();
  await page.evaluate(() => window.__gitar!.flush());
}

/** Bir haftalık seri ve bugünün tüm görevlerini karşılayan veri. */
async function seedWeek(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gitar-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['sessions', 'results', 'items'], 'readwrite');
          const now = Date.now();
          const day = 86_400_000;
          const sessions = tx.objectStore('sessions');
          for (let i = 6; i >= 1; i--) {
            sessions.put({ id: `s${i}`, type: 'session', date: now - i * day, seconds: 1200, activities: { theory: 1200 } });
          }
          sessions.put({
            id: 's0',
            type: 'session',
            date: now - 3_600_000,
            seconds: 2100,
            activities: { chords: 600, song: 700, rhythm: 300, ear: 300, free: 200 },
          });
          const results = tx.objectStore('results');
          for (let i = 0; i < 3; i++) {
            results.put({ id: `t${i}`, type: 'transition', date: now - 600_000, a: 'C', b: 'G', pair: 'C|G', count: 32, seconds: 60 });
          }
          results.put({
            id: 'r1',
            type: 'rhythm',
            date: now - 500_000,
            bpm: 80,
            bars: 8,
            what: 'div:1',
            source: 'metronome',
            targets: 32,
            hits: 32,
            missed: 0,
            extra: 0,
            meanMs: 2,
            absMs: 12,
            stdMs: 14,
            accuracy: 90,
            consistency: 70,
            deviations: [],
          });
          for (let i = 0; i < 2; i++) {
            results.put({ id: `e${i}`, type: 'ear', date: now - 400_000, kind: 'interval', level: 1, correct: 9, total: 10, seconds: 40, items: {} });
          }
          results.put({
            id: 'f1',
            type: 'fretgame',
            date: now - 300_000,
            mode: 'name',
            maxFret: 5,
            naturalsOnly: true,
            correct: 10,
            total: 10,
            seconds: 35,
          });
          tx.objectStore('items').put({ id: 'rec1', type: 'recording', date: now - 200_000, name: 'Kayıt', seconds: 3, peaks: [], peak: 0.5, mime: 'audio/webm', bytes: 100 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('boş başlangıç: seviye 1, 0 XP, üç görev, kilitli rozetler', async ({ page }, info) => {
  await fixDate(page);
  await openHome(page);
  const card = page.getByTestId('game-card');
  await expect(card.getByTestId('game-level-text')).toHaveText('Seviye 1 · Acemi');
  await expect(card.getByTestId('game-xp')).toHaveText('0 XP');
  await expect(card.getByTestId('quest-list').locator('.quest')).toHaveCount(3);
  await expect(card.getByTestId('quest-practice15')).toHaveAttribute('data-done', 'false');
  await expect(card.getByTestId('quest-practice15-value')).toHaveText('0/15 dk');
  await expect(card.getByTestId('quests-progress')).toHaveText('0/3 görev tamam. Görevler her gün yenilenir.');
  await expect(page.getByTestId('tool-progress')).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await expectHealthyLayout(page);
  await shot(page, info, 'gamify-home-empty');

  // Göreve dokununca ilgili araç açılır.
  await card.getByTestId('quest-practice15').click();
  await expect(page.getByTestId('page-title')).toHaveText('Günlük');

  await page.goto('./#/progress');
  await expect(page.getByTestId('page-title')).toHaveText('Başarılar');
  await expect(page.getByTestId('game-badges-earned')).toHaveText('0 / 25 rozet kazanıldı');
  await expect(page.locator('.badge-tile.locked')).toHaveCount(25);
  await expect(page.getByTestId('badge-streak7')).toContainText('0/7');
  await expect(page.getByTestId('badge-hours1')).toContainText('0/60 dk');
  await expect(page.getByTestId('game-history-chart')).toBeVisible();
  await expectHealthyLayout(page);
  await shot(page, info, 'gamify-progress-empty', true);
});

test('elle eklenen oturum XP, görev ve rozet kazandırır; bildirim çıkar', async ({ page }) => {
  await fixDate(page);
  await openHome(page);
  await page.goto('./#/log');
  await page.getByTestId('manual-add').click();
  await page.getByTestId('manual-save').click();

  // 20 dk: 20 XP + çalışılan gün 10 XP + "15 dakika çalış" görevi 20 XP.
  await expect(page.getByTestId('toast-badge')).toHaveText('Yeni rozet: İlk adım');
  await expect(page.getByTestId('toast-quest')).toHaveText('Görev tamam: 15 dakika çalış (+20 XP)');

  await page.getByTestId('nav-home').click();
  const card = page.getByTestId('game-card');
  await expect(card.getByTestId('game-xp')).toHaveText('50 XP');
  await expect(card.getByTestId('game-today-xp')).toHaveText('Bugün +50 XP');
  await expect(card.getByTestId('quest-practice15')).toHaveAttribute('data-done', 'true');
  await expect(card.getByTestId('quest-practice15-value')).toHaveText('+20 XP');
  await expect(card.getByTestId('quests-progress')).toHaveText('1/3 görev tamam. Görevler her gün yenilenir.');

  // Bildirimler kaybolur ve aynı başarı ikinci kez bildirilmez (sayfa yenilense de).
  await expect(page.getByTestId('toast-badge')).toHaveCount(0, { timeout: 8000 });
  await page.reload();
  await expect(page.getByTestId('game-card').getByTestId('game-xp')).toHaveText('50 XP');
  await page.waitForTimeout(500);
  await expect(page.locator('.toast')).toHaveCount(0);

  await page.getByTestId('game-open').click();
  await expect(page.getByTestId('badge-firstSession')).toHaveAttribute('data-earned', 'true');
  await expect(page.getByTestId('badge-firstSession')).toContainText('Kazanıldı: 19 Kas 2026');
  await expect(page.getByTestId('game-source-practice')).toContainText('30 XP');
  await expect(page.getByTestId('game-source-quest')).toContainText('20 XP');
});

test('süren oturum görevi canlı tamamlar', async ({ page }) => {
  await page.clock.install({ time: NOON });
  await openHome(page);
  // Saat durur; zaman yalnızca runFor ile ilerler (bildirim 4,5 sn sonra kaybolduğu için).
  await page.clock.pauseAt(new Date(NOON.getTime() + 120_000));
  await page.goto('./#/log');
  await page.getByTestId('session-start').click();
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('page-title')).toHaveText('Gitar Çalışma');
  await page.clock.runFor(14 * 60_000 + 5_000);
  await expect(page.getByTestId('quest-practice15-value')).toHaveText('14/15 dk');
  await page.clock.runFor(56_000);
  await expect(page.getByTestId('quest-practice15')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('toast-quest')).toHaveText('Görev tamam: 15 dakika çalış (+20 XP)');
  await page.clock.resume();
});

test('bir haftalık veri: seri ve görev rozetleri, tüm görevler tamam, seviye atlama', async ({ page }, info) => {
  await fixDate(page);
  await openHome(page);
  await seedWeek(page);
  await page.reload();

  const card = page.getByTestId('game-card');
  await expect(card.getByTestId('quests-all-done')).toHaveText('Bugünün tüm görevleri tamam! +20 XP ek ödül.');
  await expect(card.locator('.quest.done')).toHaveCount(3);
  await expect(card.getByTestId('game-level-text')).not.toHaveText(/^Seviye 1 /);
  // Çok sayıda yeni başarı tek bir özet bildirimde toplanır.
  await expect(page.getByTestId('toast-many')).toContainText('yeni başarı kazandın');
  await card.scrollIntoViewIfNeeded();
  await expectHealthyLayout(page);
  await shot(page, info, 'gamify-home-week');

  await page.getByTestId('game-open').click();
  await expect(page.getByTestId('page-title')).toHaveText('Başarılar');
  for (const id of [
    'firstSession',
    'streak3',
    'streak7',
    'hours1',
    'explorer',
    'txFirst',
    'tx30',
    'rhythmFirst',
    'rhythm80',
    'earFirst',
    'fretFirst',
    'fretPerfect',
    'recordFirst',
    'perfectDay',
  ]) {
    await expect(page.getByTestId(`badge-${id}`), id).toHaveAttribute('data-earned', 'true');
  }
  for (const id of ['streak30', 'tx60', 'rhythm95', 'earLevel4', 'songFirst', 'tabFirst', 'quests25']) {
    await expect(page.getByTestId(`badge-${id}`), id).toHaveAttribute('data-earned', 'false');
  }
  await expect(page.getByTestId('badge-streak3')).toContainText('Kazanıldı: 15 Kas 2026');
  await expect(page.getByTestId('game-badges-earned')).toHaveText('14 / 25 rozet kazanıldı');
  await expect(page.getByTestId('game-badge-count')).toHaveText('14');
  await expect(page.getByTestId('game-history-chart').locator('rect.chart-bar')).toHaveCount(14);
  await expectHealthyLayout(page);
  await shot(page, info, 'gamify-progress-week', true);

  // İngilizce
  await page.goto('./#/settings');
  await page.getByTestId('lang').getByRole('radio', { name: 'English' }).click();
  await page.goto('./#/progress');
  await expect(page.getByTestId('page-title')).toHaveText('Achievements');
  await expect(page.getByTestId('game-badges-earned')).toHaveText('14 / 25 badges earned');
  await expect(page.getByTestId('badge-perfectDay')).toContainText('Perfect day');
  await expectHealthyLayout(page);
  await shot(page, info, 'gamify-progress-en', true);
});
