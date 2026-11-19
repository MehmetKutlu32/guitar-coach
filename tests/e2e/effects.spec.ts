import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot, useSyntheticInput } from './helpers';

const rms = (page: Page) => page.evaluate(() => window.__gitar!.outputRms());
const outFreq = (page: Page) => page.evaluate(() => window.__gitar!.outputFreq());
const fxState = (page: Page) => page.evaluate(() => window.__gitar!.fx());

/** Kaydırıcıyı bir değere getirir (kullanıcının sürüklemesiyle aynı `input` olayı). */
async function setSlider(page: Page, testid: string, value: number): Promise<void> {
  await page.getByTestId(testid).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('efektler: giriş açılır, sessiz başlar, ses açılınca aynı perdede çıkar; gecikme gösterilir; çıkınca durur', async ({ page }, info) => {
  await useSyntheticInput(page, 196);
  await page.goto('./#/fx');
  await expect(page.getByTestId('page-title')).toHaveText('Efektler');
  await expect(page.getByTestId('fx-headphones')).toBeVisible();
  await expect(page.getByTestId('fx-mute')).toBeDisabled();
  await expectHealthyLayout(page);
  await shot(page, info, 'fx-idle');

  await page.getByTestId('fx-start').click();
  await expect(page.getByTestId('fx-mute')).toBeEnabled();
  await expect(page.getByTestId('fx-mute')).toHaveAttribute('data-muted', 'true');
  expect((await fxState(page)).status).toBe('on');
  // Giriş görünüyor, çıkış ölçerde var ama hoparlöre gitmiyor (sessiz başlar).
  await expect.poll(async () => Number(await page.getByTestId('level-meter').getAttribute('aria-valuenow'))).toBeGreaterThan(30);
  await expect.poll(async () => Number(await page.getByTestId('fx-out-meter').getAttribute('aria-valuenow'))).toBeGreaterThan(5);
  await page.waitForTimeout(300);
  expect(await rms(page)).toBeLessThan(0.002);

  // Gecikme göstergesi bir sayı gösterir.
  const latency = page.getByTestId('fx-latency');
  await expect(latency).toHaveAttribute('data-ms', /^\d+$/);
  const ms = Number(await latency.getAttribute('data-ms'));
  console.log(`[efekt] gecikme göstergesi: ${ms} ms (${await latency.getAttribute('data-rating')}) — ${await latency.innerText()}`);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(1000);

  // Ses açılınca: çıkış var ve perdesi girişle aynı. Not: test girişi kusursuz sabit bir sinüs; yüksek seste
  // 4 sn'den uzun sürerse koruma onu (doğru olarak) doymuş geri beslemeden ayıramaz. Bu yüzden orta seviye.
  await setSlider(page, 'fx-volume', 60);
  await expect(page.getByTestId('fx-volume-value')).toHaveText('%60');
  await page.getByTestId('fx-mute').click();
  await expect(page.getByTestId('fx-mute')).toHaveAttribute('data-muted', 'false');
  await expect(page.getByTestId('fx-headphones')).toHaveCount(0);
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
  await expect.poll(async () => Math.abs((await outFreq(page)) - 196)).toBeLessThan(2);
  const clean = await outFreq(page);

  // Her hazır seste perde korunur (overdrive harmonik ekler, temel frekans aynı kalır).
  const found: string[] = [`temiz ${clean.toFixed(2)}`];
  for (const id of ['crunch', 'lead', 'ambient']) {
    await page.getByTestId(`fx-preset-${id}`).click();
    await expect(page.getByTestId(`fx-preset-${id}`)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await expect.poll(async () => Math.abs((await outFreq(page)) - 196), { timeout: 8000 }).toBeLessThan(2);
    found.push(`${id} ${(await outFreq(page)).toFixed(2)}`);
  }
  console.log(`[efekt] 196 Hz giriş → çıkış perdesi: ${found.join(' · ')} Hz`);
  expect(await rms(page)).toBeGreaterThan(0.01);
  expect((await fxState(page)).tripped).toBeNull();
  await expectHealthyLayout(page);
  await shot(page, info, 'fx-running', true);

  // Sessize alınca çıkış kesilir.
  expect((await fxState(page)).tripped).toBeNull();
  await page.getByTestId('fx-mute').click();
  await expect(page.getByTestId('fx-mute')).toHaveAttribute('data-muted', 'true');
  await expect.poll(() => rms(page), { timeout: 8000 }).toBeLessThan(0.002);
  await page.getByTestId('fx-mute').click();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);

  // Ekrandan çıkınca ses ve giriş kapanır.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('page-title')).not.toHaveText('Efektler');
  await expect.poll(() => rms(page), { timeout: 8000 }).toBeLessThan(0.002);
  expect((await fxState(page)).status).toBe('off');
});

test('efektler: hazır sesler, kendi sesini kaydetme ve kalıcılık', async ({ page }, info) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('./#/fx');
  await expect(page.getByTestId('fx-preset-clean')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fx-drive-on')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('fx-reverb-on')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('fx-preset-crunch').click();
  await expect(page.getByTestId('fx-drive-on')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('fx-delay-on')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('fx-drive-drive-value')).toHaveText('%45');

  await page.getByTestId('fx-preset-lead').click();
  await expect(page.getByTestId('fx-delay-on')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('fx-delay-time-value')).toHaveText('380 ms');

  // Ayar değişince "özel" olur.
  await setSlider(page, 'fx-drive-drive', 90);
  await setSlider(page, 'fx-delay-time', 500);
  await expect(page.getByTestId('fx-custom')).toBeVisible();
  await expect(page.locator('.chip.active')).toHaveCount(0);

  // Tempoya bağlı delay: metronom temposundan (varsayılan 90 BPM) hesaplanır: 1/8. = 500 ms.
  await page.getByTestId('fx-delay-sync').click();
  await page.getByTestId('fx-delay-division').getByText('1/8.').click();
  await expect(page.getByTestId('fx-delay-time-value')).toHaveText('500 ms');
  await page.getByTestId('fx-delay-division').getByText('1/4', { exact: true }).click();
  await expect(page.getByTestId('fx-delay-time-value')).toHaveText('667 ms');

  // Kendi sesini kaydet.
  await page.getByTestId('fx-save').click();
  await page.getByTestId('fx-name').fill('Benim sesim');
  await page.getByTestId('fx-name-save').click();
  await expect(page.getByTestId('fx-user-preset')).toHaveText('Benim sesim');
  await expect(page.getByTestId('fx-user-preset')).toHaveAttribute('aria-pressed', 'true');
  await expectHealthyLayout(page);
  await shot(page, info, 'fx-presets', true);

  // Kalıcı: yenileyince aynı ses seçili ve değerler yerinde.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('fx-user-preset')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fx-drive-drive-value')).toHaveText('%90');
  await expect(page.getByTestId('fx-delay-time-value')).toHaveText('667 ms');

  // Başka sese geçip geri dönünce ayarlar geri gelir.
  await page.getByTestId('fx-preset-clean').click();
  await expect(page.getByTestId('fx-drive-on')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('fx-user-preset').click();
  await expect(page.getByTestId('fx-drive-drive-value')).toHaveText('%90');
  await expect(page.getByTestId('fx-delay-sync')).toHaveAttribute('aria-checked', 'true');

  // Aynı adla kaydetmek üzerine yazar; silme.
  await page.getByTestId('fx-save').click();
  await expect(page.getByTestId('fx-name')).toHaveValue('Benim sesim');
  await page.getByTestId('fx-name-save').click();
  await expect(page.getByTestId('fx-user-preset')).toHaveCount(1);
  await page.getByTestId('fx-delete').click();
  await expect(page.getByTestId('fx-user-preset')).toHaveCount(0);
  await expect(page.getByTestId('fx-custom')).toBeVisible();

  // İngilizce metinler.
  await page.evaluate(() => window.__gitar!.flush());
  await page.goto('./#/settings');
  await page.getByTestId('lang').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Settings');
  await page.goto('./#/fx');
  await expect(page.getByTestId('page-title')).toHaveText('Effects');
  await expect(page.getByTestId('fx-preset-lead')).toHaveText('Lead');
  await expectHealthyLayout(page);
});

test('efektler: geri besleme döngüsünde koruma sesi kapatır', async ({ page }, info) => {
  // Hoparlör → mikrofon yolunu taklit eden gerçek bir döngü: ana çıkış, gecikme ve ×4 kazançla girişe geri verilir.
  await page.addInitScript(() => {
    const w = window as unknown as { __gitarTestInput: (ctx: AudioContext) => AudioNode; __loop: { ctx: AudioContext; node: AudioNode } };
    w.__gitarTestInput = (ctx) => {
      const out = ctx.createGain();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const quiet = ctx.createGain();
      quiet.gain.value = 0.02;
      osc.connect(quiet).connect(out);
      osc.start();
      w.__loop = { ctx, node: out };
      return out;
    };
  });
  await page.goto('./#/fx');
  await page.getByTestId('fx-start').click();
  await expect(page.getByTestId('fx-mute')).toBeEnabled();
  await setSlider(page, 'fx-volume', 100);
  await page.getByTestId('fx-mute').click();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.005);
  const closedAt = await page.evaluate(() => {
    const { ctx, node } = (window as unknown as { __loop: { ctx: AudioContext; node: AudioNode } }).__loop;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.03;
    const gain = ctx.createGain();
    gain.gain.value = 4;
    window.__gitar!.tapOutput(delay);
    delay.connect(gain).connect(node);
    return performance.now();
  });
  await expect(page.getByTestId('fx-tripped')).toBeVisible({ timeout: 5000 });
  const reactedMs = (await page.evaluate(() => performance.now())) - closedAt;
  const state = await fxState(page);
  console.log(`[efekt] geri besleme döngüsü → koruma: ${state.tripped}, ~${Math.round(reactedMs)} ms içinde sessize alındı`);
  expect(state.muted).toBe(true);
  expect(state.tripped).not.toBeNull();
  await expect(page.getByTestId('fx-mute')).toHaveAttribute('data-muted', 'true');
  await expect.poll(() => rms(page), { timeout: 5000 }).toBeLessThan(0.002);
  await expect(page.getByTestId('fx-clip')).toHaveAttribute('data-on', 'false', { timeout: 5000 });
  await shot(page, info, 'fx-tripped');
});

test('efekt zinciri çevrimdışı ölçümler: kapalıyken birebir, delay zamanı, reverb sönümü, overdrive, kapı', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'ölçüm bir kez yeterli');
  await page.goto('./#/fx');
  await expect(page.getByTestId('page-title')).toHaveText('Efektler');
  await page.waitForFunction(() => !!window.__gitar);
  const report = await page.evaluate(async () => {
    const g = window.__gitar!;
    const SR = 48000;
    const off = {
      drive: { on: false, drive: 100, tone: 0, level: 100 },
      delay: { on: false, timeMs: 250, feedback: 80, mix: 100, sync: false, division: '1/8' as const },
      reverb: { on: false, size: 100, decay: 6, mix: 100 },
    };
    const base = { input: { gainDb: 0, gateOn: false, gateDb: -55 }, preset: off, volume: 100, bpm: 120 };
    const maxDiff = (a: number[], b: number[]) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
    const peakAt = (x: number[], from: number, to: number) => {
      let best = from;
      for (let i = from; i < to; i++) if (Math.abs(x[i]) > Math.abs(x[best])) best = i;
      return best;
    };

    // 1) Hepsi kapalı: çıkış = giriş.
    const imp = await g.renderFx(base, 'impulse', 0.5, SR);
    const tone = await g.renderFx(base, 'tone', 0.5, SR);
    const bypassImpulse = maxDiff(imp.input, imp.output);
    const bypassTone = maxDiff(tone.input, tone.output);
    // Kapalı efektin ayarları sese sızmaz: aşırı ayarlı ama kapalı zincir = tamamen varsayılan kapalı zincir.
    const plainOff = {
      drive: { on: false, drive: 0, tone: 50, level: 50 },
      delay: { ...off.delay, feedback: 0, mix: 0 },
      reverb: { on: false, size: 0, decay: 0.3, mix: 0 },
    };
    const tone2 = await g.renderFx({ ...base, preset: plainOff }, 'tone', 0.5, SR);
    const bypassLeak = maxDiff(tone.output, tone2.output);

    // 2) Delay: 250 ms, %50 karışım, %50 tekrar. Dürtü 0,1 s'de.
    const d = await g.renderFx(
      { ...base, preset: { ...off, delay: { ...off.delay, on: true, timeMs: 250, feedback: 50, mix: 50 } } },
      'impulse',
      1,
      SR,
    );
    const start = 0.1 * SR;
    const e1 = peakAt(d.output, start + 100, start + 0.4 * SR);
    const e2 = peakAt(d.output, start + 0.4 * SR, start + 0.65 * SR);
    // Tempoya bağlı: 120 BPM, 1/8. → 375 ms.
    const s = await g.renderFx(
      { ...base, preset: { ...off, delay: { ...off.delay, on: true, sync: true, division: '1/8.', feedback: 0, mix: 50 } } },
      'impulse',
      1,
      SR,
    );
    const es = peakAt(s.output, start + 100, s.output.length);

    // 3) Reverb: T60 2 s; çıkış zarfının eğiminden ölçülür.
    const rv = await g.renderFx({ ...base, preset: { ...off, reverb: { on: true, size: 30, decay: 2, mix: 100 } } }, 'impulse', 2.6, SR);
    const block = SR / 100;
    const pts: { t: number; db: number }[] = [];
    for (let b = 0; b * block + block <= rv.output.length; b++) {
      const t = (b * block) / SR - 0.1;
      if (t < 0.08 || t > 1.8) continue;
      let sum = 0;
      for (let i = b * block; i < (b + 1) * block; i++) sum += rv.output[i] ** 2;
      pts.push({ t, db: 10 * Math.log10(sum / block + 1e-30) });
    }
    const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
    const md = pts.reduce((a, p) => a + p.db, 0) / pts.length;
    const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.db - md), 0) / pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
    const t60 = -60 / slope;

    // 4) Overdrive: 220 Hz ton → harmonikler (Goertzel), sınırlı çıkış.
    const goertzel = (x: number[], f: number, from: number, n: number) => {
      const w = (2 * Math.PI * f) / SR;
      let s1 = 0;
      let s2 = 0;
      for (let i = from; i < from + n; i++) {
        const s0 = x[i] + 2 * Math.cos(w) * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2) / n;
    };
    const dr = await g.renderFx({ ...base, preset: { ...off, drive: { on: true, drive: 60, tone: 70, level: 85 } } }, 'tone', 0.6, SR);
    const from = 0.3 * SR;
    const n = 4800; // 100 ms = 22 periyot
    const h = [1, 2, 3, 4, 5].map((k) => goertzel(dr.output, 220 * k, from, n));
    const h0 = [1, 3].map((k) => goertzel(tone.output, 220 * k, 0.2 * SR, n));
    const drivePeak = dr.output.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

    // 5) Zincir gecikmesi: overdrive açık (drive 0, ton açık) iken dürtü yanıtının tepe noktası.
    const lat = await g.renderFx({ ...base, preset: { ...off, drive: { on: true, drive: 0, tone: 100, level: 85 } } }, 'impulse', 0.3, SR);
    const driveLag = peakAt(lat.output, start - 50, start + 2000) - start;
    // Karşılaştırma: ana çıkıştaki gibi bir DynamicsCompressor'ün eklediği gecikme.
    const oc = new OfflineAudioContext(1, SR / 4, SR);
    const buf = oc.createBuffer(1, SR / 4, SR);
    buf.getChannelData(0)[1000] = 0.1;
    const src = oc.createBufferSource();
    src.buffer = buf;
    const comp = oc.createDynamicsCompressor();
    comp.threshold.value = -8;
    src.connect(comp).connect(oc.destination);
    src.start();
    const co = Array.from((await oc.startRendering()).getChannelData(0));
    const compLag = peakAt(co, 900, co.length) - 1000;
    // Neden worklet delay: döngüdeki yerleşik DelayNode her turda fazladan gecikme ekliyor mu?
    const lc = new OfflineAudioContext(1, SR / 2, SR);
    const lb = lc.createBuffer(1, SR / 2, SR);
    lb.getChannelData(0)[1000] = 0.5;
    const ls = lc.createBufferSource();
    ls.buffer = lb;
    const dn = lc.createDelay(1);
    dn.delayTime.value = 0.1;
    const fg = lc.createGain();
    fg.gain.value = 0.5;
    ls.connect(dn);
    dn.connect(fg).connect(dn);
    dn.connect(lc.destination);
    ls.start();
    const lo = Array.from((await lc.startRendering()).getChannelData(0));
    const nativeEcho2 = peakAt(lo, 1000 + 0.15 * SR, 1000 + 0.25 * SR) - 1000;

    // 6) Kapı: −50 dBFS ton (eşik −40) kesilir; 0 dBFS kazançla geçer.
    const gated = await g.renderFx({ ...base, input: { gainDb: -40, gateOn: true, gateDb: -40 } }, 'tone', 0.5, SR);
    const open = await g.renderFx({ ...base, input: { gainDb: 0, gateOn: true, gateDb: -40 } }, 'tone', 0.5, SR);
    const tail = (x: number[]) => Math.sqrt(x.slice(0.2 * SR).reduce((a, v) => a + v * v, 0) / (x.length - 0.2 * SR));

    return {
      bypassImpulse,
      bypassTone,
      bypassLeak,
      echo1Ms: ((e1 - start) / SR) * 1000,
      echo1Amp: d.output[e1],
      echo2Ms: ((e2 - start) / SR) * 1000,
      echo2Amp: d.output[e2],
      syncMs: ((es - start) / SR) * 1000,
      t60,
      harmonics: h.map((v) => v / h[0]),
      cleanH3: h0[1] / h0[0],
      drivePeak,
      driveLagSamples: driveLag,
      compLagSamples: compLag,
      nativeCycleExtraSamples: nativeEcho2 - 0.2 * SR,
      gatedRms: tail(gated.output),
      openRms: tail(open.output),
      finite: [imp, tone, d, rv, dr].every((r) => r.output.every(Number.isFinite)),
    };
  });
  console.log('[efekt çevrimdışı]', JSON.stringify(report, (_, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v)));

  expect(report.finite).toBe(true);
  // Kapalı zincir sese dokunmaz (güvenlik kırpıcısının doğrusal bölgesi: yalnızca kayan nokta yuvarlaması).
  expect(report.bypassImpulse).toBeLessThan(1e-6);
  expect(report.bypassTone).toBeLessThan(1e-6);
  expect(report.bypassLeak).toBe(0);
  // Yankılar ayarlanan zamanda (±1 ms) ve beklenen seviyede.
  expect(Math.abs(report.echo1Ms - 250)).toBeLessThanOrEqual(1);
  expect(Math.abs(report.echo2Ms - 500)).toBeLessThanOrEqual(1);
  expect(report.echo1Amp).toBeCloseTo(0.25, 2);
  expect(report.echo2Amp).toBeGreaterThan(0.02);
  expect(report.echo2Amp).toBeLessThan(0.125);
  expect(Math.abs(report.syncMs - 375)).toBeLessThanOrEqual(1);
  // Reverb sönümü ayarlanan T60'a uyar.
  expect(Math.abs(report.t60 - 2)).toBeLessThanOrEqual(0.1);
  // Overdrive harmonik ekler; temiz zincirde yok.
  expect(report.harmonics[2]).toBeGreaterThan(0.1);
  expect(report.cleanH3).toBeLessThan(0.001);
  expect(report.drivePeak).toBeLessThanOrEqual(1);
  // Overdrive'ın gecikmesi gösterge için varsayılan değerle uyumlu (4× aşırı örnekleme ≈ 192 örnek).
  expect(Math.abs(report.driveLagSamples - 192)).toBeLessThanOrEqual(4);
  // Kapı.
  expect(report.gatedRms).toBeLessThan(1e-5);
  expect(report.openRms).toBeGreaterThan(0.15);
});
