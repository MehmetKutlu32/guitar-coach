import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const chordTexts = (page: Page) =>
  page.getByTestId('lyrics').first().locator('.ly-chord[data-ev]').allTextContents();

test('şarkı listesi ve görünümü: akorlar sözlerin üstünde, transpoze ve kapo', async ({ page }, info) => {
  await page.goto('./#/songs');
  await expect(page.getByTestId('page-title')).toHaveText('Şarkılar');
  await expect(page.getByTestId('song-row')).toHaveCount(3);
  await expectHealthyLayout(page);
  await shot(page, info, 'songs-list');

  await page.getByTestId('song-row').filter({ hasText: 'Sahil Yolu' }).click();
  await expect(page.getByTestId('song-title')).toHaveText('Sahil Yolu');
  expect((await chordTexts(page)).slice(0, 4)).toEqual(['Am', 'F', 'C', 'G']);
  // Akor, ait olduğu sözün tam üstünde durur.
  const seg = page.getByTestId('lyrics').locator('.ly-seg').first();
  const chordBox = await seg.locator('.ly-chord').boundingBox();
  const textBox = await seg.locator('.ly-text').boundingBox();
  expect(chordBox!.y + chordBox!.height).toBeLessThanOrEqual(textBox!.y + 1);
  expect(Math.abs(chordBox!.x - textBox!.x)).toBeLessThan(8);
  await expect(page.getByTestId('song-chords').locator('.chord-diagram')).toHaveCount(4);
  await expectHealthyLayout(page);
  await shot(page, info, 'song-view', true);

  // Transpoze +2: Am F C G → Bm G D A.
  const plus = page.getByTestId('song-transpose').getByRole('button', { name: '+' });
  await plus.click();
  await plus.click();
  expect((await chordTexts(page)).slice(0, 4)).toEqual(['Bm', 'G', 'D', 'A']);

  // 2. perdeye kapo: yine Am F C G basılır.
  const capo = page.getByTestId('song-capo').getByRole('button', { name: '+' });
  await capo.click();
  await capo.click();
  expect((await chordTexts(page)).slice(0, 4)).toEqual(['Am', 'F', 'C', 'G']);
  await expect(page.getByTestId('capo-help')).toContainText('Kapoyu 2. perdeye tak');

  // Yazı boyutu.
  const size = () => page.getByTestId('lyrics').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await page.getByTestId('font-larger').click();
  expect(await size()).toBe(before + 2);

  // Ayarlar şarkıya özel ve kalıcı.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('song-title')).toHaveText('Sahil Yolu');
  await expect(page.getByTestId('song-transpose').locator('output')).toHaveText('+2');
  expect((await chordTexts(page)).slice(0, 4)).toEqual(['Am', 'F', 'C', 'G']);
  await page.getByTestId('song-back').click();
  await page.getByTestId('song-row').filter({ hasText: 'İlk Dört Akor' }).click();
  await expect(page.getByTestId('song-transpose').locator('output')).toHaveText('0');
});

test('çalarken geçerli akor vurgulanır, sayfa tempoya göre kayar ve şarkı sonunda durur', async ({ page }, info) => {
  await page.goto('./#/songs/builtin%3Apazartesi-blues');
  await expect(page.getByTestId('song-title')).toHaveText('Pazartesi Blues');
  // Hızlı deneme: akor başına 1 vuruş, 242 BPM (92'den 5'er artışla) → 12 akor ≈ 3 sn.
  await page.getByTestId('song-beats').getByRole('radio', { name: '1', exact: true }).click();
  const bpm = page.getByTestId('song-bpm').getByRole('button', { name: '+' });
  for (let i = 0; i < 30; i++) await bpm.click();
  await expect(page.getByTestId('song-bpm').locator('output')).toHaveText('242 BPM');

  await page.getByTestId('song-toggle').click();
  await expect(page.getByTestId('song-counting')).toBeVisible();
  // Vurgulanan akorların sırası: 12 akor, baştan sona.
  const seen = await page.evaluate(async () => {
    const out: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 12000) {
      const now = document.querySelector('.ly-chord.now');
      if (now) {
        const i = Number(now.getAttribute('data-ev'));
        if (out[out.length - 1] !== i) out.push(i);
      }
      if (out.length > 0 && document.querySelector('[data-testid=song-toggle]')!.getAttribute('aria-pressed') === 'false') break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  expect(seen[0]).toBe(0);
  expect(seen[seen.length - 1]).toBe(11);
  // Sıra hiç geri gitmez ve akorların çoğu görülür (çok hızlı tempoda bir kare atlanabilir).
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  expect(seen.length).toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('song-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ly-chord.now')).toHaveCount(0);

  // Ses gerçekten çıktı ve ölçüler ses saatinde tam aralıklı planlandı.
  const log = await page.evaluate(() => window.__gitar!.backing.transport.log.map((l) => l.time));
  expect(log.length).toBeGreaterThanOrEqual(12);
  let worst = 0;
  for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs(log[i] - log[0] - (i * 60) / 242));
  expect(worst).toBeLessThan(1e-9);
  await shot(page, info, 'song-played');
});

test('uzun şarkıda çalarken sayfa kendiliğinden aşağı kayar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('./#/songs/builtin%3Asahil-yolu');
  await page.getByTestId('song-beats').getByRole('radio', { name: '1', exact: true }).click();
  const bpm = page.getByTestId('song-bpm').getByRole('button', { name: '+' });
  while ((await page.getByTestId('song-bpm').locator('output').textContent()) !== '200 BPM') await bpm.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('song-toggle').click();
  // Son satırlara gelindiğinde sayfa başlangıca göre aşağıdadır.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 15000 }).toBeGreaterThan(80);
  await expect(page.getByTestId('song-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
});

test('kullanıcı ChordPro ile şarkı ekler, düzenler ve siler; hazır şarkı kopyalanabilir', async ({ page }, info) => {
  await page.goto('./#/songs');
  await page.getByTestId('song-new').click();
  await expect(page.getByTestId('song-editor')).toBeVisible();
  await page.getByTestId('song-text').fill('{title: Deneme Şarkım}\n{tempo: 110}\n[Em]Birinci satır [G]devam\n[Hmm]Bozuk akor [D]son');
  await expect(page.getByTestId('song-unknown')).toHaveText('Tanınmayan akorlar: Hmm');
  // Önizleme anında güncellenir.
  await expect(page.getByTestId('lyrics')).toContainText('Birinci satır');
  await expectHealthyLayout(page);
  await shot(page, info, 'song-editor', true);
  await page.getByTestId('song-save').click();

  await expect(page.getByTestId('song-title')).toHaveText('Deneme Şarkım');
  await expect(page.getByTestId('song-bpm').locator('output')).toHaveText('110 BPM');
  expect(await chordTexts(page)).toEqual(['Em', 'G', 'Hmm', 'D']);

  // Düzenle.
  await page.getByTestId('song-edit').click();
  await page.getByTestId('song-text').fill('{title: Deneme Şarkım 2}\n[Am]Yeni [C]söz');
  await page.getByTestId('song-save').click();
  await expect(page.getByTestId('song-title')).toHaveText('Deneme Şarkım 2');

  await page.reload();
  await expect(page.getByTestId('song-title')).toHaveText('Deneme Şarkım 2');
  await page.getByTestId('song-back').click();
  await expect(page.getByTestId('song-row')).toHaveCount(4);

  // Hazır şarkı düzenlenemez ama kopyalanabilir.
  await page.getByTestId('song-row').filter({ hasText: 'İlk Dört Akor' }).click();
  await expect(page.getByTestId('song-edit')).toHaveCount(0);
  await page.getByTestId('song-copy').click();
  await expect(page.getByTestId('song-text')).toHaveValue(/İlk Dört Akor/);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('song-delete').click();
  await expect(page.getByTestId('song-row')).toHaveCount(4);

  // Kendi şarkısını sil.
  await page.getByTestId('song-row').filter({ hasText: 'Deneme Şarkım 2' }).click();
  await page.getByTestId('song-edit').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('song-delete').click();
  await expect(page.getByTestId('song-row')).toHaveCount(3);
});

test('akor denetimi: çalarken doğru basılan akorlar işaretlenir ve isabet gösterilir', async ({ page }) => {
  // Girişten sürekli La minör (A C E) akoru gelir.
  await page.addInitScript(() => {
    (window as unknown as { __gitarTestInput: (ctx: AudioContext) => AudioNode }).__gitarTestInput = (ctx) => {
      const out = ctx.createGain();
      out.gain.value = 0.3;
      for (const midi of [45, 52, 57, 60, 64]) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        for (let h = 1; h <= 3; h++) {
          const osc = ctx.createOscillator();
          osc.frequency.value = f * h;
          const g = ctx.createGain();
          g.gain.value = 1 / (h * h) / 5;
          osc.connect(g).connect(out);
          osc.start();
        }
      }
      return out;
    };
  });
  await page.goto('./#/songs/new');
  // Am iki kez, G bir kez, sonra yine Am: dört akordan üçü tutmalı.
  await page.getByTestId('song-text').fill('{title: Denetim}\n[Am]bir [Am]iki [G]üç [Am]dört');
  await page.getByTestId('song-save').click();
  await page.getByTestId('song-listen').click();
  await page.getByTestId('song-band').click();
  const bpm = page.getByTestId('song-bpm').getByRole('button', { name: '+' });
  while ((await page.getByTestId('song-bpm').locator('output').textContent()) !== '120 BPM') await bpm.click();

  await page.getByTestId('song-toggle').click();
  await expect(page.getByTestId('song-score')).toHaveText('Akor isabeti: 3 / 4', { timeout: 20000 });
  const hit = await page.getByTestId('lyrics').locator('.ly-chord.hit').allTextContents();
  expect(hit).toEqual(['Am', 'Am', 'Am']);
});
