# Gitar Çalışma

Elektro gitar çalışanlar için telefonda ve bilgisayarda çalışan, **çevrimdışı kullanılabilen** bir çalışma uygulaması
(PWA). Sunucu yok: tüm veriler cihazında kalır, tüm sesler tarayıcıda üretilir.

Hangi özelliklerin hazır olduğu için [PROGRESS.md](PROGRESS.md), tasarım kararları için [DECISIONS.md](DECISIONS.md).

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

Yayınlanmış siteyi sınamak için:

```bash
SMOKE_URL=https://KULLANICI.github.io/guitar-coach/ npm run smoke
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

Pages'in çalışması için depo ayarlarında bir kez **Settings → Pages → Build and deployment → Source: GitHub Actions**
seçilmiş olmalı. `gh` CLI ile aynı ayar:

```bash
gh api -X POST repos/MehmetKutlu32/guitar-coach/pages -f build_type=workflow
```

Depoyu başka bir adla çatallarsan ek ayar gerekmez: iş akışı Vite `base` yolunu repo adından üretir; yerelde aynı
yolu kullanmak için `BASE_PATH=/yeni-ad/` ortam değişkenini ver.

Commit mesajları İngilizce yazılır.

## Proje yapısı

```
src/
  audio/        AudioContext, giriş yönetimi, AudioWorklet, sentez (Karplus-Strong)
  dsp/          saf DSP kodu: FFT, YIN perde algılama, nota hesapları
  db/           IndexedDB katmanı, dışa/içe aktarma
  features/     ekranlar (akort, ayarlar, …) ve saf mantıkları
  i18n/         Türkçe ve İngilizce metinler
  ui/           ortak arayüz parçaları
tests/unit/     Vitest
tests/e2e/      Playwright
tests/smoke/    yayınlanmış site için duman testi
```
