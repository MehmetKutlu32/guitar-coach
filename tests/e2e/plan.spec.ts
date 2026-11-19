import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, installFixedClock, shot } from './helpers';

// Plan "bugün"e göre kurulur (günden güne dönen eşlik, şarkı, kulak türü…): testler gerçek saate değil,
// sabit sahte saate (18 Kasım 2026) göre çalışır; gece yarısı başlayan çalıştırmada da gün değişmez.
let start = 0;
test.beforeEach(async ({ page }) => {
  start = await installFixedClock(page);
});

/** Veritabanına doğrudan kayıt yazar (ör. içe aktarılmış geçmiş); ardından sayfa yenilenmeli. */
async function seed(page: Page, store: 'results' | 'sessions', records: Record<string, unknown>[]): Promise<void> {
  // Veritabanını uygulama kurmuş olmalı (yoksa depoları olmayan boş bir veritabanı açılırdı).
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'gitar-app')))
    .toBe(true);
  await page.evaluate(
    ([store, records]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gitar-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite');
          for (const r of records) tx.objectStore(store).put(r);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [store, records] as const,
  );
}

const DAY = 86_400_000;

test('ilk açılışta seviye testi; sonuca göre günlük plan üretilir', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('plan')).toHaveCount(0);
  await expectHealthyLayout(page);
  await shot(page, info, 'home-welcome');

  await page.getByTestId('test-start').click();
  await expect(page).toHaveURL(/#\/home\/test$/);
  await expect(page.getByTestId('test-step')).toHaveText('Soru 1 / 6');
  await expect(page.getByTestId('test-question')).toHaveText('Ne zamandır gitar çalıyorsun?');
  await expectHealthyLayout(page);
  await shot(page, info, 'level-test');

  // Birkaç aydır çalıyor, açık akorları basabiliyor, bare yok, ritim deniyor, gam yok, hedef: akor eşliği.
  await page.getByTestId('answer-1').click();
  await expect(page.getByTestId('test-step')).toHaveText('Soru 2 / 6');
  // Geri dönüp yanıt değiştirilebilir.
  await page.getByTestId('test-back').click();
  await expect(page.getByTestId('test-step')).toHaveText('Soru 1 / 6');
  await expect(page.getByTestId('answer-1')).toHaveClass(/chosen/);
  await page.getByTestId('answer-1').click();
  await page.getByTestId('answer-1').click(); // açık akorlar
  await page.getByTestId('answer-0').click(); // bare
  await page.getByTestId('answer-1').click(); // ritim
  await page.getByTestId('answer-0').click(); // gam
  await expect(page.getByTestId('test-question')).toHaveText('En çok neyi geliştirmek istiyorsun?');
  await page.getByTestId('answer-0').click(); // hedef: akor eşliği

  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('plan')).toBeVisible();
  await expect(page.getByTestId('plan-level')).toContainText('Seviyen: temel.');
  // 30 dakikalık plan: akort, iki geçiş, ritim, eşlik + akor hedefine göre şarkı ve kulak eğitimi.
  const rows = page.getByTestId('plan-list').locator('.plan-row');
  await expect(rows).toHaveCount(7);
  await expect(page.getByTestId('plan-progress')).toHaveText('0 / 7 tamamlandı');
  await expect(rows.nth(0)).toContainText('Akort et');
  await expect(rows.nth(1)).toContainText('Akor geçişi: Em ↔ G');
  await expect(rows.nth(1)).toContainText('Başlangıç için iyi bir çift.');
  await expect(rows.nth(3)).toContainText('Ritim ölçümü: 80 BPM, sekizlikler');
  // Temel seviyede şarkı %90 tempoyla (92 → 83 BPM); kulak eğitiminde akor hedefi → akor türleri.
  await expect(page.getByTestId('plan-item-song')).toContainText('Şarkı: Pazartesi Blues, 83 BPM');
  await expect(page.getByTestId('plan-item-song')).toContainText('tempo %90');
  await expect(page.getByTestId('plan-item-ear')).toContainText('Kulak eğitimi: akor türleri, 1. seviye');
  await expect(page.getByTestId('plan-item-ear')).toContainText('ilk seviyeden başla');
  // Dakikaların toplamı seçilen süreye eşit.
  const total = async () =>
    (await page.getByTestId('plan-list').locator('.plan-min').allTextContents()).reduce((s, x) => s + parseInt(x, 10), 0);
  expect(await total()).toBe(30);
  await expectHealthyLayout(page);
  await shot(page, info, 'home-plan', true);

  // Süre değişince plan yeniden kurulur.
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '15 dk' }).click();
  await expect(rows).toHaveCount(5);
  expect(await total()).toBe(15);
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '45 dk' }).click();
  await expect(rows).toHaveCount(9);
  expect(await total()).toBe(45);
  await expect(page.getByTestId('plan-item-pattern')).toContainText('Vuruş kalıbı');
  await expect(page.getByTestId('plan-item-fretgame')).toContainText('Sapta nota oyunu: Notayı adlandır (0–5. perde)');
  await expectHealthyLayout(page);
  await shot(page, info, 'home-plan-45', true);

  // Yeniden açılışta test tekrar sorulmaz, süre seçimi korunur.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(rows).toHaveCount(9);
});

test('plan maddesi ilgili aracı hazır ayarlarla açar; biten egzersiz maddeyi kendiliğinden tamamlar', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('test-skip').click();
  await expect(page.getByTestId('plan-level')).toContainText('Seviye testini atladın');
  const rows = page.getByTestId('plan-list').locator('.plan-row');
  await expect(rows).toHaveCount(7);

  // Elle işaretleme.
  const tune = page.getByTestId('plan-item-tune');
  await tune.getByTestId('plan-check').click();
  await expect(tune).toHaveClass(/done/);
  await expect(page.getByTestId('plan-progress')).toHaveText('1 / 7 tamamlandı');
  await tune.getByTestId('plan-check').click();
  await expect(page.getByTestId('plan-progress')).toHaveText('0 / 7 tamamlandı');
  await tune.getByTestId('plan-check').click();

  // Ritim maddesi: ritim ekranı planın temposuyla açılır.
  await page.getByTestId('plan-item-rhythm').getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/rhythm$/);
  await expect(page.getByTestId('rhythm-bpm').locator('output')).toHaveText('70 BPM');
  await expect(page.getByTestId('rhythm-what')).toHaveValue('div:1');

  // Eşlik maddesi.
  await page.goto('./#/home');
  await page.getByTestId('plan-item-backing').getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/backing$/);
  await expect(page.getByTestId('progression')).toHaveValue('minorRock');

  // Geçiş maddesi: egzersiz o çiftle açılır.
  await page.goto('./#/home');
  await page.getByTestId('plan-item-transition').first().getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/chords\/practice$/);
  await expect(page.getByTestId('chord-a')).toHaveValue('Em');
  await expect(page.getByTestId('chord-b')).toHaveValue('G');

  // Egzersizi yap ve kaydet (saat ileri sarılır).
  await page.getByTestId('tx-start').click();
  await page.clock.fastForward(3200);
  for (let i = 0; i < 3; i++) await page.getByTestId('tx-plus').click();
  await page.clock.fastForward(61_000);
  await page.getByTestId('tx-save').click();
  await expect(page.getByTestId('tx-saved')).toBeVisible();

  // Ana sayfada madde kendiliğinden tamamlanmış; elle işaret de duruyor.
  await page.getByTestId('nav-home').click();
  const transition = page.getByTestId('plan-item-transition').first();
  await expect(transition).toHaveClass(/done/);
  await expect(transition.getByTestId('plan-check')).toBeDisabled();
  await expect(page.getByTestId('plan-progress')).toHaveText('2 / 7 tamamlandı');
  // Aynı çift artık "zayıf" olarak planın başında kalır (dakikada 3 < hedef 30); nedeni güncellenir.
  await expect(transition).toContainText('En zayıf geçişin: dakikada 3 (hedef 30).');
});

test('kulak, sap, şarkı ve tab maddeleri doğru ekranı doğru ayarlarla açar; bugünkü sonuçlar maddeyi tamamlar', async ({
  page,
}, info) => {
  await page.goto('./');
  await page.getByTestId('test-skip').click();
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '45 dk' }).click();
  const rows = page.getByTestId('plan-list').locator('.plan-row');
  await expect(rows).toHaveCount(9);

  // Kulak eğitimi: akor türleri, 1. seviye.
  const ear = page.getByTestId('plan-item-ear');
  await expect(ear).toContainText('Kulak eğitimi: akor türleri, 1. seviye');
  await ear.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/ear$/);
  await expect(page.getByTestId('ear-kind').getByRole('radio', { name: 'Akorlar' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ear-level-1')).toHaveAttribute('aria-checked', 'true');

  // Nota oyunu: "Oyun" bölümü, notayı adlandır, 0–5. perde, yalnızca doğal notalar.
  await page.goto('./#/home');
  const fret = page.getByTestId('plan-item-fretgame');
  await expect(fret).toContainText('Sapta notaların yerini ezberlemeye başla.');
  await fret.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/theory$/);
  await expect(page.getByTestId('theory-view').getByRole('radio', { name: 'Oyun' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('game-mode').getByRole('radio', { name: 'Notayı adlandır' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('game-range').getByRole('radio', { name: '0–5. perde' })).toHaveAttribute('aria-checked', 'true');

  // Riff: yeni başlayana %50 hızda.
  await page.goto('./#/home');
  const tab = page.getByTestId('plan-item-tab');
  await expect(tab).toContainText('Riff: Power akor ritmi (E5 – G5), %50 hız');
  await tab.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/tabs\/builtin%3Apower$/);
  await expect(page.getByTestId('tab-title')).toContainText('Power akor ritmi');
  await expect(page.getByTestId('tab-speed').getByRole('radio', { name: '%50' })).toHaveAttribute('aria-checked', 'true');

  // Bugünkü kulak turu (akor türü), nota oyunu turu ve 3 dakikalık tab çalışması maddeleri tamamlar;
  // başka türdeki kulak turu ve dünkü oturum saymaz.
  const now = await page.evaluate(() => Date.now());
  await seed(page, 'results', [
    { id: 'e1', type: 'ear', date: now, kind: 'interval', level: 1, correct: 9, total: 10, seconds: 60, items: {} },
    { id: 'g1', type: 'fretgame', date: now, mode: 'name', maxFret: 5, naturalsOnly: true, correct: 7, total: 10, seconds: 50 },
  ]);
  await seed(page, 'sessions', [{ id: 's0', type: 'session', date: now - DAY, seconds: 600, activities: { tab: 600 } }]);
  await page.goto('./#/home');
  await expect(rows).toHaveCount(9);
  await expect(page.getByTestId('plan-item-fretgame')).toHaveClass(/done/);
  await expect(ear).not.toHaveClass(/done/);
  await expect(tab).not.toHaveClass(/done/);
  await expect(page.getByTestId('plan-progress')).toHaveText('1 / 9 tamamlandı');
  await seed(page, 'results', [{ id: 'e2', type: 'ear', date: now, kind: 'chord', level: 1, correct: 6, total: 10, seconds: 60, items: {} }]);
  await seed(page, 'sessions', [{ id: 's1', type: 'session', date: now, seconds: 180, activities: { tab: 180 } }]);
  await page.reload();
  await expect(ear).toHaveClass(/done/);
  await expect(tab).toHaveClass(/done/);
  await expect(ear.getByTestId('plan-check')).toBeDisabled();
  await expect(page.getByTestId('plan-progress')).toHaveText('3 / 9 tamamlandı');
  // Bugünkü sonuçlar planı değiştirmez (aynı maddeler aynı sırada).
  await expect(page.getByTestId('plan-item-fretgame')).toContainText('Notayı adlandır (0–5. perde)');
  await expectHealthyLayout(page);
  await shot(page, info, 'home-plan-done', true);
});

test('nota oyunu iyi giderse eşliğin tonunda gam; akor hedefinde şarkı yavaşlatılmış tempoyla açılır', async ({ page }) => {
  await page.goto('./');
  // Dün iki basamakta da iyi oynamış biri: oyun yerine eşliğin tonunda gam önerilir.
  const yesterday = start - DAY;
  await seed(page, 'results', [
    { id: 'g1', type: 'fretgame', date: yesterday, mode: 'name', maxFret: 5, naturalsOnly: true, correct: 10, total: 10, seconds: 40 },
    { id: 'g2', type: 'fretgame', date: yesterday + 60_000, mode: 'find', maxFret: 5, naturalsOnly: true, correct: 9, total: 10, seconds: 40 },
  ]);
  await page.reload();
  await page.getByTestId('test-skip').click();
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '45 dk' }).click();
  await expect(page.getByTestId('plan-item-fretgame')).toHaveCount(0);
  const scale = page.getByTestId('plan-item-scale');
  await expect(scale).toContainText('Gam: A minör pentatonik');
  await expect(scale).toContainText('Bugünkü eşlik A tonunda');
  await expect(page.getByTestId('plan-item-backing')).toContainText('A tonu');
  await scale.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/theory$/);
  await expect(page.getByTestId('theory-view').getByRole('radio', { name: 'Gamlar' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('theory-scale')).toHaveValue('minorPent');
  await expect(page.getByTestId('theory-root').getByRole('radio', { name: 'A', exact: true })).toHaveAttribute('aria-checked', 'true');

  // Akor hedefi (temel seviye): şarkı maddesi, şarkı %90 tempoyla açılır.
  await page.goto('./#/home/test');
  for (const a of [1, 1, 0, 1, 0, 0]) await page.getByTestId(`answer-${a}`).click();
  const song = page.getByTestId('plan-item-song');
  await expect(song).toContainText('Şarkı: Pazartesi Blues, 83 BPM');
  await song.getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/songs\/builtin%3Apazartesi-blues$/);
  await expect(page.getByTestId('song-title')).toContainText('Pazartesi Blues');
  await expect(page.getByTestId('song-bpm').locator('output')).toHaveText('83 BPM');
});

test('seviye testi yeniden yapılabilir ve plan seviyeye göre değişir', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('test-skip').click();
  await expect(page.getByTestId('plan-item-transition').first()).toContainText('Em ↔ G');

  await page.getByTestId('test-retake').click();
  // İleri düzey yanıtlar.
  for (let i = 0; i < 5; i++) await page.getByTestId('answer-2').click();
  await page.getByTestId('answer-1').click(); // hedef: solo
  await expect(page.getByTestId('plan-level')).toContainText('Seviyen: orta.');
  await expect(page.getByTestId('plan-item-transition').first()).toContainText('F ↔ C');
  await expect(page.getByTestId('plan-item-rhythm')).toContainText('90 BPM, sekizlikler');
  // Solo hedefi ve orta seviye: nota oyunu 12. perdeye kadar, kulakta aralıklar.
  await expect(page.getByTestId('plan-item-fretgame')).toContainText('(0–12. perde)');
  await expect(page.getByTestId('plan-item-ear')).toContainText('aralıklar');

  // Vazgeçilen test profili değiştirmez.
  await page.getByTestId('test-retake').click();
  await page.getByTestId('answer-0').click();
  await page.getByTestId('test-cancel').click();
  await expect(page.getByTestId('plan-level')).toContainText('Seviyen: orta.');
});
