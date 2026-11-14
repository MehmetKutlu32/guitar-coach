# İlerleme

Son güncelleme: 2026-11-14 · Biten aşama: **4 / 16** (Katman 1 tamam) · Sıradaki: **Aşama 5 — Backing track üretici**

Kurallar ve aşama tanımları için [CLAUDE.md](CLAUDE.md), kararlar için [DECISIONS.md](DECISIONS.md).

## Aşamalar

| # | Aşama | Durum |
|---|-------|-------|
| 1 | İskelet + akort aleti | ✅ bitti |
| 2 | Metronom + ritim kalıpları | ✅ bitti |
| 3 | Akor kütüphanesi + geçiş egzersizi | ✅ bitti |
| 4 | Pratik günlüğü | ✅ bitti |
| 5 | Backing track üretici | ⏳ sırada |
| 6 | Çalarken geri bildirim — ritim | — |
| 7 | Çalarken geri bildirim — akor | — |
| 8 | Akıllı günlük plan | — |
| 9 | Şarkı modu | — |
| 10 | Tab editörü ve oynatıcı | — |
| 11 | Fretboard ve teori | — |
| 12 | Kulak eğitimi | — |
| 13 | Kayıt ve karşılaştırma | — |
| 14 | Kendi ses dosyasıyla çalışma | — |
| 15 | Oyunlaştırma | — |
| 16 | Canlı efektler | — |

## Test sonuçları (son çalıştırma)

| Paket | Sonuç |
|-------|-------|
| `npm run build` (tsc strict + vite) | ✅ |
| Vitest (birim) | ✅ 57 / 57 |
| Playwright (mobil 390×844 + masaüstü 1440×900) | ✅ 40 / 40 |
| Yayınlanmış site duman testi | ⛔ çalıştırılamadı (site yayınlanmadı, aşağıya bak) |

## Ölçülen doğruluk

### Perde algılama (Aşama 1) — hedef ±2 cent

19 frekans (65–1318 Hz), 44,1 ve 48 kHz, üretilmiş sinyaller. Değerler en kötü durumdur.

| Sinyal | En kötü hata |
|--------|--------------|
| Sinüs (5 farklı detune) | 0,98 cent |
| Karplus-Strong tel (atak sonrası 3 an) | 0,75 cent |
| Karplus-Strong + beyaz gürültü, SNR 20 dB | kare başına 0,98 cent · medyan 0,21 cent |
| Karplus-Strong + beyaz gürültü, SNR 10 dB | kare başına 3,02 cent · medyan 1,05 cent |

Gürültü testlerinde oktav hatası yok. Sessizlikte ve saf gürültüde perde bildirilmiyor.
Uçtan uca: sahte mikrofondaki 110 Hz ton "A2, akortlu" (±3 cent içinde); 18 cent tiz E2, 16–20 cent arasında okunuyor.

### Metronom zamanlaması (Aşama 2)

| Ölçüm | Sonuç |
|-------|-------|
| Planlanan tık zamanının ideal ızgaradan sapması — birim testi, 10 dk, 40–260 BPM, 5–90 ms titreşimli zamanlayıcı | en fazla 0,0001 ns (kayma yok) |
| Aynı ölçüm tarayıcıda canlı çalışırken (240 BPM, 16 tık) | 0,0000 ns; hiçbir tık geç planlanmadı |
| İşlenmiş seste tıkın başladığı örnek ile planlanan an arasındaki fark (OfflineAudioContext, 64 tık) | en fazla 1,00 örnek ≈ 0,023 ms |

Not: bunlar planlama ve işleme doğruluğudur. Hoparlörden çıkan sesin donanım gecikmesi ayrıdır ve ölçülmedi.

## Yapılanlar

### Aşama 1 — İskelet + akort aleti
- Vite + TypeScript (strict) + Preact iskeleti; koyu tema, mobilde alt çubuk, masaüstünde yan menü.
- Akort: YIN perde algılama (AudioWorklet), ibreli gösterge, nota + cent + Hz, 9 akort düzeni + kromatik,
  tele kilitlenme, referans tel sesi (Karplus-Strong), akortlanan telleri işaretleme.
- Ayarlar: dil (TR/EN), giriş cihazı seçimi, giriş seviyesi göstergesi, A4 referansı, JSON dışa/içe aktarma.
- IndexedDB veri katmanı, i18n altyapısı, hash yönlendirme.
- PWA: manifest, ikonlar, elle yazılmış service worker; çevrimdışı açılış testle doğrulandı.
- CI/yayın iş akışı: `.github/workflows/deploy.yml`.

### Aşama 2 — Metronom + ritim kalıpları
- 30–260 BPM; ±1/±5 düğmeleri, kaydırıcı, tap tempo.
- Ölçüler: 2/4, 3/4, 4/4, 5/4, 6/8, 7/8. Vuruşa dokunarak vurgu (normal / vurgulu / sessiz).
- Alt bölme: dörtlük, sekizlik, üçleme, on altılık.
- Tempo antrenörü: her N ölçüde +X BPM, hedef tempoda durur.
- Vuruş kalıpları: 12 hazır kalıp, metronomla senkron gösterim, gitar sesiyle seslendirme,
  kullanıcının kendi kalıbını oluşturması/düzenlemesi/silmesi (IndexedDB'de saklanır).

### Aşama 3 — Akor kütüphanesi + geçiş egzersizi
- 29 açık akor, 99 bare akor (E ve A biçimleri, 12 kök × maj/min/7/m7 + maj7), 24 power akor.
  Her biçimin notaları birim testiyle akorun teorik notalarına karşı doğrulanır.
- SVG diyagramlar: kök nota vurgusu, parmak numaraları, bare çubuğu, açık/çalınmayan tel işaretleri.
- Diyagrama dokununca akor sentez gitar sesiyle çalınır (vuruş ya da tek tek).
- Geçiş egzersizi: 3 sn geri sayım, 30/60/120 sn süre, dokunarak ya da sonunda elle sayım,
  sonuç kaydı, rekor bildirimi, çift başına istatistik + çizgi grafik, tüm çiftlerin listesi.

### Aşama 4 — Pratik günlüğü
- Oturum zamanlayıcı: başlat / duraklat / bitir. Oturum sürerken araçlar arasında gezilebilir; süre, açık olan
  ekrana göre egzersiz türüne (akort, metronom ve ritim, akorlar, serbest) kendiliğinden yazılır.
- Üst çubukta her ekranda görünen oturum sayacı. Yarım kalan oturum yeniden açılışta duraklatılmış olarak geri gelir.
- Günlük seri (bugün ya da dün biten), en uzun seri, bugün ve son 7 gün toplamları.
- Haftalık (7 gün) ve aylık (30 gün) çubuk grafik; döneme göre egzersiz dağılımı.
- Son oturumlar listesi, silme, uygulama dışındaki çalışmayı elle ekleme.
- Mobil alt çubuk: Ana sayfa, Akort, Metronom, Akorlar, Günlük. Ayarlar üst çubuktaki simgeye taşındı.

## Bilinen eksikler / hatalar

- **GitHub'a push edilmedi, site yayınlanmadı.** `gh` CLI bu makinede giriş yapmamış. Tüm commit'ler yerelde.
  Kurulum komutları README'de. Her aşama sonunda `gh auth status` yeniden denetleniyor.
- **CI iş akışı hiç çalışmadı** (yukarıdaki nedenle); Linux'ta başsız Chromium'da ses testlerinin geçtiği doğrulanmadı.
- Gecikme kalibrasyonu henüz yok; Aşama 6'da eklenecek (bkz. DECISIONS.md).
- Gerçek mikrofon/gitar ile ve gerçek hoparlörle elle deneme yapılmadı; tüm doğrulama üretilmiş sinyallerle.
- Geçiş egzersizinde sayım şimdilik elle (dokunarak ya da sonunda girerek); otomatik sayım Aşama 7'de.
- Oturum sayacı, uygulama görünür değilken (ekran kilitli, başka sekme) süre biriktirmez: iki sayım arası en çok
  5 sn sayılır. Ekran kapalıyken çalışılan süre günlüğe eksik yansır; gerekirse elle eklenebilir.
- Metronom yalnızca kendi ekranı açıkken çalar; başka ekrana geçince durur (bilinçli karar).

## Devam edecek kişi için notlar

- Yeni ekran eklemek: `src/features/<ad>/` altında bileşen + saf mantık, sonra `src/features/registry.ts`'e kayıt,
  `src/ui/Icon.tsx`'te ikon, `src/i18n/tr.ts` ve `en.ts`'e metinler.
- Ekranın kalıcı durumu için `persistent()` (`src/db/persist.ts`); kullanıcı içerikleri için `items` deposu.
- Ses girişi: `acquireInput()` + `onAnalysis()` (`src/audio/input.ts`). Yeni analiz türleri `analyzer.worklet.ts`'e
  eklenir, saf DSP `src/dsp/` altında tutulur ve Vitest ile sınanır.
- Zamanlama gereken her şey (eşlik, egzersizler) `metronome` örneğini ve `onStep` kancasını kullanabilir
  (`src/audio/metronome.ts`); saf saat mantığı `src/audio/clock.ts`.
- Uçtan uca testlerde farklı giriş sinyali için `useSyntheticInput()`; ölçüm kancaları `window.__gitar`
  (`src/debug.ts`): metronom günlüğü, çıkış seviyesi, bekleyen yazmaları bitirme (`flush`).
- Süreli egzersiz testlerinde `page.clock.install()` + `fastForward()` kullanılır (bkz. `chords.spec.ts`).
- Yeni ekran günlükte ayrı bir egzersiz türü olarak sayılacaksa: `registry.ts`'te `activity`, `Log.tsx`'te
  `ACTIVITIES`, i18n'de `activity.<ad>`. Günlük hesapları: `src/features/log/stats.ts`.
- Sahte saatle (`page.clock`) testte: saat durdurulmuşsa Preact `useEffect`'leri de bekler; ölçüm bitince
  `page.clock.resume()` çağır. Sayfa geçişinden sonra `runFor`'dan önce başlığın değiştiğini bekle.
- Akor verisi ve teori: `src/music/chords.ts`, `src/music/theory.ts`. Grafikler: `src/ui/charts.tsx`.
- Windows'ta Git Bash heredoc'ları tek tırnak sayısı tek olunca bozuluyor; dosyaları doğrudan yaz.
