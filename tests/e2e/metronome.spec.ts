import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

interface Log {
  index: number;
  time: number;
  scheduledAt: number;
}

const readLog = (page: Page) =>
  page.evaluate(() => window.__gitar!.metronome.log.map((l) => ({ ...l })) as Log[]);

test('metronom çalışır; tıklar ses saatine göre kaymadan ve önceden planlanır', async ({ page }, info) => {
  await page.goto('./#/metronome');
  await expect(page.getByTestId('bpm')).toHaveText('90');
  await expectHealthyLayout(page);
  await shot(page, info, 'metronome-idle');

  // Hızlı ölçüm için tempoyu yükselt.
  await page.getByTestId('bpm-slider').fill('240');
  await expect(page.getByTestId('bpm')).toHaveText('240');
  await page.getByTestId('metro-toggle').click();
  await expect(page.getByTestId('metro-toggle')).toHaveAttribute('aria-pressed', 'true');

  // Vuruş göstergesi ilerliyor: dört vuruşun her biri sırayla yanar.
  for (const i of [0, 1, 2, 3]) await expect(page.getByTestId(`beat-${i}`)).toHaveClass(/now/);
  await shot(page, info, 'metronome-running');

  await expect.poll(async () => (await readLog(page)).length).toBeGreaterThan(14);
  const log = await readLog(page);
  const stepDur = 60 / 240;
  let worst = 0;
  for (let i = 1; i < log.length; i++) {
    expect(log[i].index).toBe(log[i - 1].index + 1);
    worst = Math.max(worst, Math.abs(log[i].time - log[0].time - (log[i].index - log[0].index) * stepDur));
  }
  // Planlanan zamanlar ideal ızgarada (nanosaniye altı sapma).
  expect(worst).toBeLessThan(1e-9);
  // Hiçbir tık geç planlanmadı.
  for (const l of log) expect(l.time).toBeGreaterThan(l.scheduledAt);
  console.log(`[metronom] canlı: ${log.length} tık, ızgaradan en büyük sapma ${(worst * 1e9).toFixed(4)} ns`);

  await page.getByTestId('metro-toggle').click();
  await expect(page.getByTestId('metro-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.beat-dot.now')).toHaveCount(0);
});

test('işlenen seste tıklar planlanan örneğe denk gelir', async ({ page }) => {
  await page.goto('./#/metronome');
  await expect(page.getByTestId('bpm')).toBeVisible();
  const report: string[] = [];
  for (const [bpm, sampleRate] of [
    [97, 48000],
    [173, 44100],
    [240, 48000],
  ] as const) {
    const clicks = await page.evaluate(([b, sr]) => window.__gitar!.renderClicks(b, 64, sr), [bpm, sampleRate] as const);
    expect(clicks).toHaveLength(64);
    let worst = 0;
    for (const c of clicks) worst = Math.max(worst, Math.abs(c.actual - c.expected));
    // Tık, planlanan andan en fazla 2 örnek (≈ 0,04 ms) sonra başlar.
    expect(worst).toBeLessThanOrEqual(2);
    report.push(`${bpm} BPM @ ${sampleRate} Hz: ${worst.toFixed(2)} örnek (${((worst / sampleRate) * 1000).toFixed(3)} ms)`);
  }
  console.log('[metronom] işlenmiş seste planlanan/gerçekleşen tık sapması → ' + report.join('; '));
});

test('tempo düğmeleri, tap tempo ve kalıcılık', async ({ page }) => {
  await page.goto('./#/metronome');
  await page.getByTestId('bpmplus5').click();
  await page.getByTestId('bpmplus1').click();
  await page.getByTestId('bpmminus5').click();
  await page.getByTestId('bpmminus1').click();
  await page.getByTestId('bpmplus5').click();
  await expect(page.getByTestId('bpm')).toHaveText('95');

  // Yaklaşık 120 BPM'lik dört dokunuş.
  const tap = page.getByTestId('tap');
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown');
    if (i < 3) await page.waitForTimeout(500);
  }
  const bpm = Number(await page.getByTestId('bpm').textContent());
  expect(bpm).toBeGreaterThan(105);
  expect(bpm).toBeLessThan(135);

  await page.reload();
  await expect(page.getByTestId('bpm')).toHaveText(String(bpm));
});

test('ölçü tipleri, vurgular ve alt bölme', async ({ page }, info) => {
  await page.goto('./#/metronome');
  await expect(page.getByTestId('beats').getByRole('button')).toHaveCount(4);
  await expect(page.getByTestId('beat-0')).toHaveAttribute('data-level', '2');

  await page.getByTestId('meter').getByRole('radio', { name: '7/8' }).click();
  await expect(page.getByTestId('beats').getByRole('button')).toHaveCount(7);
  await expectHealthyLayout(page);
  await shot(page, info, 'metronome-7-8');

  await page.getByTestId('meter').getByRole('radio', { name: '3/4' }).click();
  await expect(page.getByTestId('beats').getByRole('button')).toHaveCount(3);

  // Vuruşa dokununca: normal → vurgulu → sessiz → normal.
  const second = page.getByTestId('beat-1');
  await expect(second).toHaveAttribute('data-level', '1');
  await second.click();
  await expect(second).toHaveAttribute('data-level', '2');
  await second.click();
  await expect(second).toHaveAttribute('data-level', '0');
  await expect(second).toHaveAccessibleName('2. vuruş: sessiz');

  // Çalarken alt bölme değişince motor yeni ızgaraya geçer (vuruş başına 3 adım).
  await page.getByTestId('bpm-slider').fill('200');
  await page.getByTestId('metro-toggle').click();
  await page.getByTestId('subdivision').getByRole('radio', { name: 'Üçleme' }).click();
  await expect
    .poll(async () => {
      const log = await page.evaluate(() => window.__gitar!.metronome.log.slice(-2).map((l) => l.time));
      return log.length === 2 ? log[1] - log[0] : 0;
    })
    .toBeCloseTo(60 / 200 / 3, 6);
  await page.getByTestId('metro-toggle').click();
});

test('tempo antrenörü belirlenen ölçülerde hızlanır ve hedefte durur', async ({ page }, info) => {
  await page.goto('./#/metronome');
  await page.getByTestId('meter').getByRole('radio', { name: '2/4' }).click();
  await page.getByTestId('bpm-slider').fill('230');
  await page.getByTestId('trainer-on').click();
  // Her 1 ölçüde +5 BPM, hedef 240.
  const every = page.getByTestId('trainer-every');
  for (let i = 0; i < 3; i++) await every.getByRole('button', { name: '−' }).click();
  await expect(every.locator('output')).toHaveText('1 ölçü');
  await expect(page.getByTestId('trainer-max').locator('output')).toHaveText('235 BPM');
  await page.getByTestId('trainer-max').getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('trainer-max').locator('output')).toHaveText('240 BPM');
  await expectHealthyLayout(page);
  await shot(page, info, 'metronome-trainer', true);

  await page.getByTestId('metro-toggle').click();
  await expect(page.getByTestId('bpm')).toHaveText('235');
  await expect(page.getByTestId('bpm')).toHaveText('240');
  // Hedefte kalır.
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('bpm')).toHaveText('240');
  await page.getByTestId('metro-toggle').click();
  // Durunca başlangıç temposu korunur.
  await expect(page.getByTestId('bpm')).toHaveText('230');
});

test('vuruş kalıbı metronomla senkron gösterilir; kullanıcı kendi kalıbını oluşturur', async ({ page }, info) => {
  await page.goto('./#/metronome');
  await page.getByTestId('pattern-select').selectOption('folk');
  const view = page.getByTestId('pattern-view');
  await expect(view.locator('.pattern-cell')).toHaveCount(8);
  await expectHealthyLayout(page);

  // Çalarken etkin hücre ilerler ve vuruşla aynı hizadadır.
  await page.getByTestId('bpm-slider').fill('150');
  await page.getByTestId('metro-toggle').click();
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const cur = await view.getAttribute('data-current');
      if (cur && cur !== '-1') seen.add(cur);
      return seen.size;
    }, { intervals: [20] })
    .toBe(8);
  const aligned = await page.evaluate(async () => {
    // 3. hücre (ikinci vuruşun başı) yanarken 2. vuruş noktası da yanıyor olmalı.
    for (let i = 0; i < 400; i++) {
      const cur = document.querySelector('[data-testid=pattern-view]')!.getAttribute('data-current');
      if (cur === '2') return document.querySelector('[data-testid=beat-1]')!.classList.contains('now');
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  });
  expect(aligned).toBe(true);
  await shot(page, info, 'metronome-pattern', true);
  await page.getByTestId('metro-toggle').click();

  // Yeni kalıp oluştur: 1/16 ızgara, birkaç hücreyi değiştir.
  await page.getByTestId('pattern-new').click();
  await expect(page.getByTestId('pattern-editor')).toBeVisible();
  await page.getByTestId('pattern-name').fill('Benim ritmim');
  await page.getByTestId('pattern-division').getByRole('radio', { name: '1/16' }).click();
  await expect(page.getByTestId('pattern-editor').locator('.editor-cell')).toHaveCount(16);
  await page.getByTestId('slot-2').click(); // boş → aşağı
  await page.getByTestId('slot-3').click();
  await page.getByTestId('slot-3').click(); // boş → aşağı → yukarı
  await expect(page.getByTestId('slot-3')).toHaveAttribute('data-stroke', 'U');
  await expect(page.getByTestId('slot-3')).toHaveAccessibleName('a: yukarı');
  await expectHealthyLayout(page);
  await shot(page, info, 'metronome-editor', true);
  await page.getByTestId('pattern-save').click();

  await expect(page.getByTestId('pattern-select').locator('option:checked')).toHaveText('Benim ritmim');
  await expect(view.locator('.pattern-cell')).toHaveCount(16);

  // Yeniden açılışta kalıp ve seçim duruyor.
  await page.reload();
  await expect(page.getByTestId('pattern-select').locator('option:checked')).toHaveText('Benim ritmim');
  await expect(page.getByTestId('pattern-view').locator('.pattern-cell.s-U')).toHaveCount(1);

  // Sil.
  await page.getByTestId('pattern-edit').click();
  await page.getByTestId('pattern-delete').click();
  await expect(page.getByTestId('pattern-select')).toHaveValue('');
  await expect(page.getByTestId('pattern-select').locator('option', { hasText: 'Benim ritmim' })).toHaveCount(0);
});
