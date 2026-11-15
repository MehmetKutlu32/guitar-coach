import { expect, test } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

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
  // 30 dakikalık plan: akort, iki geçiş, ritim, eşlik.
  const rows = page.getByTestId('plan-list').locator('.plan-row');
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId('plan-progress')).toHaveText('0 / 5 tamamlandı');
  await expect(rows.nth(0)).toContainText('Akort et');
  await expect(rows.nth(1)).toContainText('Akor geçişi: Em ↔ G');
  await expect(rows.nth(1)).toContainText('Başlangıç için iyi bir çift.');
  await expect(rows.nth(3)).toContainText('Ritim ölçümü: 80 BPM, sekizlikler');
  await expectHealthyLayout(page);
  await shot(page, info, 'home-plan', true);

  // Süre değişince plan yeniden kurulur.
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '15 dk' }).click();
  await expect(rows).toHaveCount(4);
  await page.getByTestId('plan-minutes').getByRole('radio', { name: '45 dk' }).click();
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId('plan-item-pattern')).toContainText('Vuruş kalıbı');
  await expectHealthyLayout(page);

  // Yeniden açılışta test tekrar sorulmaz, süre seçimi korunur.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(rows).toHaveCount(6);
});

test('plan maddesi ilgili aracı hazır ayarlarla açar; biten egzersiz maddeyi kendiliğinden tamamlar', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('test-skip').click();
  await expect(page.getByTestId('plan-level')).toContainText('Seviye testini atladın');
  const rows = page.getByTestId('plan-list').locator('.plan-row');
  await expect(rows).toHaveCount(5);

  // Elle işaretleme.
  const tune = page.getByTestId('plan-item-tune');
  await tune.getByTestId('plan-check').click();
  await expect(tune).toHaveClass(/done/);
  await expect(page.getByTestId('plan-progress')).toHaveText('1 / 5 tamamlandı');
  await tune.getByTestId('plan-check').click();
  await expect(page.getByTestId('plan-progress')).toHaveText('0 / 5 tamamlandı');
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
  const jam = await page.getByTestId('progression').inputValue();
  expect(['minorRock', 'blues12']).toContain(jam);

  // Geçiş maddesi: egzersiz o çiftle açılır.
  await page.goto('./#/home');
  await page.getByTestId('plan-item-transition').first().getByTestId('plan-start').click();
  await expect(page).toHaveURL(/#\/chords\/practice$/);
  await expect(page.getByTestId('chord-a')).toHaveValue('Em');
  await expect(page.getByTestId('chord-b')).toHaveValue('G');

  // Egzersizi yap ve kaydet (saat ileri sarılır).
  await page.clock.install();
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
  await expect(page.getByTestId('plan-progress')).toHaveText('2 / 5 tamamlandı');
  // Aynı çift artık "zayıf" olarak planın başında kalır (dakikada 3 < hedef 30); nedeni güncellenir.
  await expect(transition).toContainText('En zayıf geçişin: dakikada 3 (hedef 30).');
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

  // Vazgeçilen test profili değiştirmez.
  await page.getByTestId('test-retake').click();
  await page.getByTestId('answer-0').click();
  await page.getByTestId('test-cancel').click();
  await expect(page.getByTestId('plan-level')).toContainText('Seviyen: orta.');
});
