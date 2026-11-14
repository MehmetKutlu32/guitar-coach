# Gitar Çalışma Uygulaması (PWA) — Otonom Geliştirme

## Amaç
Elektro gitar öğrenen biri için, telefonda ve bilgisayarda çalışan, çevrimdışı kullanılabilen bir
gitar çalışma uygulaması yaz. Uygulama sadece araç kutusu değil; kullanıcıyı dinleyen, ona eşlik eden
ve çalışmasını planlayan bir çalışma arkadaşı olmalı.
Kullanıcı müdahale etmeyecek: kararları sen ver, her aşamayı testlerle kendin doğrula.

## Kesin kurallar
- Kullanıcıya soru sorma. Belirsiz bir noktada makul kararı ver ve `DECISIONS.md`'ye nedeniyle yaz.
- Bir aşama, testleri geçmeden bitmiş sayılmaz. Çalıştır, ekran görüntüsü al, kendin bak.
- Her aşama sonunda: `npm run build` + tüm testler → `git commit` → `PROGRESS.md` güncelle.
- Aşamaları SIRAYLA yap. Oturum her an kesilebilir; her commit'te uygulama kullanılabilir durumda olsun.
  Yarım kalmış bir özelliği ana akışta görünür bırakma (gerekirse özellik bayrağıyla gizle).
- Telifli şarkı sözü, tab veya nota ekleme. Hazır içerik olarak sadece kendi yazdığın egzersizler
  ve telifsiz (public domain) örnekler olsun.
- Dış ses dosyası kullanma: tüm sesleri Web Audio ile üret (gitar için Karplus-Strong, davul ve bas
  için sentez).
- Takılırsan aynı yaklaşımı tekrar tekrar deneme; sorunu küçült, izole test yaz, kök nedeni bul.
- Verimli çalış: gereksiz yere büyük dosyaları baştan okuma, sadece ilgili testleri sık çalıştır,
  tüm test setini aşama sonunda çalıştır.

## Teknoloji
- Dil: TypeScript (strict), HTML, CSS. Framework seçimi senin; hafif tut.
- Ses: Web Audio API. Gerçek zamanlı analiz (pitch, onset, akor tanıma) AudioWorklet içinde çalışsın.
  Performans yetmezse ilgili DSP kodunu Rust → WebAssembly'ye taşıyabilirsin; kararı DECISIONS.md'ye yaz.
- Giriş: `getUserMedia`. Ayarlarda ses giriş cihazı seçilebilsin (USB ses çıkışlı amfi veya ses kartı
  doğrudan bağlanabilsin), giriş seviyesi göstergesi ve gecikme kalibrasyonu olsun.
- Veri: IndexedDB. Sunucu yok. Tüm veriler JSON olarak dışa/içe aktarılabilsin.
- PWA: manifest + service worker; tamamen çevrimdışı çalışsın, ana ekrana eklenebilsin.
- Arayüz dili: Türkçe varsayılan, İngilizce seçenek (i18n altyapısı ilk aşamadan itibaren).
- Test: Vitest (birim), Playwright (uçtan uca + ekran görüntüsü; 390x844 mobil, 1440x900 masaüstü).
- Tasarım: koyu tema, büyük dokunma hedefleri, gitar kucaktayken tek elle kullanılabilir.

## Aşamalar (öncelik sırasına göre)

### Katman 1 — Temel araçlar
1. **İskelet + Akort aleti** — Pitch detection (YIN veya benzeri), nota + cent göstergesi,
   standart akort ve alternatifler (Drop D, yarım ton düşük vb.), giriş cihazı seçimi.
   Doğrulama: üretilmiş sinüs ve Karplus-Strong tonlarında ±2 cent doğruluk; gürültüde kararlılık.
2. **Metronom + ritim kalıpları** — Web Audio zamanlamasıyla kaymayan tıklar, vurgu, ölçü tipleri,
   tap tempo, tempo antrenörü (her N ölçüde hızlanma). Strumming kalıplarını (aşağı/yukarı)
   metronomla senkron gösterme, kullanıcının kendi kalıbını oluşturması.
   Doğrulama: planlanan tık zamanlarının sapması testle ölçülsün.
3. **Akor kütüphanesi + geçiş egzersizi** — SVG akor diyagramları (açık, barre, power chord),
   sentez gitar sesiyle çalma, iki akor arası 1 dakikalık geçiş egzersizi, sonuç geçmişi ve grafiği.
4. **Pratik günlüğü** — Oturum zamanlayıcı, egzersiz bazında süre, günlük seri, haftalık/aylık grafikler.

### Katman 2 — Çalışma arkadaşı
5. **Backing track üretici** — Akor dizisi seçimi (12 ölçülük blues, I–V–vi–IV, ii–V–I vb. hazır
   şablonlar + kullanıcının kendi dizisi), sentez davul + bas + akor, tempo/ton/tarz ayarı, döngü.
   Ekranda o anki ve sıradaki akor, o tona uygun gam önerisi.
6. **Çalarken geri bildirim — ritim** — Onset detection ile vuruşları algılama, metronoma/backing
   track'e göre erken/geç sapma (ms), tutarlılık skoru, oturum sonu özet ve görselleştirme.
   Doğrulama: bilinen zamanlarda üretilmiş vuruş sinyalleriyle ±10 ms doğruluk.
7. **Çalarken geri bildirim — akor** — Kroma/HPCP tabanlı akor tanıma; geçiş egzersizinde ve şarkı
   modunda "doğru akor basıldı mı" kontrolü, geçiş egzersizinin otomatik sayılması.
   Doğrulama: sentezlenmiş akorlarla (farklı çalış biçimleri, hafif detune, gürültü) doğruluk oranı
   ölçülüp PROGRESS.md'ye yazılsın; hedef temiz sinyalde %90+.
8. **Akıllı günlük plan** — İlk açılışta kısa seviye testi; geçmiş sonuçlara göre (zayıf geçişler,
   ritim skoru, çalışılmayan konular) her gün 15/30/45 dakikalık plan üretimi. Kural tabanlı, sunucusuz.

### Katman 3 — İçerik ve derinlik
9. **Şarkı modu** — ChordPro formatında şarkı girme/düzenleme, akorları sözlerin üstünde gösterme,
   tempoya göre otomatik kaydırma, transpoze, capo; backing track ile birlikte çalma.
10. **Tab editörü ve oynatıcı** — Tab yazma/düzenleme, sentez gitar sesiyle çalma, yavaşlatma,
    bölüm döngüsü, kendi riff kütüphanesi.
11. **Fretboard ve teori** — İnteraktif sap: gamlar, modlar, arpejler, CAGED; sapta nota ezberleme oyunu.
12. **Kulak eğitimi** — Aralık ve akor tipi tanıma, seviye sistemi, skor takibi.

### Katman 4 — Ekstralar (zaman kalırsa)
13. **Kayıt ve karşılaştırma** — Çalışmayı kaydetme, dalga formu, eski kayıtla yan yana dinleme.
14. **Kendi ses dosyasıyla çalışma** — Kullanıcının yüklediği dosyayı tonu bozmadan yavaşlatma,
    A-B döngü, ton değiştirme.
15. **Oyunlaştırma** — XP, rozetler, günlük görevler (pratik günlüğü ve geri bildirim verilerine bağlı).
16. **Canlı efektler** — Giriş sinyaline distortion, delay, reverb; gecikme göstergesiyle.

## Yayınlama (GitHub Pages)
- Katman 1'in 1. aşamasında `.github/workflows/deploy.yml` ekle: `main`'e her push'ta testleri çalıştır,
  geçerse build alıp GitHub Pages'e yayınla (actions/deploy-pages). Testler kalırsa yayınlama.
- Vite `base` ayarını repo adına göre yap (`/repo-adi/`); manifest `start_url`/`scope` ve service worker
  kapsamı da buna uysun. Yayınlanan sitede PWA kurulumu ve çevrimdışı açılış çalışmalı.
- `gh` CLI giriş yapmışsa repoyu `gh repo create` ile oluştur ve Pages'i Actions kaynağıyla etkinleştir;
  giriş yapılmamışsa bu adımı atla, gerekli komutları README'ye yaz ve diğer aşamalara devam et.
- Her aşama sonunda push et; yayınlanan siteyi Playwright ile açıp temel duman testi (smoke test) yap.

## Doğrulama
- Her commit öncesi build hatasız, Vitest ve Playwright yeşil olmalı.
- Her arayüz değişikliğinden sonra iki ekran boyutunda ekran görüntüsü al ve görüntüye kendin bak:
  taşma, okunmayan metin, küçük dokunma hedefi olmasın.
- Ses analizi testlerinde gerçek mikrofon yerine üretilmiş sinyal kullan
  (OfflineAudioContext / sahte MediaStream).

## İlerleme takibi
- `PROGRESS.md`: biten aşamalar, test sonuç tablosu, ölçülen doğruluk oranları, bilinen hatalar,
  sıradaki adım. Oturum yarıda kesilirse başka bir model kaldığı yerden devam edebilsin diye güncel tut.
- `DECISIONS.md`: önemli kararlar ve nedenleri.
- `README.md`: kurulum, geliştirme sunucusu, testler, telefona yükleme (PWA) ve amfiyi/ses kartını
  bağlama talimatları.
