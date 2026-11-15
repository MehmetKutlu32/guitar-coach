# İlerleme

Son güncelleme: 2026-11-16 · Biten aşama: **14 / 16** (Katman 1, 2 ve 3 tamam) · Sıradaki: **Aşama 15 — Oyunlaştırma**

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
| 8 | Akıllı günlük plan | ✅ bitti |
| 9 | Şarkı modu | ✅ bitti |
| 10 | Tab editörü ve oynatıcı | ✅ bitti |
| 11 | Fretboard ve teori | ✅ bitti |
| 12 | Kulak eğitimi | ✅ bitti |
| 13 | Kayıt ve karşılaştırma | ✅ bitti |
| 14 | Kendi ses dosyasıyla çalışma | ✅ bitti |
| 15 | Oyunlaştırma | ⏳ sırada |
| 16 | Canlı efektler | — |

## Test sonuçları (son çalıştırma)

| Paket | Sonuç |
|-------|-------|
| `npm run build` (tsc strict + vite) | ✅ |
| Vitest (birim) | ✅ 218 / 218 |
| Playwright (mobil 390×844 + masaüstü 1440×900) | ✅ 116 / 116 |
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

### Zaman esnetme ve ton değiştirme (Aşama 14)

WSOLA + yeniden örnekleme (`src/dsp/stretch.ts`), 44,1 kHz, üretilmiş sinyaller. Değerler en kötü durumdur.

| Ölçüm | Sonuç |
|-------|-------|
| Hız ×0,5 – ×1,5, sinüs 82–880 Hz: perde sapması | en fazla 0,67 cent; genlik kararlılığı 0,97 |
| Hız ×0,5, Karplus-Strong tel: özgün sese göre perde sapması | 0,40 cent |
| Ton −12 … +12 yarım ton (hız ×1): istenen perdeden sapma | en fazla 0,43 cent; süre değişmiyor |
| Hız ×1, ton 0 | sinyal örnek örnek aynı (fark < 1e-5) |
| Çalınmış nota dizisi: vuruşlar arası sürelerin sapması (çıkış zamanı) | ×0,5: 7,8 ms · ×0,75: 8,9 ms · ×1,25: 11,7 ms |
| Kısa vuruşların (4 ms gürültü patlaması) derli topluluğu, ×0,5 (1 = tek vuruş) | vuruş korumalı 0,91 · korumasız 0,48 (çift vuruş) |
| İşlem hızı (masaüstü, tek çekirdek) | gerçek zamanın en az 106 katı |
| Uçtan uca (tarayıcıda, worklet): %50 hızda konum ilerleme hızı | 0,496 – 0,503 (beklenen 0,5) |
| Uçtan uca: %50 hızda 440 Hz bölümün çıkış perdesi | 439,8 – 440,5 Hz |
| Uçtan uca: +2 yarım ton (beklenen 493,88 Hz) | 493,2 – 494,1 Hz |

Bu ölçümler tek sesli ve temiz sinyallerle yapıldı; gerçek, çok sesli ve davullu kayıtlarda kalite kulakla
değerlendirilmedi (aşağıdaki "bilinen eksikler"e bak).

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

### Aşama 8 — Akıllı günlük plan
- İlk açılışta ana sayfada karşılama kartı ve 6 soruluk seviye testi (atlanabilir, sonradan yeniden yapılabilir).
- Ana sayfada "Bugünün planı": 15 / 30 / 45 dakika; her maddenin süresi, neden seçildiği ve "Başla" düğmesi.
  "Başla", ilgili aracı planın ayarlarıyla (akor çifti, tempo, dizi, ton) açar.
- Kurallar (sunucusuz, saf fonksiyon): hedefin altındaki en zayıf akor çifti → sıradaki yeni çift → en uzun
  süredir çalışılmayan; ritimde son üç ölçümün isabetine göre yavaşlat / pekiştir / zorlaştır ve erken–geç
  eğilimi; bu hafta hiç çalışılmayan konuya ek dakika; hedefe (akor / solo) göre dakika kaydırma; eşlik dizisi
  seviyeye göre ve günden güne değişir.
- Maddeler elle işaretlenir; bugün kaydedilen geçiş ve ritim sonuçları maddeyi kendiliğinden tamamlar.

### Aşama 9 — Şarkı modu
- ChordPro ayrıştırıcı: başlık, sanatçı, ton, tempo, kapo, yorum ve bölüm (kıta / nakarat / köprü) yönergeleri.
- Akorlar sözlerin tam üstünde; yazı boyutu ayarı; şarkıdaki akorların diyagramları (dokununca çalar).
- Transpoze (±11 yarım ton) ve kapo (gösterilen akor = basılan biçim; duyulan ton değişmez).
- "Çal ve kaydır": bir ölçü sayar, geçerli akoru vurgular, geçerli satırı ekranın ortasında tutar, şarkı
  bitince durur. Grup eşlik eder ya da (kapatılırsa) yalnızca metronom tıkı çalar; tarz ve tempo seçilir.
- Akor denetimi (isteğe bağlı): çalarken doğru basılan akorlar yeşile döner, sonunda isabet gösterilir.
- Şarkı ekleme / düzenleme (canlı önizleme, tanınmayan akor uyarısı) / silme; hazır şarkıyı kopyalayıp düzenleme.
- Üç hazır çalışma şarkısı; sözleri ve akor düzenleri bu uygulama için yazıldı.

### Aşama 10 — Tab editörü ve oynatıcı
- Tab ızgarası: 4/4, ölçü başına 16 adım; ölçüler ekran genişliğine göre alt alta dizilir.
- Yazma: büyük tuş takımı (0–9, +10, x, sil, oklar), "yazınca ilerle", hücreye dokunarak imleç taşıma, masaüstünde
  klavye (rakamlar, oklar, x, Sil); ölçü ekleme/silme; ad ve tempo.
- Oynatıcı: sentez gitar sesi (nota, aynı teldeki sonraki notaya kadar sürer; susturulmuş nota), bir ölçü sayma,
  metronom tıkı, çalınan adımın vurgulanması, tab bitince durma.
- Yavaşlatma (%50 / %75 / %100, çalarken de değişir) ve bölüm döngüsü (başlangıç–bitiş ölçüsü).
- Riff kütüphanesi: kendi tabların (kaydet / düzenle / sil) + 5 hazır teknik egzersiz (kopyalanıp düzenlenebilir).

### Aşama 11 — Fretboard ve teori
- "Sap ve teori" ekranı, dört bölüm: Gamlar, Arpejler, CAGED, Oyun. Seçimler kalıcı.
- İnteraktif sap (SVG, 12 perdelik pencere: 0–12, 6–17, 13–24): noktalarda nota adı ya da derece, kök notalar
  turuncu; noktaya dokununca o nota sentez gitar sesiyle çalınır (dokunma alanı perde hücresinin tamamı).
- Gamlar ve modlar: 12 kök × `src/music/scales.ts`'teki tüm gamlar; nota/derece satırı, aralık formülü
  (tam/yarım), modlarda "hangi majör gamın kaçıncı derecesi" açıklaması, gamı çıkıp inerek çalma.
- Arpejler: 12 akor türü (maj, min, 7, maj7, m7, m7b5, dim, dim7, aug, sus4, 6, 9), nota ve derece gösterimi, çalma.
- CAGED: beş biçim (C, A, G, E, D) her kök için sapta; akor notaları parlak, çevredeki majör gam notaları soluk;
  pencere biçimin bulunduğu bölgeye kendiliğinden kayar.
- Nota ezberleme oyunu: "notayı adlandır" (sapta işaretli nota) ve "perdeyi bul" (tel + nota verilir); 10 soruluk
  tur, 0–5 / 0–12. perde, yalnızca doğal notalar seçeneği; doğru/yanlış geri bildirimi (yanlışta doğrusu 1,4 sn
  gösterilir), tur özeti ve kaçırılan notalar; ayar başına en iyi / son / tur sayısı / en hızlı (IndexedDB `results`).
- Günlükte ayrı egzersiz türü: "Sap ve teori".

### Aşama 12 — Kulak eğitimi
- "Kulak eğitimi" ekranı, iki tür: aralık tanıma ve akor türü tanıma. Sesler sentez gitar (Karplus-Strong).
- Seviye sistemi (tür başına 6 seviye): aralıklarda B3/T5/T8'den 12 aralığın tamamına, çıkıcı → inici → birlikte
  çalınışa; akorlarda maj/min'den 11 türe (7, maj7, m7, sus2, sus4, dim, aug, m7b5, dim7). Bir seviyede tam turda
  (10 soru) en az 8 doğru, sonraki seviyeyi açar. İlerleme kayıtlı sonuçlardan türetilir (ayrı durum yok), bu
  yüzden yedekten içe aktarılan veriyle de doğru çalışır.
- Tur: soru kendiliğinden çalınır, "Tekrar dinle"; akorlarda notaları "tek tek" dinleme ipucu. Doğruda kendiliğinden
  ilerler; yanlışta doğru yanıt yeşil, seçilen kırmızı işaretlenir, "Seçtiğini dinle" ile iki ses aynı kökten
  karşılaştırılır, "Sonraki" ile ilerlenir. Tur soruları dengeli dağıtılır, art arda aynı kökten soru gelmez.
- Seviye tanıtımı: o seviyede sorulan türler; dokununca örneği çalınır.
- Skor takibi: seviye başına en iyi / son / ortalama / tur sayısı ve tur puanları grafiği; tüm seviyelerden tür
  başına doğruluk çubukları (en zayıf başta). Sonuçlar IndexedDB `results` deposunda (`type: 'ear'`).
- Günlükte ayrı egzersiz türü: "Kulak eğitimi". Türkçe (K3, T5…) ve İngilizce (m3, P5…) aralık adları.

### Aşama 13 — Kayıt ve karşılaştırma
- "Kayıt" ekranı: Ayarlar'da seçili girişten kayıt (MediaRecorder; Opus/WebM, desteklenmezse MP4), süre sayacı,
  canlı seviye izi ve seviye çubuğu, "Durdur ve kaydet" / "Vazgeç"; en uzun 10 dakika (kendiliğinden durur).
- Kayıt bitince ses çözülür; süre, dalga formu (240 tepe değeri) ve en yüksek seviye hesaplanıp kayıtla saklanır.
  Uyarılar: çok kısa (saklanmaz), sessiz kayıt, kırpılma (seviye çok yüksek).
- Kayıt listesi (ad, tarih, süre, küçük dalga formu, toplam boyut); seçili kayıtta büyük dalga formu, çalma /
  durdurma, dalga formuna dokunarak konum seçme, ad değiştirme, silme.
- Yan yana dinleme: seçili kayıt (A) başka bir kayıtla (B) karşılaştırılır; iki dalga formu alt alta, ikisi aynı
  andan birlikte çalar, çalarken A/B düğmesiyle duyulan kayıt kesintisiz değişir.
- Saklama: özet `items` deposunda (`type: 'recording'`), ses `blobs` deposunda base64 metin olarak — JSON
  dışa/içe aktarmada kayıtlar da taşınır.

Ölçüm (uçtan uca, üretilmiş 220 Hz giriş): kayıt çözülünce ortasındaki perde 219,9–220,1 Hz, ~1,7 sn'lik kayıt
~21 kB (~12 kB/sn). Çalarken çıkıştaki perde 220 Hz ±3; A/B geçişinde çıkış 220 ↔ 330 Hz arasında değişiyor.

### Aşama 14 — Kendi ses dosyasıyla çalışma
- "Ses dosyası" ekranı: cihazdan ses dosyası seçme (tarayıcının çözebildiği biçimler: MP3, WAV, M4A, OGG…;
  en çok 20 MB ve 12 dakika), dalga formu, konum (onda bir saniye), çal / duraklat, ±5 sn atlama, dalga formuna
  dokunarak konum seçme.
- Tonu bozmadan hız: %25–%150 (5'lik adımlar, %50 / %75 / %100 kısayolları); çalarken değişir.
- Hızı bozmadan ton: −12 … +12 yarım ton; çalarken değişir.
- A–B döngüsü: o anki konumu A / B olarak işaretleme, döngü bölgesi dalga formunda vurgulu, döngü dönüşü çapraz
  geçişli (tıkırtısız), döngüyü kaldırma. Atlama düğmeleri döngü içinde kalır.
- Parça kütüphanesi: dosya cihazda saklanır (`items` + `blobs`, base64), hız / ton / döngü ayarları parçayla
  birlikte kalıcıdır; parça silme. Saklama başarısız olursa parça o oturumda yine de çalınır.
- Motor: gerçek zamanlı WSOLA zaman esnetme + kübik yeniden örnekleme, AudioWorklet içinde
  (`src/audio/stretch.worklet.ts`); vuruş koruma (ataklar özgün hızda geçilir, çiftlenmez).
- Ölçümler: yukarıda "Zaman esnetme ve ton değiştirme" tablosu.

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
- **Aşama 9 ve sonrası GitHub'a gönderilmedi** (kullanıcı isteği, 2026-11-15: "push atma"). Commit'ler yerelde;
  `git status -sb` kaç commit ileride olduğunu gösterir.
- **Aşama 11–14 de yalnızca yerelde commit edildi, push edilmedi** (aynı kullanıcı isteği).
- Ses dosyası: esnetme kalitesi yalnızca ölçümle doğrulandı, **gerçek müzik kaydıyla kulakla dinlenmedi**.
  WSOLA zaman alanında çalışır; yoğun çok sesli miksajlarda ve %50'nin altındaki hızlarda pürüz/yankılanma,
  büyük ton kaydırmalarda (±5 yarım ton üstü) tını değişimi (formant kayması) beklenir. Ses tek kanala indirilir
  (stereo yok). Dosyanın tamamı bellekte çözülür (12 dakika ≈ 130 MB geçici bellek); telefonda büyük dosyalarda
  yük ve bellek ölçülmedi. Biçim desteği tarayıcıya bağlı. Sesler base64 saklandığı için JSON yedeği büyür.
  Döngü uçları yalnızca "şimdiki konum"dan ayarlanır (ince ayar düğmesi yok); döngü tempoya/ölçüye hizalanmaz.
- **Günlük ve plan uçtan uca testleri gece yarısını geçerken kalabilir** (gerçek saate göre "bugün"ü kullanıyorlar;
  2026-11-15 23:59'da başlayan tam çalıştırmada mobilde 2 test kaldı, hemen yeniden çalıştırınca geçti).
  Uygulama hatası değil; testler sabit saatle (`page.clock`) çalışacak biçimde düzeltilmedi.
- Kayıt: yalnızca başsız Chromium'da sınandı (Opus/WebM). Safari/iOS'ta MediaRecorder MP4/AAC üretir; bu yol
  ve gerçek mikrofonla kayıt denenmedi. Kayıt yalnızca kendi ekranı açıkken alınır (ekrandan çıkınca atılır);
  metronom ya da eşlikle birlikte kayıt, kırpma (trim), ses dosyası olarak dışa aktarma yok. Sesler base64
  saklandığı için çok kayıtta JSON yedeği büyür (dakikası ~1 MB); depolama kotası dolarsa yalnızca "saklanamadı"
  uyarısı çıkar. A/B karşılaştırmada kayıtlar hizalanmaz (ikisi de kendi başından başlar).
- Kulak eğitimi: çalınan seslerin doğruluğu yalnızca saf fonksiyon düzeyinde sınandı (hangi notalar, ne zaman);
  uçtan uca testler yalnızca "ses çıktı" diye bakıyor, perdeyi ölçmüyor. Akorlar hep kök konumunda ve dar
  dizilimde (çevrim, açık dizilim yok); melodi/ritim dikte, gam tanıma ve mikrofonla (çalarak) yanıt yok.
  Yarıda bırakılan tur kaydedilmez. Günlük plan henüz kulak eğitimi önermiyor.
- Sap ve teori: yalnızca standart akort (alternatif akortlarda sap gösterilmez); CAGED yalnızca majör akor
  biçimleri (minör biçimler yok); oyun mikrofonla çalarak yanıtlanamıyor (yalnızca düğmeyle), zaman sınırı yok;
  günlük plan henüz gam/oyun önermiyor. Mobilde sap noktalarının dokunma alanı ~24×22 px (12 perde 390 px'e
  sığdığı için 44 px mümkün değil); asıl etkileşimler büyük düğmelerle yapılır.
- Tab: yalnızca 4/4 ve on altılık ızgara (üçleme yok); çekiç, kaydırma, bend gibi teknik işaretleri yok; düz
  metin tab içe aktarma yok (dışa yazma fonksiyonu `toAscii` var ama arayüze bağlı değil).
- Şarkı modunda her akor aynı sürer ("akor başına vuruş"); ChordPro süre taşımadığı için akorların gerçek ritmi
  girilemez. Günlük plan henüz şarkı önermiyor.
- Seviye testi öz değerlendirmedir (çalarak ölçüm yok). Plan yalnızca Katman 1–2 araçlarını kullanır; şarkı, tab,
  sap ve kulak eğitimi maddeleri o aşamalar bitince eklenecek.
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
- Sap hesapları (gam/arpej konumları, CAGED, oyun soruları) saf fonksiyonlar: `src/music/fretboard.ts`; sap
  çizimi `src/ui/Fretboard.tsx` (başka ekranlarda da kullanılabilir: `dots` + `start`).
- Kulak eğitimi mantığı (seviyeler, tur üretimi, kilit açma, tür başına doğruluk): `src/music/ear.ts`. Yeni seviye
  eklemek için `INTERVAL_LEVELS` / `CHORD_LEVEL_ITEMS`'e satır eklemek yeter; yeni akor türü için ayrıca
  `ear.chord.<tür>` metni gerekir. Oyunlaştırma (Aşama 15) için hazır veri: `results` deposunda `type: 'ear'`
  ve `type: 'fretgame'` kayıtları.
- Kayıt: giriş düğümü `inputNode()` (`src/audio/input.ts`), kayıt motoru `src/audio/recorder.ts`, çözme ve
  senkron A/B çalma `src/features/recorder/player.ts`, saf hesaplar `takes.ts`, dalga formu `src/ui/Waveform.tsx`.
  Aşama 14 (ses dosyası) `decodeAudio` + `Waveform`'u, Aşama 16 (canlı efektler) `inputNode()`'u kullanabilir.
- Zaman esnetme: saf sınıf `TimeStretcher` (`src/dsp/stretch.ts`; akış biçiminde, worklet ve testlerde aynı kod),
  worklet `src/audio/stretch.worklet.ts`, ana iş parçacığı tarafı `src/features/tracks/engine.ts` (durum:
  `trackPlayback` sinyali). Uçtan uca testte dosya yükleme: `tracks.spec.ts` (testte üretilen WAV +
  `setInputFiles`).
- Çıkan sesin perdesini uçtan uca ölçmek için `window.__gitar.outputFreq()`; kayıtlı sesi ölçmek için
  `analyzeTake(id)`. Testte giriş sinyalini sayfa açıkken değiştirmek için bkz. `recorder.spec.ts` (`setInputFreq`).
- Uçtan uca testte veritabanına hazır veri koymak için bkz. `ear.spec.ts` ("son seviye" testi): sayfada
  `indexedDB.open('gitar-app')` ile doğrudan yazıp sayfayı yenile.
- Akor verisi ve teori: `src/music/chords.ts`, `src/music/theory.ts`. Grafikler: `src/ui/charts.tsx`.
- Windows'ta Git Bash heredoc'ları tek tırnak sayısı tek olunca bozuluyor; dosyaları doğrudan yaz.
