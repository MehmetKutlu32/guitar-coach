import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const outputRms = (page: Page) => page.evaluate(() => window.__gitar!.outputRms());

test('akor kütüphanesi: açık, bare ve power akorlar; diyagrama dokununca ses çıkar', async ({ page }, info) => {
  await page.goto('./#/chords');
  await expect(page.getByTestId('page-title')).toHaveText('Akorlar');
  const cards = page.getByTestId('chord-grid').locator('.chord-card');
  await expect(cards).toHaveCount(29);
  await expectHealthyLayout(page);
  await shot(page, info, 'chords-open');

  // Diyagrama dokun: akor sentez gitar sesiyle çalınır.
  expect(await outputRms(page)).toBe(0);
  await page.getByRole('button', { name: 'Am akorunu çal' }).click();
  await expect(page.getByTestId('chord-open:Am')).toHaveClass(/played/);
  await expect.poll(() => outputRms(page)).toBeGreaterThan(0.01);
  // Am diyagramı: 5 tel çalınır (bir ✕), iki açık tel, üç parmak.
  const am = page.getByTestId('chord-open:Am');
  await expect(am.locator('.cd-mute')).toHaveCount(1);
  await expect(am.locator('.cd-open')).toHaveCount(2);
  await expect(am.locator('.cd-dot')).toHaveCount(3);

  await page.getByTestId('chord-open:Am').getByRole('button', { name: 'Tek tek' }).click();

  // Bare akorlar: kök seçimi.
  await page.getByTestId('chord-category').getByRole('radio', { name: 'Bare' }).click();
  await page.getByTestId('chord-root').getByRole('radio', { name: 'F#' }).click();
  await expect(page.getByTestId('chord-barre6:F#m')).toBeVisible();
  await expect(page.getByTestId('chord-barre6:F#m')).toContainText('Kök 6. telde · 2. perde');
  await expect(page.getByTestId('chord-barre6:F#m').locator('.cd-barre')).toHaveCount(1);
  await expect(page.getByTestId('chord-barre5:F#m')).toContainText('Kök 5. telde · 9. perde');
  await expect(cards).toHaveCount(9);
  await expectHealthyLayout(page);
  await shot(page, info, 'chords-barre');

  // Power akorlar.
  await page.getByTestId('chord-category').getByRole('radio', { name: 'Power' }).click();
  await page.getByTestId('chord-root').getByRole('radio', { name: 'E', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('chord-power6:E5')).toContainText('Kök 6. telde · açık');
  await expectHealthyLayout(page);
  await shot(page, info, 'chords-power');

  // Seçim kalıcı.
  await page.reload();
  await expect(page.getByTestId('chord-category').getByRole('radio', { name: 'Power' })).toHaveAttribute('aria-checked', 'true');
});

test('geçiş egzersizi: geri sayım, süre, sonuç kaydı, geçmiş ve grafik', async ({ page }, info) => {
  await page.goto('./#/chords');
  await page.getByTestId('chords-view').getByRole('radio', { name: 'Geçiş egzersizi' }).click();
  await expect(page).toHaveURL(/#\/chords\/practice$/);
  await expect(page.getByTestId('tx-empty')).toBeVisible();

  await page.getByTestId('quick-pairs').getByRole('button', { name: 'Am ↔ C' }).click();
  await expect(page.getByTestId('chord-a')).toHaveValue('Am');
  await expect(page.getByTestId('chord-b')).toHaveValue('C');
  await expect(page.getByTestId('tx-history')).toContainText('Geçmiş: Am ↔ C');
  await expectHealthyLayout(page);
  await shot(page, info, 'transition-idle', true);

  // Aynı akor iki kez seçilirse başlatılamaz.
  await page.getByTestId('chord-b').selectOption('Am');
  await expect(page.getByTestId('tx-start')).toBeDisabled();
  await page.getByTestId('chord-b').selectOption('C');

  // 1. egzersiz: 60 sn (saat ileri sarılır).
  await page.clock.install();
  await page.getByTestId('tx-start').click();
  await expect(page.getByTestId('tx-run')).toHaveAttribute('data-phase', 'countin');
  await expect(page.getByTestId('tx-plus')).toBeDisabled();
  await page.clock.fastForward(3200);
  await expect(page.getByTestId('tx-run')).toHaveAttribute('data-phase', 'running');
  await expect(page.getByTestId('tx-clock')).toHaveText('60');
  for (let i = 0; i < 5; i++) await page.getByTestId('tx-plus').click();
  await expect(page.getByTestId('tx-plus')).toContainText('5');
  await expectHealthyLayout(page);
  await shot(page, info, 'transition-running');
  await page.clock.fastForward(30_000);
  await expect(page.getByTestId('tx-clock')).toHaveText('30');
  await page.clock.fastForward(30_500);
  await expect(page.getByTestId('tx-done')).toBeVisible();
  // Sayıyı sonradan düzelt: 5 → 6.
  await page.getByTestId('tx-count').getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('tx-count').locator('output')).toHaveText('6');
  await expectHealthyLayout(page);
  await shot(page, info, 'transition-done');
  await page.getByTestId('tx-save').click();
  await expect(page.getByTestId('tx-saved')).toHaveText('Kaydedildi: dakikada 6 geçiş.');
  await expect(page.getByTestId('tx-best')).toHaveText('6');
  await expect(page.getByTestId('tx-sessions')).toHaveText('1');
  await expect(page.getByTestId('tx-chart').locator('.chart-dot')).toHaveCount(1);

  // 2. egzersiz: 30 sn'de 4 geçiş → dakikada 8, yeni rekor.
  await page.getByTestId('tx-duration').getByRole('radio', { name: '30 sn' }).click();
  await page.getByTestId('tx-start').click();
  await page.clock.fastForward(3200);
  await expect(page.getByTestId('tx-clock')).toHaveText('30');
  for (let i = 0; i < 4; i++) await page.getByTestId('tx-plus').click();
  await page.clock.fastForward(30_500);
  await page.getByTestId('tx-save').click();
  await expect(page.getByTestId('tx-saved')).toHaveText('Kaydedildi: dakikada 8 geçiş. Yeni rekor!');
  await expect(page.getByTestId('tx-best')).toHaveText('8');
  await expect(page.getByTestId('tx-sessions')).toHaveText('2');
  await expect(page.getByTestId('tx-chart').locator('.chart-dot')).toHaveCount(2);
  await expect(page.getByTestId('tx-chart').locator('.chart-line')).toHaveCount(1);

  // Vazgeçilen egzersiz kaydedilmez.
  await page.getByTestId('tx-start').click();
  await page.clock.fastForward(4000);
  await page.getByTestId('tx-cancel').click();
  await expect(page.getByTestId('tx-sessions')).toHaveText('2');

  await expectHealthyLayout(page);
  await shot(page, info, 'transition-history', true);

  // Çift listesi ve kalıcılık.
  await page.getByTestId('quick-pairs').getByRole('button', { name: 'Em ↔ G' }).click();
  await expect(page.getByTestId('tx-empty')).toBeVisible();
  await page.getByTestId('pair-Am|C').click();
  await expect(page.getByTestId('tx-best')).toHaveText('8');
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('tx-best')).toHaveText('8');
  await expect(page.getByTestId('pair-Am|C')).toContainText('en iyi 8/dk · 2 egzersiz');
});
