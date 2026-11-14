import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const nowChord = (page: Page) => page.getByTestId('now-chord');

/** Çalarken "şimdi" alanında görülen akorları, değiştikçe sırayla toplar. */
async function collectChords(page: Page, count: number): Promise<string[]> {
  return page.evaluate(async (n) => {
    const el = document.querySelector('[data-testid=now-chord]')!;
    const seen: string[] = [];
    const started = performance.now();
    while (seen.length < n && performance.now() - started < 20000) {
      const text = el.textContent!.trim();
      if (!/^\d$/.test(text) && seen[seen.length - 1] !== text) seen.push(text);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen;
  }, count);
}

test('eşlik: dizi sırayla çalınır, şimdiki ve sıradaki akor gösterilir, döngü yapar', async ({ page }, info) => {
  await page.goto('./#/backing');
  await expect(page.getByTestId('page-title')).toHaveText('Eşlik');
  // Varsayılan: La tonunda 12 ölçülük blues.
  await expect(nowChord(page)).toHaveText('A7');
  await expect(page.getByTestId('next-chord')).toHaveText('D7');
  await expect(page.getByTestId('bars').locator('.bar-cell')).toHaveCount(12);
  await expect(page.getByTestId('scale-minorPent')).toContainText('A minör pentatonik');
  await expect(page.getByTestId('scale-minorPent')).toContainText('A  C  D  E  G');
  await expectHealthyLayout(page);
  await shot(page, info, 'backing-idle', true);

  // I–V–vi–IV, Do majör, hızlı tempo (ölçü = 1 sn).
  await page.getByTestId('progression').selectOption('pop1564');
  await page.getByTestId('backing-key').getByRole('radio', { name: 'C', exact: true }).click();
  await page.getByTestId('backing-style').getByRole('radio', { name: 'Rock' }).click();
  await page.getByTestId('backing-bpm-slider').fill('240');
  await expect(page.getByTestId('bars')).toHaveText(/1C2G3Am4F/);
  await expect(page.getByTestId('scale-major')).toContainText('C majör');

  await page.getByTestId('backing-toggle').click();
  // Önce bir ölçü sayar.
  await expect(page.getByTestId('backing')).toContainText('Sayıyor');
  const seen = await collectChords(page, 6);
  // Dizi sırayla çalındı ve başa döndü.
  expect(seen).toEqual(['C', 'G', 'Am', 'F', 'C', 'G']);
  await expect.poll(() => page.evaluate(() => window.__gitar!.outputRms())).toBeGreaterThan(0.01);
  await shot(page, info, 'backing-playing');

  // Çalarken: gösterilen akor ile sıradaki akor tutarlı, ölçü vurgusu doğru hücrede.
  const state = await page.evaluate(() => ({
    now: document.querySelector('[data-testid=now-chord]')!.textContent!.trim(),
    next: document.querySelector('[data-testid=next-chord]')!.textContent!.trim(),
    bar: Number(document.querySelector('[data-testid=bars]')!.getAttribute('data-current')),
  }));
  const order = ['C', 'G', 'Am', 'F'];
  expect(order[state.bar]).toBe(state.now);
  expect(order[(state.bar + 1) % 4]).toBe(state.next);

  // Ölçü başları ses saatinde tam aralıklı planlandı (240 BPM → vuruş 0,25 sn).
  const log = await page.evaluate(() => window.__gitar!.backing.transport.log.map((l) => l.time));
  expect(log.length).toBeGreaterThan(8);
  let worst = 0;
  for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs(log[i] - log[0] - i * 0.25));
  expect(worst).toBeLessThan(1e-9);

  // Çalarken ton değişimi anında yansır.
  await page.getByTestId('backing-key').getByRole('radio', { name: 'G', exact: true }).click();
  await expect(page.getByTestId('bars')).toHaveText(/1G2D3Em4C/);
  await expect.poll(async () => ['G', 'D', 'Em', 'C'].includes((await nowChord(page).textContent())!.trim())).toBe(true);

  await page.getByTestId('backing-toggle').click();
  await expect(page.getByTestId('backing-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(nowChord(page)).toHaveText('G');
});

test('döngü kapalıyken dizi bitince kendiliğinden durur', async ({ page }) => {
  await page.goto('./#/backing');
  await page.getByTestId('progression').selectOption('rock145');
  await page.getByTestId('backing-bpm-slider').fill('260');
  await page.getByTestId('backing-loop').click();
  await page.getByTestId('backing-countin').click();
  await page.getByTestId('backing-toggle').click();
  await expect(page.getByTestId('backing-toggle')).toHaveAttribute('aria-pressed', 'true');
  // 4 ölçü × 4 vuruş, 260 BPM → yaklaşık 3,7 sn.
  await expect(page.getByTestId('bar-count')).toHaveText('Ölçü 4 / 4');
  await expect(page.getByTestId('backing-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
});

test('kullanıcı kendi dizisini yazar, kaydeder, başka tona taşır ve siler', async ({ page }, info) => {
  await page.goto('./#/backing');
  await page.getByTestId('prog-new').click();
  await page.getByTestId('prog-name').fill('Nakarat');
  await page.getByTestId('prog-text').fill('Em | C | G D | Hm');
  await expect(page.getByTestId('prog-errors')).toHaveText('Tanınmayan akorlar: Hm');
  await expect(page.getByTestId('prog-save')).toBeDisabled();
  await page.getByTestId('prog-text').fill('Em | C | G D | Bm7');
  await expect(page.getByTestId('prog-errors')).toHaveCount(0);
  await expectHealthyLayout(page);
  await shot(page, info, 'backing-editor', true);
  await page.getByTestId('prog-save').click();

  await expect(page.getByTestId('progression').locator('option:checked')).toHaveText('Nakarat');
  await expect(page.getByTestId('bars')).toHaveText(/1Em2C3G\s+D4Bm7/);
  // Ton, dizinin ilk akoruna ayarlanır; minör dizide minör gamlar önerilir.
  await expect(page.getByTestId('backing-key').getByRole('radio', { name: 'E', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('scale-minorPent')).toContainText('E minör pentatonik');

  // Başka tona taşı: La minör.
  await page.getByTestId('backing-key').getByRole('radio', { name: 'A', exact: true }).click();
  await expect(page.getByTestId('bars')).toHaveText(/1Am2F3C\s+G4Em7/);

  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('progression').locator('option:checked')).toHaveText('Nakarat');
  await expect(page.getByTestId('bars')).toHaveText(/1Am2F3C\s+G4Em7/);

  await page.getByTestId('prog-edit').click();
  await page.getByTestId('prog-delete').click();
  await expect(page.getByTestId('progression')).toHaveValue('blues12');
  await expect(page.getByTestId('progression').locator('option', { hasText: 'Nakarat' })).toHaveCount(0);
});

test('her tarzda davul, bas ve akor sesi üretilir; karışım taşmaz', async ({ page }) => {
  await page.goto('./#/backing');
  await expect(page.getByTestId('backing-toggle')).toBeVisible();
  const report: string[] = [];
  for (const style of ['rock', 'blues', 'pop', 'funk'] as const) {
    const r = await page.evaluate((s) => window.__gitar!.renderBacking('pop1564', 0, s, 120), style);
    report.push(
      `${style}: tepe ${r.all.peak.toFixed(2)}, rms ${r.all.rms.toFixed(3)} ` +
        `(davul ${r.drums.rms.toFixed(3)}, bas ${r.bass.rms.toFixed(3)}, akor ${r.chords.rms.toFixed(3)})`,
    );
    console.log('[eşlik] ' + report[report.length - 1]);
    for (const part of ['all', 'drums', 'bass', 'chords'] as const) {
      expect(r[part].finite, `${style}/${part}`).toBe(true);
      expect(r[part].rms, `${style}/${part} sessiz`).toBeGreaterThan(0.004);
    }
    // Sınırlayıcıdan önceki ham karışım kırpılma sınırının altında: sınırlayıcı sürekli çalışmak zorunda kalmaz.
    expect(r.all.peak, `${style} tepe`).toBeLessThan(1);
    // Hiçbir parti diğerlerini bastırmaz.
    for (const part of ['drums', 'bass', 'chords'] as const) {
      expect(r[part].rms / r.all.rms, `${style}/${part} dengesi`).toBeGreaterThan(0.25);
    }
  }
  expect(report).toHaveLength(4);
});
