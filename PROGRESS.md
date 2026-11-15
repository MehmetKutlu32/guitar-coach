# İlerleme

Son güncelleme: 2026-11-15 · Biten aşama: **7 / 16** (Katman 1 tamam) · Sıradaki: **Aşama 8 — Akıllı günlük plan**

Kurallar ve aşama tanımları için [CLAUDE.md](CLAUDE.md), kararlar için [DECISIONS.md](DECISIONS.md).

## Aşamalar

| # | Aşama | Durum |
|---|-------|-------|
| 1 | İskelet + akort aleti | ✅ bitti |
| 2 | Metronom + ritim kalıpları | ✅ bitti |
| 3 | Akor kütüphanesi + geçiş egzersizi | ✅ bitti |
| 4 | Pratik günlüğü | ✅ bitti |
| 5 | Backing track üretici | ✅ bitti |
| 6 | Çalarken geri bildirim — ritim | ✅ bitti |
| 7 | Çalarken geri bildirim — akor | ✅ bitti |
| 8 | Akıllı günlük plan | ⏳ sırada |
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
| Vitest (birim) | ✅ 112 / 112 |
| Playwright (mobil 390×844 + masaüstü 1440×900) | ✅ 64 / 64 |
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

### Eşlik grubu (Aşama 5)

| Ölçüm | Sonuç |
|-------|-------|
| Vuruşların ses saatindeki planlanan aralığı (240 BPM, canlı) | ideal ızgaradan sapma < 1 ns |
| Çevrimdışı işlenen karışımın tepe değeri (varsayılan seviyeler, sınırlayıcıdan önce) | 0,85 (dört tarzda da; kırpılma yok) |
| Karışımda partilerin RMS düzeyi — rock | davul 0,073 · bas 0,140 · akor 0,072 |
| Aynı — blues / pop / funk | 0,063·0,142·0,053 / 0,072·0,141·0,066 / 0,073·0,101·0,044 |

### Vuruş algılama ve ritim ölçümü (Aşama 6) — hedef ±10 ms

Üretilmiş sinyaller, vuruş zamanları örnek hassasiyetinde bilinir. Değerler en kötü durumdur; hiçbir testte
kaçırılan ya da sahte vuruş yok.

| Sinyal | En kötü hata |
|--------|--------------|
| Tek tel vuruşları, 8 farklı perde (Karplus-Strong) | 1,76 ms |
| Akor vuruşları (aşağı/yukarı), üst üste binen çınlama | 0,79 ms |
| Hızlı on altılıklar (160 BPM), değişen vuruş gücü | 2,71 ms |
| Beyaz gürültüde, SNR 30 dB / 20 dB | 0,13 ms / 2,79 ms |
| 44,1 kHz örnekleme | 1,28 ms |
| Boğuk teller (parlaklık 0,05) / yumuşak ataklı vuruşlar | 1,88 ms / 1,87 ms |
| Tarayıcıda uçtan uca: 16 vuruş, bilinen sapmalar (−25…+30 ms), girişte 80 ms yapay gecikme | 1,90 ms |
| Gecikme kalibrasyonu: 137 ms'lik geri dönüş yolu | 141 ms ölçüldü (+4 ms) |

Not: algılayıcının sabit gecikme düzeltmesi bu üretilmiş sinyallerle ayarlandı; gerçek gitarda birkaç ms'lik
sistematik fark olabilir ve bu fark gecikme kalibrasyonuyla birlikte giderilir.

### Akor tanıma (Aşama 7) — hedef: temiz sinyalde %90+

Sentez gitar sesi (Karplus-Strong), 108 aday akor arasından (12 kök × maj, min, 7, m7, maj7, sus2, sus4, 5, add9)
açık tanıma. "Doğru" = tanınan simge çalınan biçimin simgesiyle aynı. Vuruştan 0,5 sn sonra dinlenir (aksi yazılmadıkça).

| Koşul | Doğruluk |
|-------|----------|
| **Açık akorlar, temiz** — 29 akor × aşağı vuruş, yukarı vuruş, arpej | **%98,9** (86/87; tek hata: Gmaj7 → G) |
| **Bare akorlar, temiz** — 36 biçim × aşağı ve yukarı vuruş | **%100** (72/72) |
| **Power akorlar, temiz** — 24 biçim | **%100** (24/24) |
| Tüm gitar 12 cent pes / 12 cent tiz (açık + bare, 65 akor) | %98,5 / %100 |
| Tel başına rastgele ±8 cent akortsuzluk | %99,2 |
| Beyaz gürültü, SNR 20 dB / 10 dB | %100 / %100 |
| Boğuk ton / parlak ton | %100 / %100 |
| Vuruştan 0,2 sn sonra / 1,2 sn sonra (sönerken) | %100 / %95,4 |
| İki aday arasında seçim (geçiş egzersizi): 10 çift × 2 akor × 2 vuruş, 5 cent akortsuzluk + 25 dB gürültü | 40/40 doğru |
| Geçiş sayımı: Am ↔ C, 6 geçiş (birim testinde sentez ses; tarayıcıda canlı) | 6 / 6 sayıldı |

**Bu sayılar kendi sentez sesimizle ölçüldü ve iyimserdir.** Sentez telin harmonikleri düzgün, gövde rezonansı,
tel vızıltısı, amfi distorsiyonu yok. Sıkıştırma üssü (0,3) ve şablon ağırlıkları bu sinyallerle ayarlandı; gerçek
gitarda oranların daha düşük olması beklenir ve bu ölçülmedi.

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

### Aşama 5 — Backing track üretici
- 15 hazır dizi (12 ölçülük blues, I–V–vi–IV, ii–V–I, minör diziler, vamp'lar…) roma rakamlarından 12 tona çözülür.
- Kullanıcının kendi dizisi: `Am | F | C G | E7` yazımı, canlı önizleme, hatalı akor uyarısı, başka tona taşıma.
- Sentez grup: davul (kick, trampet, zil), bas, elektro piyano benzeri akor. Dört tarz: rock, blues (shuffle),
  pop, funk. Dizinin başında zil, son ölçüsünde geçiş.
- Tempo, ton, tarz, döngü, bir ölçü sayma, parti ses düzeyleri; hepsi çalarken değiştirilebilir.
- Ekranda şimdiki ve sıradaki akor, vuruş göstergesi, ölçü ızgarası.
- Tona ve diziye uygun gam önerileri, notalarıyla.

### Aşama 6 — Çalarken geri bildirim (ritim)
- Vuruş algılama: logaritmik spektral akı, AudioWorklet içinde; her vuruş ses saatindeki zamanıyla bildirilir.
- Ritim ekranı: metronomla ya da eşlik grubuyla birlikte çalma; dörtlük / sekizlik / üçleme / on altılık ya da
  bir vuruş kalıbı hedef alınır; bir ölçü sayma, 4/8/16 ölçü.
- Canlı gösterge: son vuruşların erken/geç şeridi, "12 ms erken" yazısı, vuruş sayacı.
- Oturum sonu özeti: isabet ve tutarlılık puanı, ortalama ve mutlak sapma, kaçırılan/fazla vuruş, eğilim yorumu,
  vuruş başına sapma grafiği. Sonuçlar saklanır; geçmiş grafiği ve listesi.
- Gecikme kalibrasyonu (Ayarlar): otomatik (hoparlör → mikrofon), çalarak (kulaklık / doğrudan bağlantı), elle.

### Aşama 7 — Çalarken geri bildirim (akor)
- Kroma çıkarımı (HPCP benzeri, spektral tepelerden) AudioWorklet içinde; ~43 ms'de bir.
- Akor tanıma: harmonikleri hesaba katan şablonlarla kosinüs benzerliği + bas notası; 108 aday akor.
- Akor dinleyici (Akorlar → Kütüphane): duyulan akoru gösterir; bir diyagrama dokununca o akorun doğru basılıp
  basılmadığını denetler. Dinlerken kart ekranın üstünde sabit kalır.
- Geçiş egzersizinde otomatik sayım: iki akor arasındaki her kararlı geçiş sayılır, duyulan akorun diyagramı
  vurgulanır; sayı sonunda yine elle düzeltilebilir.
- Şarkı modundaki "doğru akor" denetimi Aşama 9'da, şarkı moduyla birlikte bağlanacak (`isChordPlayed` hazır).

## Bilinen eksikler / hatalar

- **Kod GitHub'da (`MehmetKutlu32/guitar-coach`, `main`), ama site yayında değil.** 2026-11-15'te
  `https://mehmetkutlu32.github.io/guitar-coach/` 404 döndü; deponun herkese açık API'si de 404 döndü, yani depo
  büyük olasılıkla özel. Ücretsiz planda özel depodan Pages yayınlanmaz. Yayın için: depoyu herkese açık yap (ya da
  Pages destekleyen plan), sonra Settings → Pages → Source: **GitHub Actions**.
- **CI sonucu bu oturumdan okunamıyor** (`gh` giriş yapmamış, API 404). İş akışının Linux'ta başsız Chromium'da
  geçip geçmediği doğrulanmadı; GitHub'daki Actions sekmesinden bakılmalı.
- **Yayınlanmış site duman testi hiç çalıştırılamadı** (site yok). Site açılınca:
  `SMOKE_URL=https://mehmetkutlu32.github.io/guitar-coach/ npm run smoke`.
- Gerçek mikrofon/gitar ile ve gerçek hoparlörle elle deneme yapılmadı; tüm doğrulama üretilmiş sinyallerle.
- Akor tanıma yalnızca sentez sesle doğrulandı (yukarıdaki nota bak). Tanınmayan türler: dim, aug, 6, 9, m7b5 ve
  bölü akorları (C/G); bunlar en yakın tanınan türe yorumlanır.
- Akor tanımada da hoparlör sızıntısı sorunu var: eşlik çalarken mikrofon eşliğin akorunu da duyar.
- Ritim ölçümünde hoparlörden çıkan metronom/eşlik sesi mikrofona girerse vuruş sayılır; kulaklık ya da doğrudan
  bağlantı gerekir (ekranda uyarı var). Bunu ayıklayan bir yankı giderme yok.
- "Çalarak" gecikme ölçümü kullanıcının kendi zamanlama eğilimini de içerir; yalnızca otomatik ölçüm test edildi.
- Eşlik yalnızca 4/4'lük ölçüde. Seslerin tınısı kulakla değerlendirilmedi (yalnızca seviye ve zamanlama ölçüldü).
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
