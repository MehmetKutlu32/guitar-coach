import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const dotsOnString = (page: Page, string: number) =>
  page
    .getByTestId('neck')
    .locator(`.neck-dot[data-string="${string}"]`)
    .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-fret'))).sort((a, b) => a - b));

test('gamlar ve modlar sapta gösterilir; nota adı / derece, pencere ve çalma', async ({ page }, info) => {
  await page.goto('./#/theory');
  await expect(page.getByTestId('page-title')).toHaveText('Sap ve teori');
  // Varsayılan: La minör pentatonik.
  await expect(page.getByTestId('theory-info')).toContainText('A minör pentatonik');
  await expect(page.getByTestId('scale-notes')).toHaveText('A1Cb3D4E5Gb7');
  expect(await dotsOnString(page, 0)).toEqual([0, 3, 5, 8, 10, 12]);
  // Kök notalar vurgulu: 6. telde 5. perde.
  await expect(page.getByTestId('neck').locator('.neck-dot.root[data-string="0"][data-fret="5"]')).toHaveCount(1);
  await expect(page.getByTestId('neck').locator('.neck-dot[data-string="0"][data-fret="5"] text')).toHaveText('A');
  await expectHealthyLayout(page);
  await shot(page, info, 'theory-scale', true);

  // Derece gösterimi.
  await page.getByTestId('theory-labels').getByRole('radio', { name: 'Derece' }).click();
  await expect(page.getByTestId('neck').locator('.neck-dot[data-string="0"][data-fret="5"] text')).toHaveText('1');
  await expect(page.getByTestId('neck').locator('.neck-dot[data-string="0"][data-fret="8"] text')).toHaveText('b3');

  // Mod: Re Dorian → Do majörün 2. derecesi.
  await page.getByTestId('theory-root').getByRole('radio', { name: 'D', exact: true }).click();
  await page.getByTestId('theory-scale').selectOption('dorian');
  await expect(page.getByTestId('scale-notes')).toHaveText('D1E2Fb3G4A5B6Cb7');
  await expect(page.getByTestId('scale-formula')).toHaveText('Aralıklar: tam – yarım – tam – tam – tam – yarım – tam');
  await expect(page.getByTestId('scale-parent')).toContainText('D dorian, C majör gamının 2. derecesinden başlar');

  // Sapın üst bölümü: 13–24. perdeler.
  await page.getByTestId('theory-window').getByRole('radio', { name: '13–24' }).click();
  await expect(page.getByTestId('neck')).toHaveAttribute('data-start', '12');
  const high = await dotsOnString(page, 0);
  expect(Math.min(...high)).toBeGreaterThanOrEqual(13);
  expect(Math.max(...high)).toBeLessThanOrEqual(24);
  await expectHealthyLayout(page);

  // Gamı çal: ses çıkar. Sapta noktaya dokununca da nota çalınır.
  await page.getByTestId('theory-play').click();
  await expect.poll(() => page.evaluate(() => window.__gitar!.outputRms())).toBeGreaterThan(0.01);

  // Seçimler kalıcı.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('theory-scale')).toHaveValue('dorian');
  await expect(page.getByTestId('neck')).toHaveAttribute('data-start', '12');
});

test('arpejler ve CAGED biçimleri', async ({ page }, info) => {
  await page.goto('./#/theory');
  await page.getByTestId('theory-view').getByRole('radio', { name: 'Arpejler' }).click();
  await page.getByTestId('theory-root').getByRole('radio', { name: 'C', exact: true }).click();
  await page.getByTestId('theory-quality').selectOption('maj7');
  await expect(page.getByTestId('arpeggio-notes')).toHaveText('C1E3G5B7');
  // 5. tel: C (3), E (7), G (10), B (2).
  expect(await dotsOnString(page, 1)).toEqual([2, 3, 7, 10]);
  // Sapta bir noktaya dokununca o nota çalınır.
  await page.getByTestId('neck').locator('.neck-dot[data-string="1"][data-fret="3"]').click();
  await expect.poll(() => page.evaluate(() => window.__gitar!.outputRms())).toBeGreaterThan(0.01);
  await expectHealthyLayout(page);
  await shot(page, info, 'theory-arpeggio', true);

  await page.getByTestId('theory-view').getByRole('radio', { name: 'CAGED' }).click();
  // Do majör, E biçimi: 8. perdede bare.
  await page.getByTestId('caged-shape').getByRole('radio', { name: 'E', exact: true }).click();
  await expect(page.getByTestId('caged-info')).toHaveText('C majör akoru, E biçimiyle 8.–10. perdeler arasında basılır.');
  const chordTones = page.getByTestId('neck').locator('.neck-dot:not(.faded)');
  await expect(chordTones).toHaveCount(6);
  await expect(page.getByTestId('neck').locator('.neck-dot.root')).toHaveCount(3);
  // Çevredeki majör gam notaları soluk gösterilir.
  expect(await page.getByTestId('neck').locator('.neck-dot.faded').count()).toBeGreaterThan(6);
  await expectHealthyLayout(page);
  await shot(page, info, 'theory-caged', true);

  // C biçimi açık konumdadır.
  await page.getByTestId('caged-shape').getByRole('radio', { name: 'C', exact: true }).click();
  await expect(page.getByTestId('caged-info')).toContainText('0.–3. perdeler');
  await expect(chordTones).toHaveCount(5);
  // D biçimi sapın yukarısında: pencere kendiliğinden kayar.
  await page.getByTestId('caged-shape').getByRole('radio', { name: 'D', exact: true }).click();
  await expect(page.getByTestId('caged-info')).toContainText('10.–13. perdeler');
  await expect(page.getByTestId('neck')).toHaveAttribute('data-start', '5');
  await expect(chordTones).toHaveCount(4);
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OPEN = [40, 45, 50, 55, 59, 64];

/** Geri bildirim bitip yeni soru gelene (ya da tur bitene) kadar bekler. */
async function waitNext(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      if ((await page.getByTestId('game-progress').count()) === 0) return 'done';
      return (await page.getByTestId('game-progress').getAttribute('data-feedback')) ?? '';
    })
    .not.toBe('ok');
  await expect
    .poll(async () => {
      if ((await page.getByTestId('game-progress').count()) === 0) return '';
      return (await page.getByTestId('game-progress').getAttribute('data-feedback')) ?? '';
    })
    .toBe('');
}

test('nota ezberleme oyunu: notayı adlandır', async ({ page }, info) => {
  await page.goto('./#/theory');
  await page.getByTestId('theory-view').getByRole('radio', { name: 'Oyun' }).click();
  await expect(page.getByTestId('game-empty')).toBeVisible();
  await expectHealthyLayout(page);
  await page.getByTestId('game-start').click();
  await expect(page.getByTestId('game-progress')).toContainText('Soru 1 / 10');
  // Doğal notalar: 7 seçenek. Sapta tek bir soru işareti.
  await expect(page.getByTestId('answers').getByRole('button')).toHaveCount(7);
  await expect(page.getByTestId('neck').locator('.neck-dot.target')).toHaveCount(1);
  await expectHealthyLayout(page);
  await shot(page, info, 'game-name');

  // 10 soru: 8'ini doğru, 2'sini bilerek yanlış yanıtla.
  for (let i = 0; i < 10; i++) {
    const progress = page.getByTestId('game-progress');
    await expect(progress).toContainText(`Soru ${i + 1} / 10`);
    const string = Number(await progress.getAttribute('data-string'));
    const fret = Number(await progress.getAttribute('data-fret'));
    const pc = Number(await progress.getAttribute('data-pc'));
    // Uygulamanın bildirdiği nota, sap konumuyla tutarlı.
    expect((OPEN[string] + fret) % 12).toBe(pc);
    // Soru ayarlara uyuyor: 0–5. perde, doğal nota.
    expect(fret).toBeLessThanOrEqual(5);
    expect([0, 2, 4, 5, 7, 9, 11]).toContain(pc);
    const wrong = i === 3 || i === 7;
    const answer = wrong ? [0, 2, 4, 5, 7, 9, 11].find((x) => x !== pc)! : pc;
    await page.getByTestId(`answer-pc-${answer}`).click();
    await expect(page.getByTestId('game-feedback')).toHaveText(wrong ? new RegExp(`Yanlış — doğrusu ${NAMES[pc]}`) : 'Doğru!');
    if (i === 3) await shot(page, info, 'game-wrong');
    await waitNext(page);
  }

  await expect(page.getByTestId('game-summary')).toContainText('10 sorudan 8 doğru');
  await expect(page.getByTestId('game-summary')).toContainText('Kaçırdıkların:');
  await expect(page.getByTestId('game-best')).toHaveText('80');
  await expect(page.getByTestId('game-rounds')).toHaveText('1');
  await expectHealthyLayout(page);
  await shot(page, info, 'game-summary', true);

  // Sonuç kalıcı; başka ayarın geçmişi ayrıdır.
  await page.reload();
  await expect(page.getByTestId('game-best')).toHaveText('80');
  await page.getByTestId('game-range').getByRole('radio', { name: '0–12. perde' }).click();
  await expect(page.getByTestId('game-empty')).toBeVisible();
});

test('nota ezberleme oyunu: perdeyi bul', async ({ page }) => {
  await page.goto('./#/theory');
  await page.getByTestId('theory-view').getByRole('radio', { name: 'Oyun' }).click();
  await page.getByTestId('game-mode').getByRole('radio', { name: 'Perdeyi bul' }).click();
  await page.getByTestId('game-naturals').click();
  await page.getByTestId('game-start').click();
  // Sapta yanıt görünmez; 1–5. perde düğmeleri.
  await expect(page.getByTestId('neck').locator('.neck-dot')).toHaveCount(0);
  await expect(page.getByTestId('answers').getByRole('button')).toHaveCount(5);

  for (let i = 0; i < 10; i++) {
    const progress = page.getByTestId('game-progress');
    await expect(progress).toContainText(`Soru ${i + 1} / 10`);
    const string = Number(await progress.getAttribute('data-string'));
    const fret = Number(await progress.getAttribute('data-fret'));
    const pc = Number(await progress.getAttribute('data-pc'));
    await expect(page.getByTestId('game-prompt')).toContainText(`${6 - string}. telde`);
    await expect(page.getByTestId('game-prompt')).toContainText(NAMES[pc]);
    expect(fret).toBeGreaterThanOrEqual(1);
    await page.getByTestId(`answer-fret-${fret}`).click();
    await expect(page.getByTestId('game-feedback')).toHaveText('Doğru!');
    // Yanıttan sonra doğru konum sapta gösterilir.
    await expect(page.getByTestId('neck').locator('.neck-dot.good')).toHaveCount(1);
    await waitNext(page);
  }
  await expect(page.getByTestId('game-summary')).toContainText('10 sorudan 10 doğru');
  await expect(page.getByTestId('game-best')).toHaveText('100');
});
