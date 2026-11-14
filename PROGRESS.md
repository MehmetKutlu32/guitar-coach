# İlerleme

Son güncelleme: 2026-11-14 · Biten aşama: **1 / 16** · Sıradaki: **Aşama 2 — Metronom + ritim kalıpları**

Kurallar ve aşama tanımları için [CLAUDE.md](CLAUDE.md), kararlar için [DECISIONS.md](DECISIONS.md).

## Aşamalar

| # | Aşama | Durum |
|---|-------|-------|
| 1 | İskelet + akort aleti | ✅ bitti |
| 2 | Metronom + ritim kalıpları | ⏳ sırada |
| 3 | Akor kütüphanesi + geçiş egzersizi | — |
| 4 | Pratik günlüğü | — |
| 5 | Backing track üretici | — |
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
| Vitest (birim) | ✅ 21 / 21 |
| Playwright (mobil 390×844 + masaüstü 1440×900) | ✅ 20 / 20 |
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

## Aşama 1'de yapılanlar

- Vite + TypeScript (strict) + Preact iskeleti; koyu tema, mobilde alt çubuk, masaüstünde yan menü.
- Akort: YIN perde algılama (AudioWorklet), ibreli gösterge, nota + cent + Hz, 9 akort düzeni + kromatik,
  tele kilitlenme, referans tel sesi (Karplus-Strong), akortlanan telleri işaretleme.
- Ayarlar: dil (TR/EN), giriş cihazı seçimi, giriş seviyesi göstergesi, A4 referansı, JSON dışa/içe aktarma.
- IndexedDB veri katmanı, i18n altyapısı, hash yönlendirme.
- PWA: manifest, ikonlar, elle yazılmış service worker; çevrimdışı açılış testle doğrulandı.
- CI/yayın iş akışı: `.github/workflows/deploy.yml`.

## Bilinen eksikler / hatalar

- **GitHub'a push edilmedi, site yayınlanmadı.** `gh` CLI bu makinede giriş yapmamış. Tüm commit'ler yerelde.
  Kurulum komutları README'de. Her aşama sonunda `gh auth status` yeniden denetleniyor.
- **CI iş akışı hiç çalışmadı** (yukarıdaki nedenle); Linux'ta başsız Chromium'da ses testlerinin geçtiği doğrulanmadı.
- Gecikme kalibrasyonu henüz yok; Aşama 6'da eklenecek (bkz. DECISIONS.md).
- Gerçek mikrofon/gitar ile elle deneme yapılmadı; tüm doğrulama üretilmiş sinyallerle.

## Devam edecek kişi için notlar

- Yeni ekran eklemek: `src/features/<ad>/` altında bileşen + saf mantık, sonra `src/features/registry.ts`'e kayıt,
  `src/ui/Icon.tsx`'te ikon, `src/i18n/tr.ts` ve `en.ts`'e metinler.
- Ses girişi: `acquireInput()` + `onAnalysis()` (`src/audio/input.ts`). Yeni analiz türleri `analyzer.worklet.ts`'e
  eklenir, saf DSP `src/dsp/` altında tutulur ve Vitest ile sınanır.
- Uçtan uca testlerde farklı giriş sinyali için `useSyntheticInput()` (`tests/e2e/helpers.ts`).
- Windows'ta Git Bash heredoc'ları ters eğik çizgi ve tırnakları bozabiliyor; dosyaları doğrudan yaz.
