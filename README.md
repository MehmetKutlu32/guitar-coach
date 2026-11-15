# Gitar Çalışma

Elektro gitar çalışanlar için telefonda ve bilgisayarda çalışan, **çevrimdışı kullanılabilen** bir çalışma uygulaması
(PWA). Sunucu yok: tüm veriler cihazında kalır, tüm sesler tarayıcıda üretilir.

Ayrıntılı durum, ölçülen doğruluk oranları ve bilinen eksikler için [PROGRESS.md](PROGRESS.md), tasarım kararları
için [DECISIONS.md](DECISIONS.md).

## Özellikler

| Ekran | Ne yapar |
|-------|----------|
| Ana sayfa | Seviye testi, 15 / 30 / 45 dakikalık günlük plan |
| Akort | YIN perde algılama, nota + cent göstergesi, standart ve alternatif akortlar (Drop D, yarım ton pes…) |
| Metronom | Kaymayan tıklar, vurgu, ölçü tipleri, tap tempo, tempo antrenörü, vuruş (strumming) kalıpları |
| Akorlar | Açık, bare ve power akor diyagramları, geçiş egzersizi, mikrofonla akor tanıma ve otomatik sayım |
| Eşlik | Sentez davul + bas + akorla backing track; hazır diziler ya da kendi dizin, tona uygun gam önerisi |
| Ritim | Çalarken vuruş algılama, erken/geç sapma (ms), tutarlılık puanı, oturum özeti |
| Şarkılar | ChordPro düzenleyici, akorlar sözlerin üstünde, transpoze, kapo, eşlikle otomatik kaydırma |
| Tab | Tab yazma, sentez gitarla çalma, yavaşlatma, bölüm döngüsü, riff kütüphanesi |
| Sap ve teori | Gamlar, modlar, arpejler, CAGED, sapta nota ezberleme oyunu |
| Kulak eğitimi | Aralık ve akor türü tanıma, seviyeler, skor takibi |
| Kayıt | Çalışmanı kaydetme, dalga formu, iki kaydı yan yana dinleme (A/B) |
| Ses dosyası | Kendi dosyanı tonu bozmadan yavaşlatma, ton değiştirme, A–B döngüsü |
| Günlük | Oturum zamanlayıcı, egzersiz bazında süre, günlük seri, haftalık/aylık grafikler |
| Ayarlar | Dil (TR/EN), giriş cihazı, seviye göstergesi, gecikme kalibrasyonu, JSON yedekleme |

Hazır içerik (egzersizler, çalışma şarkıları, riff'ler) bu uygulama için yazıldı; telifli söz, tab ya da nota yoktur.

## Kurulum

Node.js 22 ya da üstü gerekir.

```bash
npm install
npx playwright install chromium   # yalnızca uçtan uca testler için
```

## Geliştirme

```bash
npm run dev        # geliştirme sunucusu: http://localhost:5173/guitar-coach/
npm run build      # tür denetimi + üretim derlemesi (dist/)
npm run preview    # derlenmiş sürümü sun: http://localhost:4173/guitar-coach/
```

Mikrofon yalnızca güvenli bağlamda (`https://` ya da `localhost`) çalışır. Telefonda denemek için yayınlanmış siteyi
kullan ya da bilgisayardaki sunucuyu HTTPS tüneliyle aç.

## Testler

```bash
npm test           # birim testleri (Vitest): DSP, veri katmanı, mantık
npm run e2e        # uçtan uca (Playwright): 390×844 mobil + 1440×900 masaüstü
npm run check      # build + birim + uçtan uca
```

- Ses analizi testleri gerçek mikrofon kullanmaz: sinyaller kodla üretilir (sinüs, Karplus-Strong, gürültü).
- Uçtan uca testler Chromium'un sahte mikrofonuna üretilmiş bir WAV dosyası verir.
- Her test çalışmasında ekran görüntüleri `screenshots/mobile` ve `screenshots/desktop` altına yazılır.

Yayınlanmış siteyi sınamak için (bash):

```bash
SMOKE_URL=https://mehmetkutlu32.github.io/guitar-coach/ npm run smoke
```

Windows PowerShell'de:

```powershell
$env:SMOKE_URL = "https://mehmetkutlu32.github.io/guitar-coach/"; npm run smoke
```

## Telefona yükleme (PWA)

1. Yayınlanmış siteyi telefonun tarayıcısında aç.
2. **Android (Chrome):** menü → *Ana ekrana ekle* / *Uygulamayı yükle*.
   **iPhone (Safari):** Paylaş düğmesi → *Ana Ekrana Ekle*.
3. İlk açılıştan sonra uygulama internet olmadan da açılır. *Ayarlar → Hakkında* altında "Çevrimdışı kullanıma hazır"
   yazısını görürsün.

## Amfiyi ya da ses kartını bağlama

Uygulama herhangi bir ses girişini dinleyebilir. Mikrofonla da çalışır, ama doğrudan bağlantı daha temiz sinyal verir.

1. **USB çıkışlı amfi** ya da **ses kartı** (audio interface) kullan: gitarı amfiye/ses kartına, onu da USB ile
   bilgisayara ya da (OTG/USB-C adaptörüyle) telefona bağla.
2. Uygulamada *Ayarlar → Ses girişi → Giriş cihazı* listesinden cihazı seç. Cihaz adları mikrofon izni verildikten
   sonra görünür; görünmüyorsa önce *Girişi test et*'e bas.
3. *Girişi test et* ile seviye göstergesine bak: çalarken çubuk hareket etmeli, en sert vuruşlarda kırmızıya
   dayanmamalı. Dayanıyorsa amfinin/ses kartının giriş kazancını kıs.
4. Ses kartında gitar 2. girişe takılıysa da sorun yok; kanalların ortalaması dinlenir.

Tarayıcının konuşma için yaptığı yankı engelleme, gürültü bastırma ve otomatik kazanç ayarı kapatılır; enstrüman sesi
olduğu gibi analiz edilir.

## GitHub Pages'te yayınlama

`.github/workflows/deploy.yml`, `main` dalına her push'ta testleri çalıştırır; hepsi geçerse siteyi GitHub Pages'e
yayınlar. Testler kalırsa yayınlamaz.

Depo: <https://github.com/MehmetKutlu32/guitar-coach> · Site: <https://mehmetkutlu32.github.io/guitar-coach/>

> **Şu anki durum:** site henüz yayında değil. Depo özel; GitHub'ın ücretsiz planında özel depodan Pages
> yayınlanmaz. Yayınlamak için depoyu herkese açık yap (ya da Pages destekleyen bir plana geç), sonra aşağıdaki
> ayarı yap.

Pages'in çalışması için depo ayarlarında bir kez **Settings → Pages → Build and deployment → Source: GitHub Actions**
seçilmiş olmalı. `gh` CLI ile aynı ayar:

```bash
gh api -X POST repos/MehmetKutlu32/guitar-coach/pages -f build_type=workflow
```

Depoyu başka bir adla çatallarsan ek ayar gerekmez: iş akışı Vite `base` yolunu repo adından üretir; yerelde aynı
yolu kullanmak için `BASE_PATH=/yeni-ad/` ortam değişkenini ver.

## Proje yapısı

```
src/
  audio/        AudioContext, giriş, metronom ve saat, kayıt, AudioWorklet'ler
                (analyzer: perde / vuruş / kroma · stretch: zaman esnetme), sentez (Karplus-Strong, davul, bas)
  dsp/          saf DSP kodu: FFT, YIN, vuruş algılama, kroma, WSOLA zaman esnetme
  music/        müzik teorisi: akorlar, gamlar, diziler, akor tanıma, ChordPro, tab, sap, kulak eğitimi
  db/           IndexedDB katmanı, dışa/içe aktarma
  features/     ekranlar (her biri bir klasör) ve saf mantıkları; kayıt: features/registry.ts
  i18n/         Türkçe ve İngilizce metinler
  ui/           ortak arayüz parçaları (sap, dalga formu, grafikler, ikonlar)
  styles/       CSS (koyu tema)
tests/unit/     Vitest
tests/e2e/      Playwright
tests/smoke/    yayınlanmış site için duman testi
```

## Katkı

- Commit mesajları İngilizce yazılır.
- Her commit öncesi `npm run check` (build + birim + uçtan uca) yeşil olmalı.
- Yeni ekran eklemek ve test kancaları için [PROGRESS.md](PROGRESS.md) → "Devam edecek kişi için notlar".
