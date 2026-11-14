import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Sahte saati kurar ve durdurur: zaman yalnızca `runFor` ile ilerler (kararlı sayaç değerleri için). */
async function freezeClock(page: Page): Promise<void> {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1000);
}

test('oturum zamanlayıcı süreyi araçlara göre ayırır; seri, grafik ve geçmiş güncellenir', async ({ page }, info) => {
  await page.goto('./#/log');
  await expect(page.getByTestId('page-title')).toHaveText('Günlük');
  await expect(page.getByTestId('log-empty')).toBeVisible();
  await expect(page.getByTestId('streak-current')).toHaveText('0');
  await expect(page.getByTestId('streak-hint')).toHaveText('Bugün çalışarak seriyi başlat.');
  await expectHealthyLayout(page);
  await shot(page, info, 'log-empty', true);

  await freezeClock(page);
  await page.getByTestId('session-start').click();
  await page.clock.runFor(65_000);
  await expect(page.getByTestId('session-clock')).toHaveText('01:05');

  // Akort ekranına geç: sayaç üst çubukta görünür ve süre "Akort"a yazılır.
  await page.getByTestId('nav-tuner').click();
  await expect(page.getByTestId('page-title')).toHaveText('Akort');
  await expect(page.getByTestId('session-pill')).toHaveText('01:05');
  await page.clock.runFor(30_000);
  await expect(page.getByTestId('session-pill')).toHaveText('01:35');
  await expectHealthyLayout(page);
  await shot(page, info, 'log-pill');

  await page.getByTestId('nav-metronome').click();
  await expect(page.getByTestId('page-title')).toHaveText('Metronom');
  await page.clock.runFor(20_000);
  await page.getByTestId('session-pill').click();
  await expect(page).toHaveURL(/#\/log$/);
  await expect(page.getByTestId('session-clock')).toHaveText('01:55');
  const acts = page.getByTestId('session-activities');
  await expect(acts).toContainText('Serbest çalışma · 01:05');
  await expect(acts).toContainText('Akort · 00:30');
  await expect(acts).toContainText('Metronom ve ritim · 00:20');
  await expectHealthyLayout(page);
  await shot(page, info, 'log-running', true);

  // Duraklatınca süre işlemez.
  await page.getByTestId('session-pause').click();
  await expect(page.getByTestId('session-state')).toHaveText('Duraklatıldı');
  await page.clock.runFor(10_000);
  await expect(page.getByTestId('session-clock')).toHaveText('01:55');
  await page.getByTestId('session-resume').click();

  await page.getByTestId('session-finish').click();
  // Sayaç ölçümü bitti: saat yeniden kendiliğinden aksın.
  await page.clock.resume();
  await expect(page.getByTestId('session-message')).toHaveText('Oturum kaydedildi: 1 dk.');
  await expect(page.getByTestId('session-pill')).toHaveCount(0);
  await expect(page.getByTestId('streak-current')).toHaveText('1');
  await expect(page.getByTestId('streak-hint')).toHaveText('Bugün çalıştın, seri sürüyor.');
  await expect(page.getByTestId('today-total')).toHaveText('1 dk');
  await expect(page.getByTestId('session-row')).toHaveCount(1);
  await expect(page.getByTestId('breakdown-free')).toContainText('1 dk');
  await expect(page.getByTestId('breakdown-tuning')).toContainText('30 sn');
  await expect(page.getByTestId('breakdown-rhythm')).toContainText('20 sn');
  // Haftalık grafikte bugünün çubuğu dolu.
  const bars = page.getByTestId('log-chart').locator('.chart-bar');
  await expect(bars).toHaveCount(7);
  expect(Number(await bars.last().getAttribute('height'))).toBeGreaterThan(2);

  // Dün için elle 20 dakika akor çalışması ekle → seri 2 gün.
  await page.getByTestId('manual-add').click();
  await page.getByTestId('manual-date').fill(localDay(-1));
  await page.getByTestId('manual-activity').selectOption('chords');
  await expectHealthyLayout(page);
  await page.getByTestId('manual-save').click();
  await expect(page.getByTestId('session-row')).toHaveCount(2);
  await expect(page.getByTestId('streak-current')).toHaveText('2');
  await expect(page.getByTestId('streak-longest')).toHaveText('2');
  await expect(page.getByTestId('week-total')).toHaveText('21 dk');
  await expect(page.getByTestId('breakdown-chords')).toContainText('20 dk');
  await expect(page.getByTestId('session-row').last()).toContainText('elle eklendi');

  // Aylık görünüm: 30 gün.
  await page.getByTestId('log-range').getByRole('radio', { name: 'Ay' }).click();
  await expect(bars).toHaveCount(30);
  await expectHealthyLayout(page);
  await shot(page, info, 'log-month', true);

  // Kayıt yeniden açılışta duruyor; silinince seri güncellenir.
  await page.reload();
  await expect(page.getByTestId('streak-current')).toHaveText('2');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('session-row').last().getByTestId('session-delete').click();
  await expect(page.getByTestId('session-row')).toHaveCount(1);
  await expect(page.getByTestId('streak-current')).toHaveText('1');
});

test('çok kısa oturum kaydedilmez; yarım kalan oturum yeniden açılışta duraklatılmış olarak geri gelir', async ({ page }) => {
  await page.goto('./#/log');
  await freezeClock(page);
  await page.getByTestId('session-start').click();
  await page.clock.runFor(4_000);
  await page.getByTestId('session-finish').click();
  await expect(page.getByTestId('session-message')).toHaveText('10 saniyeden kısa oturum kaydedilmedi.');
  await expect(page.getByTestId('session-row')).toHaveCount(0);

  await page.getByTestId('session-start').click();
  await page.clock.runFor(25_000);
  await expect(page.getByTestId('session-clock')).toHaveText('00:25');
  // Yazmanın bittiğinden emin ol, sonra sayfayı yenile (uygulama kapanıp açılmış gibi).
  await page.getByTestId('session-pause').click();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('session-state')).toHaveText('Duraklatıldı');
  await expect(page.getByTestId('session-clock')).toHaveText('00:25');
  await page.getByTestId('session-resume').click();
  await page.getByTestId('session-finish').click();
  await expect(page.getByTestId('session-message')).toContainText('Oturum kaydedildi');
  await expect(page.getByTestId('session-row')).toHaveCount(1);
});
