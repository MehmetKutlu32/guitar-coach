import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

/**
 * Giriş olarak sayfa içinde bir veri yolu kurar; testler bu yola bilinen anlarda "vuruş" sesleri planlar.
 * @param delaySeconds Girişe eklenen yapay gecikme (ses kartı/hoparlör gecikmesini taklit eder).
 */
async function useHitBus(page: Page, delaySeconds: number): Promise<void> {
  await page.addInitScript((delay) => {
    const w = window as unknown as {
      __gitarTestInput: (ctx: AudioContext) => AudioNode;
      __hit: (time: number) => void;
    };
    w.__gitarTestInput = (ctx) => {
      const bus = ctx.createGain();
      const out = ctx.createDelay(1);
      out.delayTime.value = delay;
      bus.connect(out);
      // Kısa, sönümlü gürültü patlaması: pena vuruşuna benzer geniş bantlı bir atak.
      const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.08), ctx.sampleRate);
      const data = buf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] = ((seed / 2147483647) * 2 - 1) * 0.6 * Math.exp(-i / (ctx.sampleRate * 0.015));
      }
      w.__hit = (time) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(bus);
        src.start(time);
      };
      return out;
    };
  }, delaySeconds);
}

async function setLatency(page: Page, ms: number): Promise<void> {
  await page.goto('./#/settings');
  const plus = page.getByTestId('latency-value').getByRole('button', { name: '+' });
  for (let i = 0; i < ms / 5; i++) await plus.click();
  await expect(page.getByTestId('latency-value').locator('output')).toHaveText(`${ms} ms`);
  await page.evaluate(() => window.__gitar!.flush());
}

test('metronomla ritim ölçümü: bilinen sapmalar ±10 ms içinde ölçülür; kaçırılan ve fazla vuruş sayılır', async ({ page }, info) => {
  // Girişte 80 ms yapay gecikme var; aynı değer gecikme düzeltmesi olarak ayarlanır.
  await useHitBus(page, 0.08);
  await setLatency(page, 80);
  await expectHealthyLayout(page);
  await shot(page, info, 'settings-latency', true);

  await page.goto('./#/rhythm');
  await expect(page.getByTestId('page-title')).toHaveText('Ritim');
  await expect(page.getByTestId('latency-link')).toContainText('Gecikme düzeltmesi: 80 ms');
  await expect(page.getByTestId('rhythm-empty')).toBeVisible();
  await page.getByTestId('rhythm-bpm-slider').fill('120');
  await page.getByTestId('rhythm-bars').getByRole('radio', { name: '4 ölçü' }).click();
  await expectHealthyLayout(page);
  await shot(page, info, 'rhythm-setup', true);

  // 4 ölçü dörtlük + bitiş "bir"i = 17 hedef. 6. hedef bilerek kaçırılır; 13. hedeften sonra araya fazladan vuruş.
  const offsets = [12, -18, 30, 0, -8, null, 22, -25, 5, 15, -12, 8, -5, 20, -15, 3, 10];
  await page.getByTestId('rhythm-start').click();
  await expect(page.getByTestId('rhythm-phase')).toHaveAttribute('data-phase', /countin|running/);
  await page.evaluate(async (offs) => {
    const w = window as unknown as { __hit: (t: number) => void };
    const log = window.__gitar!.metronome.log;
    let next = 0;
    const done = () => next >= 4 + offs.length;
    while (!done()) {
      for (const entry of log) {
        if (entry.index !== next) continue;
        // İlk 4 vuruş sayma ölçüsü.
        const k = entry.index - 4;
        if (k >= 0) {
          const off = offs[k];
          if (off !== null) w.__hit(entry.time + off / 1000);
          if (k === 12) w.__hit(entry.time + 0.25);
        }
        next++;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }, offsets);

  // Çalarken canlı gösterge son vuruşu gösterir.
  await expect(page.getByTestId('rhythm-last')).not.toHaveAttribute('data-dev', '');
  await shot(page, info, 'rhythm-running');

  await expect(page.getByTestId('rhythm-summary')).toBeVisible({ timeout: 15000 });
  const result = (await page.evaluate(() => window.__gitar!.rhythmResult()))!;
  expect(result.targets).toBe(17);
  expect(result.hits).toBe(16);
  expect(result.missed).toBe(1);
  expect(result.extra).toBe(1);
  let worst = 0;
  offsets.forEach((off, i) => {
    const measured = result.deviations[i];
    if (off === null) {
      expect(measured, `hedef ${i + 1}`).toBeNull();
      return;
    }
    expect(measured, `hedef ${i + 1}`).not.toBeNull();
    worst = Math.max(worst, Math.abs(measured! - off));
    expect(Math.abs(measured! - off), `hedef ${i + 1}: beklenen ${off}, ölçülen ${measured}`).toBeLessThan(10);
  });
  console.log(`[ritim] canlı ölçüm: 16 vuruşta beklenen sapmadan en büyük fark ${worst.toFixed(2)} ms (hedef ±10 ms)`);
  const expectedMean = (offsets.filter((o): o is number => o !== null).reduce((s, o) => s + o, 0) / 16);
  expect(Math.abs(result.meanMs - expectedMean)).toBeLessThan(5);

  // Özet ekranı.
  await expect(page.getByTestId('stat-missed')).toHaveText('1');
  await expect(page.getByTestId('stat-extra')).toHaveText('1');
  await expect(page.getByTestId('score-accuracy')).toHaveText(String(result.accuracy));
  await expect(page.getByTestId('score-consistency')).toHaveText(String(result.consistency));
  await expect(page.getByTestId('rhythm-tendency')).toContainText('tam yerinde');
  await expect(page.getByTestId('dev-chart').locator('.dev-dot')).toHaveCount(16);
  await expect(page.getByTestId('dev-chart').locator('.dev-miss')).toHaveCount(1);
  await expectHealthyLayout(page);
  await shot(page, info, 'rhythm-summary', true);

  // Geçmişe yazıldı; yeniden açılışta duruyor.
  await expect(page.getByTestId('rhythm-row')).toHaveCount(1);
  await expect(page.getByTestId('rhythm-row')).toContainText('120 BPM · Dörtlükler');
  await page.getByTestId('rhythm-again').click();
  await expect(page.getByTestId('rhythm-start')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('rhythm-row')).toHaveCount(1);
  await expect(page.getByTestId('rhythm-history-chart').locator('.chart-dot')).toHaveCount(1);
});

test('eşlikle ritim ölçümü: sekizlikler backing track ızgarasına göre ölçülür', async ({ page }) => {
  await useHitBus(page, 0);
  await page.goto('./#/rhythm');
  await page.getByTestId('rhythm-source').getByRole('radio', { name: 'Eşlik' }).click();
  await page.getByTestId('rhythm-what').selectOption('div:2');
  await page.getByTestId('rhythm-bpm-slider').fill('120');
  await page.getByTestId('rhythm-bars').getByRole('radio', { name: '4 ölçü' }).click();
  await page.getByTestId('rhythm-start').click();

  // Her vuruşta ve her vuruşun yarısında, hep 20 ms geç çal.
  await page.evaluate(async () => {
    const w = window as unknown as { __hit: (t: number) => void };
    const log = window.__gitar!.backing.transport.log;
    let next = 0;
    while (next < 4 + 16) {
      for (const entry of log) {
        // Günlük yalnızca vuruş başlarını içerir; vuruş başına 12 adım.
        const beat = entry.index / 12;
        if (beat !== next) continue;
        if (beat >= 4) {
          w.__hit(entry.time + 0.02);
          w.__hit(entry.time + 0.25 + 0.02);
        }
        next++;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  await expect(page.getByTestId('rhythm-summary')).toBeVisible({ timeout: 15000 });
  const result = (await page.evaluate(() => window.__gitar!.rhythmResult()))!;
  expect(result.source).toBe('backing');
  expect(result.targets).toBe(32);
  expect(result.missed).toBe(0);
  expect(result.extra).toBe(0);
  for (const d of result.deviations) expect(Math.abs(d! - 20)).toBeLessThan(10);
  expect(result.consistency).toBeGreaterThan(85);
  await expect(page.getByTestId('rhythm-tendency')).toContainText('geç kalıyorsun');
  // Eşlik durdu.
  expect(await page.evaluate(() => window.__gitar!.backing.running.value)).toBe(false);
});

test('erken bitirilen ölçümde çalınmamış hedefler kaçırılmış sayılmaz', async ({ page }) => {
  await useHitBus(page, 0);
  await page.goto('./#/rhythm');
  await page.getByTestId('rhythm-bpm-slider').fill('200');
  await page.getByTestId('rhythm-bars').getByRole('radio', { name: '16 ölçü' }).click();
  await page.getByTestId('rhythm-start').click();
  await page.evaluate(async () => {
    const w = window as unknown as { __hit: (t: number) => void };
    const log = window.__gitar!.metronome.log;
    let next = 0;
    while (next < 4 + 8) {
      for (const entry of log) {
        if (entry.index !== next) continue;
        if (entry.index >= 4) w.__hit(entry.time);
        next++;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  });
  await expect(page.getByTestId('rhythm-hits')).toContainText('8 vuruş');
  await page.getByTestId('rhythm-stop').click();
  await expect(page.getByTestId('rhythm-summary')).toBeVisible();
  const result = (await page.evaluate(() => window.__gitar!.rhythmResult()))!;
  // 16 ölçülük hedefin yalnızca çalınan kısmı değerlendirilir.
  expect(result.targets).toBeLessThan(14);
  expect(result.hits).toBeGreaterThanOrEqual(8);
  expect(result.missed).toBeLessThanOrEqual(2);
});

test('gecikme kalibrasyonu: hoparlörden girişe 137 ms gecikme otomatik ölçülür', async ({ page }, info) => {
  // Uygulamanın çıkışını 137 ms gecikmeyle girişe geri bağla (hoparlör → mikrofon yolu).
  await page.addInitScript(() => {
    (window as unknown as { __gitarTestInput: (ctx: AudioContext) => AudioNode }).__gitarTestInput = (ctx) => {
      const loop = ctx.createDelay(1);
      loop.delayTime.value = 0.137;
      window.__gitar!.tapOutput(loop);
      return loop;
    };
  });
  await page.goto('./#/settings');
  await expect(page.getByTestId('latency-value').locator('output')).toHaveText('0 ms');
  await page.getByTestId('latency-auto').click();
  await expect(page.getByTestId('latency-message')).toContainText('Ölçülüyor');
  await expect(page.getByTestId('latency-auto')).toBeDisabled();
  await expect(page.getByTestId('latency-message')).toContainText('olarak ayarlandı', { timeout: 15000 });
  const text = await page.getByTestId('latency-value').locator('output').textContent();
  const measured = parseInt(text!, 10);
  console.log(`[gecikme] 137 ms'lik geri dönüş yolu ${measured} ms ölçüldü`);
  expect(Math.abs(measured - 137)).toBeLessThan(10);
  await expectHealthyLayout(page);
  await shot(page, info, 'latency-done', true);

  // Elle ince ayar ve kalıcılık.
  await page.getByTestId('latency-value').getByRole('button', { name: '+' }).click();
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('latency-value').locator('output')).toHaveText(`${measured + 5} ms`);
});

test('gecikme kalibrasyonu: tıklar girişten duyulmazsa açıklayıcı hata verir', async ({ page }) => {
  // Varsayılan sahte mikrofon sürekli bir ton çalar; tıkları duymaz.
  await page.goto('./#/settings');
  await page.getByTestId('latency-auto').click();
  await expect(page.getByTestId('latency-message')).toContainText('Tıklar girişten duyulamadı', { timeout: 15000 });
  await expect(page.getByTestId('latency-value').locator('output')).toHaveText('0 ms');
  await expect(page.getByTestId('latency-auto')).toBeEnabled();
});
