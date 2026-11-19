import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const cell = (page: Page, step: number, string: number) =>
  page.locator(`[data-testid=tab-grid] .tab-cell[data-step="${step}"][data-string="${string}"]`);

/** Çalarken görülen adımları (değiştikçe) toplar; çalma bitince ya da süre dolunca döner. */
async function collectSteps(page: Page, maxMs: number): Promise<number[]> {
  return page.evaluate(async (limit) => {
    const grid = document.querySelector('[data-testid=tab-grid]')!;
    const toggle = document.querySelector('[data-testid=tab-toggle]')!;
    const out: number[] = [];
    const started = performance.now();
    while (performance.now() - started < limit) {
      const s = Number(grid.getAttribute('data-playing'));
      if (s >= 0 && out[out.length - 1] !== s) out.push(s);
      if (out.length > 0 && toggle.getAttribute('aria-pressed') === 'false') break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  }, maxMs);
}

async function setBpm(page: Page, target: number): Promise<void> {
  const out = page.getByTestId('tab-bpm').locator('output');
  const current = parseInt((await out.textContent())!, 10);
  const button = page.getByTestId('tab-bpm').getByRole('button', { name: target > current ? '+' : '−' });
  for (let i = 0; i < Math.abs(target - current) / 5; i++) await button.click();
  await expect(out).toHaveText(`${target} BPM`);
}

test('riff kütüphanesi ve oynatıcı: tab baştan sona çalınır, ses çıkar, sonunda durur', async ({ page }, info) => {
  await page.goto('./#/tabs');
  await expect(page.getByTestId('page-title')).toHaveText('Tab');
  await expect(page.getByTestId('tab-row')).toHaveCount(5);
  await expectHealthyLayout(page);
  await shot(page, info, 'tabs-list');

  await page.getByTestId('tab-row').filter({ hasText: 'Power akor ritmi' }).click();
  await expect(page.getByTestId('tab-title')).toHaveText('Power akor ritmi (E5 – G5)');
  await expect(page.getByTestId('tab-grid').locator('.tab-bar')).toHaveCount(2);
  // İlk vuruş: E5 → 6. tel açık, 5. ve 4. tel 2. perde.
  await expect(cell(page, 0, 0)).toHaveText('0');
  await expect(cell(page, 0, 1)).toHaveText('2');
  await expect(cell(page, 0, 2)).toHaveText('2');
  await expect(cell(page, 4, 0)).toHaveText('x');
  await expectHealthyLayout(page);
  await shot(page, info, 'tab-view', true);

  // Hızlı deneme: 200 BPM (hazır tabda tempo değişikliği geçicidir).
  await setBpm(page, 200);
  await page.getByTestId('tab-toggle').click();
  await expect(page.getByTestId('tab-counting')).toBeVisible();
  const steps = await collectSteps(page, 12000);
  expect(steps[0]).toBe(0);
  expect(steps[steps.length - 1]).toBe(31);
  for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  expect(steps.length).toBeGreaterThanOrEqual(24);
  await expect(page.getByTestId('tab-toggle')).toHaveAttribute('aria-pressed', 'false');

  // Adımlar ses saatinde tam aralıklı planlandı: 200 BPM on altılık = 75 ms.
  const log = await page.evaluate(() => window.__gitar!.tabPlayer.transport.log.map((l) => l.time));
  expect(log.length).toBeGreaterThanOrEqual(32);
  let worst = 0;
  for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs(log[i] - log[0] - i * 0.075));
  expect(worst).toBeLessThan(1e-9);
});

test('yavaşlatma ve bölüm döngüsü', async ({ page }, info) => {
  await page.goto('./#/tabs/builtin%3Aboogie');
  // Egzersizin temposu 96; 5'er artışla 201 BPM → on altılık adım ≈ 74,6 ms.
  await setBpm(page, 201);
  const STEP = 60 / 201 / 4;
  await page.getByTestId('tab-countin').click();

  // Yarı hız: adım aralığı iki katına çıkar.
  await page.getByTestId('tab-speed').getByRole('radio', { name: '%50' }).click();
  await page.getByTestId('tab-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__gitar!.tabPlayer.transport.log.length)).toBeGreaterThan(6);
  const slow = await page.evaluate(() => window.__gitar!.tabPlayer.transport.log.slice(0, 6).map((l) => l.time));
  for (let i = 1; i < slow.length; i++) expect(slow[i] - slow[i - 1]).toBeCloseTo(STEP * 2, 6);
  await expect.poll(() => page.evaluate(() => window.__gitar!.outputRms())).toBeGreaterThan(0.005);
  // Çalarken tam hıza dön: aralık yarıya iner.
  await page.getByTestId('tab-speed').getByRole('radio', { name: '%100' }).click();
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => window.__gitar!.tabPlayer.transport.log.slice(-2).map((l) => l.time));
      return t[1] - t[0];
    })
    .toBeCloseTo(STEP, 6);
  await page.getByTestId('tab-toggle').click();
  await expect(page.getByTestId('tab-toggle')).toHaveAttribute('aria-pressed', 'false');

  // 2.–3. ölçüleri döngüye al.
  await page.getByTestId('range-from').getByRole('button', { name: '+' }).click();
  await page.getByTestId('range-to').getByRole('button', { name: '−' }).click();
  await expect(page.getByTestId('range-from').locator('output')).toHaveText('2. ölçüden');
  await expect(page.getByTestId('range-to').locator('output')).toHaveText('3. ölçüye');
  await page.getByTestId('tab-loop').click();
  // Bölüm dışındaki ölçüler soluk gösterilir.
  await expect(page.getByTestId('tab-grid').locator('.tab-bar.out')).toHaveCount(2);
  await expectHealthyLayout(page);
  await shot(page, info, 'tab-loop', true);

  await page.getByTestId('tab-toggle').click();
  // Yaklaşık 2,4 sn'lik bölüm (32 adım) iki kereden fazla döner; adımlar hep 16–47 arasında kalır.
  const seen = await collectSteps(page, 6000);
  expect(Math.min(...seen)).toBe(16);
  expect(Math.max(...seen)).toBe(47);
  const wraps = seen.filter((s, i) => i > 0 && s < seen[i - 1]).length;
  expect(wraps).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('tab-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tab-toggle').click();
});

test('tab yazma: tuş takımıyla nota girme, kaydetme, düzenleme, silme', async ({ page }, info) => {
  await page.goto('./#/tabs');
  await page.getByTestId('tab-new').click();
  await expect(page.getByTestId('tab-editor')).toBeVisible();
  await page.getByTestId('tab-name').fill('İlk riffim');
  await expect(page.getByTestId('cursor-info')).toHaveText('İmleç: 1. ölçü, 1. adım, 6. tel');

  // 6. telde 0, 3, 5; "yazınca ilerle" açık olduğundan imleç her seferinde bir adım ilerler.
  await page.getByTestId('key-0').click();
  await page.getByTestId('key-3').click();
  await page.getByTestId('key-5').click();
  await expect(cell(page, 0, 0)).toHaveText('0');
  await expect(cell(page, 1, 0)).toHaveText('3');
  await expect(cell(page, 2, 0)).toHaveText('5');
  await expect(page.getByTestId('cursor-info')).toHaveText('İmleç: 1. ölçü, 4. adım, 6. tel');

  // 12. perde: 2 yaz, +10'a bas.
  await page.getByTestId('key-2').click();
  await page.getByTestId('key-plus10').click();
  await expect(cell(page, 3, 0)).toHaveText('12');

  // Bir ince tele geç, susturulmuş nota yaz.
  await page.getByTestId('key-up').click();
  await page.getByTestId('key-x').click();
  await expect(cell(page, 4, 1)).toHaveText('x');
  // Geri gidip sil.
  await page.getByTestId('key-left').click();
  await page.getByTestId('key-clear').click();
  await expect(cell(page, 4, 1)).toHaveText('');

  // Hücreye dokunarak imleci taşı.
  await cell(page, 8, 3).click();
  await expect(page.getByTestId('cursor-info')).toHaveText('İmleç: 1. ölçü, 9. adım, 3. tel');
  await page.getByTestId('key-7').click();
  await expect(cell(page, 8, 3)).toHaveText('7');

  // Ölçü ekle / sil.
  await page.getByTestId('bar-add').click();
  await expect(page.getByTestId('tab-grid').locator('.tab-bar')).toHaveCount(3);
  await page.getByTestId('bar-remove').click();
  await expect(page.getByTestId('tab-grid').locator('.tab-bar')).toHaveCount(2);
  await expectHealthyLayout(page);
  await shot(page, info, 'tab-editor', true);

  await page.getByTestId('tab-save').click();
  await expect(page.getByTestId('tab-title')).toHaveText('İlk riffim');
  await expect(page).toHaveURL(/#\/tabs\/[0-9a-f-]{8,}$/);

  // Yeniden açılışta notalar duruyor.
  await page.reload();
  await expect(page.getByTestId('tab-title')).toHaveText('İlk riffim');
  await expect(cell(page, 3, 0)).toHaveText('12');
  await expect(cell(page, 8, 3)).toHaveText('7');

  // Listede görünür; düzenlenip silinebilir.
  await page.getByTestId('tab-back').click();
  await expect(page.getByTestId('tab-row')).toHaveCount(6);
  await expect(page.getByTestId('tab-row').filter({ hasText: 'İlk riffim' })).toContainText('2 ölçü · 90 BPM · 5 nota');
  await page.getByTestId('tab-row').filter({ hasText: 'İlk riffim' }).click();
  await page.getByTestId('tab-edit').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('tab-delete').click();
  await expect(page.getByTestId('tab-row')).toHaveCount(5);
});

test('masaüstü klavyesiyle yazma ve hazır egzersizi kopyalama', async ({ page }) => {
  await page.goto('./#/tabs/new');
  await expect(page.getByTestId('tab-editor')).toBeVisible();
  await page.keyboard.press('5');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('7');
  await page.keyboard.press('x');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await expect(cell(page, 0, 0)).toHaveText('5');
  await expect(cell(page, 1, 1)).toHaveText('7');
  await expect(cell(page, 2, 1)).toHaveText('');
  // Ad alanına yazarken rakamlar tabı değiştirmez.
  await page.getByTestId('tab-name').fill('Riff 99');
  await expect(cell(page, 0, 0)).toHaveText('5');
  await expect(page.getByTestId('tab-grid').locator('.tab-cell.note')).toHaveCount(2);

  // Hazır egzersiz düzenlenemez; kopyası düzenlenir.
  await page.goto('./#/tabs/builtin%3Akromatik');
  await expect(page.getByTestId('tab-edit')).toHaveCount(0);
  await page.getByTestId('tab-copy').click();
  await expect(page.getByTestId('tab-title')).toHaveText('Kromatik ısınma (1-2-3-4) (kopya)');
  await expect(page.getByTestId('tab-edit')).toBeVisible();
  await page.getByTestId('tab-back').click();
  await expect(page.getByTestId('tab-row')).toHaveCount(6);
});

test('yavaş cihazda editör görünür görünmez basılan tuş kaybolmaz', async ({ page, browserName }, info) => {
  // Gerileme testi: klavye dinleyicisi çizimden sonra bağlandığında yavaş CPU'da ilk tuş kayboluyordu (CI'da görüldü).
  test.skip(browserName !== 'chromium' || info.project.name !== 'desktop', 'CPU yavaşlatma yalnızca Chromium masaüstünde');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  await page.goto('./#/tabs/new');
  await expect(page.getByTestId('tab-editor')).toBeVisible();
  await page.keyboard.press('5');
  await expect(cell(page, 0, 0)).toHaveText('5', { timeout: 3000 });
});
