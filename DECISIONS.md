# Kararlar

Önemli tasarım kararları ve nedenleri. Yeni kararlar sona eklenir.

## Genel mimari

- **Arayüz kütüphanesi: Preact + @preact/signals.** JSX ile hızlı geliştirme, ~5 KB çalışma zamanı. Durum için
  sinyaller kullanılıyor; ayrı bir durum yönetim kütüphanesi yok.
- **Yönlendirme: hash tabanlı (`#/tuner`).** GitHub Pages'te sunucu tarafı yönlendirme ayarı gerektirmez, alt dizinde
  (`/gitar-app/`) sorunsuz çalışır, service worker yalnızca `index.html`'i önbelleğe alarak tüm ekranları açabilir.
- **Service worker elle yazıldı** (`public/sw.js`), eklenti (vite-plugin-pwa/workbox) kullanılmadı. Build sonunda
  `vite.config.ts` içindeki küçük bir eklenti dosya listesini ve içerik özetini `sw.js`'e yazar. Neden: bağımlılık
  yok, davranış tamamen görünür, Vite sürüm uyumsuzluğu riski yok. Strateji: tüm dosyalar kurulumda önbelleğe alınır,
  istekler önce önbellekten karşılanır; yeni sürümde önbellek adı değiştiği için eski önbellek silinir.
- **Önbellek eşleşmesinde `ignoreVary`.** Bazı sunucular (ör. `vite preview`) `Vary: Origin` gönderiyor; modül
  betikleri farklı istek başlıklarıyla geldiği için önbellek eşleşmiyor ve çevrimdışı açılış bozuluyordu. Dosya adları
  içerik özetli olduğundan `Vary`'yi yok saymak güvenli.
- **Vite `base` = `/gitar-app/`**, `BASE_PATH` ortam değişkeniyle değiştirilebilir. CI bunu repo adından üretir.
  Manifest'te `start_url` ve `scope` göreli (`./`) olduğu için alt dizin değişse de doğru çözülür.
- **Veri modeli: genel amaçlı 5 IndexedDB deposu** (`kv`, `sessions`, `results`, `items`, `blobs`). Kayıtlar `type`
  alanıyla ayrılır. Neden: 16 aşama boyunca her özellik için şema sürümü yükseltmek yerine tek şema; dışa/içe aktarma
  tüm depoları tek JSON'a döker.
- **İçe aktarma mevcut verinin yerine geçer** (birleştirme yok); kullanıcıdan onay alınır. Birleştirme kuralları
  belirsiz ve hataya açık olurdu; "yedekten geri yükle" anlamı net.
- **i18n: düz anahtarlı iki sözlük** (`tr.ts` kaynak, `en.ts` `Record<Key, string>`). Eksik çeviri derleme hatasıdır;
  yer tutucuların iki dilde aynı olduğu birim testiyle doğrulanır.

## Ses

- **Tek bir AudioWorklet (`gitar-analyzer`)** tüm gerçek zamanlı analizi yapar ve her 1024 örnekte bir sonuç gönderir.
  Analiz modları mesajla açılıp kapanır; böylece mikrofon tek bir yerden yönetilir.
- **Perde algılama: YIN, fark fonksiyonu FFT ile.** Doğrudan hesaplama çerçeve başına ~2,8 milyon çarpma gerektiriyordu;
  FFT tabanlı çapraz korelasyonla O(N log N). Saf TypeScript yeterince hızlı; **WebAssembly'ye gerek görülmedi.**
- **YIN'e eklenen iyileştirmeler** (testlerdeki hatalardan çıktı):
  1. Eşik, en derin çukura göre uyarlanır (`max(0.12, min·1.25 + 0.03)`): gürültüde çukurlar sığlaşınca oktav hatası
     yapmamak için.
  2. Eşiğin altındaki bölgenin tamamındaki en küçük değer alınır; ilk yerel çukurda durmak, dalgalı fark fonksiyonunda
     20 cent'e varan hata veriyordu.
  3. Analiz öncesi 2,8 kHz alçak geçiren süzgeç: geniş bantlı gürültüyü bastırır (10 dB SNR'de kare başına hata
     9 cent'ten 3 cent'e indi), perde bilgisine dokunmaz.
- **Konuşma iyileştirmeleri kapalı** (`echoCancellation`, `noiseSuppression`, `autoGainControl` = false): bunlar
  enstrüman sesini bozar ve perde/vuruş ölçümünü etkiler.
- **Çok kanallı girişte kanalların ortalaması alınır**: ses kartının 2. girişine takılı gitar da duyulsun diye.
- **Karplus-Strong uyarımı: üçgen (ideal çekilmiş tel biçimi) + az gürültü.** Saf gürültü uyarımında harmonik
  genlikleri rastgele olduğundan bazı tohumlarda temel ses neredeyse yoktu ve tel bir oktav tiz duyuluyordu.
  Üçgende harmonikler sin(kπp)/k² ile azalır, temel ses her zaman baskındır. Akort düzeltmesi için Jaffe-Smith
  allpass kesirli gecikmesi kullanılır (ölçülen hata < 1 cent).

## Akort aleti

- **"Akortlu" eşiği ±4 cent**; yarım saniye bu aralıkta kalınca tel "tamam" işaretlenir.
- **Tele dokunmak hem referans sesini çalar hem o tele kilitler** (tekrar dokununca otomatik algılama). Ayrı bir
  "otomatik/elle" anahtarı yerine tek hareket: gitar kucaktayken tek elle kullanım için.
- **Gösterge yumuşatma:** son 7 karenin medyanı, 70 cent'ten büyük sıçramada sıfırlama, sinyal kesilince ~0,3 sn tutma.
- **Gecikme kalibrasyonu Aşama 6'ya bırakıldı.** Akort için gerekmiyor; ritim geri bildirimi ile birlikte anlamlı.
  Giriş cihazı seçimi ve seviye göstergesi Aşama 1'de var.

## Metronom

- **Zamanlama: "ileriye bakan" planlayıcı.** 25 ms'lik bir zamanlayıcı, önümüzdeki 150 ms'ye düşen tıkları
  `AudioContext` saatine göre kesin zamanlarıyla planlar. Zamanlayıcının gecikmesi sese yansımaz. Sekme gizliyken
  tarayıcı zamanlayıcıları seyrelttiği için pencere 1,6 sn'ye çıkar.
- **Adım zamanları çapa + çarpma ile hesaplanır** (`çapa + n · adımSüresi`), birikimli toplama ile değil; böylece
  yuvarlama hatası birikmez. Tempo değişince çapa o adıma taşınır.
- **Saf mantık (`src/audio/clock.ts`) Web Audio'dan ayrı**: Node'da birim testiyle, titreşimli sahte zamanlayıcıyla
  doğrulanır. Ses tarafı (`metronome.ts`) yalnızca tıkları planlar.
- **Uzun duraklamadan sonra geçmiş adımlar atlanır** (25 ms'den eski olanlar çalınmaz); ızgara korunur. Aksi halde
  uyuyan sekme uyanınca tıklar üst üste yığılırdı.
- **BPM, ölçünün paydasındaki nota değerini sayar** (6/8'de sekizlik). Noktalı dörtlük saymak yerine tek kural:
  arayüzde açıklama gerektirmiyor.
- **Vurgular vuruşa dokunarak değişir** (normal → vurgulu → sessiz). Sessiz vuruş, "boşlukta tempoyu tutma"
  alıştırması için de kullanılabilir.
- **Görsel gösterge çıkış gecikmesini hesaba katar**: vuruş noktası, tık planlandığında değil duyulduğunda
  (`currentTime − outputLatency`) yanar.
- **Vuruş kalıpları ölçünün vuruş sayısına bağlıdır**; seçili ölçüye uymayan kalıplar listede görünmez. Kalıp
  ızgarası ile alt bölmenin en küçük ortak katı saat adımı olur (ör. üçleme + sekizlik kalıp → vuruş başına 6 adım).
- **Kalıp seslendirmesi açık Mi minör akoruyla** yapılır (Karplus-Strong), metronomla aynı ana planlanır. Yukarı
  vuruşta yalnızca ince 4 tel çalınır; susturulmuş vuruş çok kısa sönümlü teldir.
- **Kullanıcı kalıpları `items` deposunda `type: 'strum'`** olarak saklanır; dışa/içe aktarmaya kendiliğinden dahildir.
- **Metronom ekrandan çıkınca durur.** Arka planda çalmaya devam etmesi, başka ekranların kendi metronom
  kullanımıyla (geçiş egzersizi, ritim geri bildirimi) çakışırdı.

## Akorlar

- **Bare ve power akorlar taşınabilir biçimlerden üretilir** (E ve A biçimleri × perde), tek tek yazılmaz. Açık
  akorlar elle girilir. Tüm biçimler birim testinde teoriyle karşılaştırılır: yabancı nota yok, bas kök, yalnızca
  beşli eksik olabilir, el açıklığı en çok 4 perde.
- **Egzersizde akor simge olarak seçilir**, biçim olarak değil; simgenin "önerilen" biçimi gösterilir (varsa açık
  akor, yoksa en alçak perdedeki bare). 150 biçimlik bir seçim listesi telefonda kullanışsız olurdu.
- **Sonuçlar dakika başına geçişe çevrilerek karşılaştırılır**; böylece 30/60/120 sn'lik egzersizler aynı grafikte
  ve aynı rekor hesabında yer alır.
- **Çift anahtarı sıradan bağımsızdır** (`Am|C` = `C|Am`).
- **Sayım elle**: çalarken ekrana dokunmak zor olduğundan iki yol var — büyük +1 düğmesi ya da sonunda sayıyı
  girme/düzeltme. Otomatik sayım akor tanıma ile Aşama 7'de eklenecek.
- **Kalıcı durum yazmaları sıraya alınır** (`persist.ts`): art arda gelen güncellemelerde son değerin kalıcı olması
  ve testlerin yeniden yüklemeden önce yazmanın bittiğini bekleyebilmesi için.

## Test

- **Playwright, derlenmiş sürüme (`vite preview`) karşı çalışır**: service worker ve gerçek paket test edilsin diye.
- **İki tür sahte giriş:** (1) Chromium'un sahte mikrofonu, üretilmiş bir WAV dosyasını çalar — gerçek
  `getUserMedia` yolu test edilir; (2) `window.__gitarTestInput` kancası — sayfa içinde üretilen sinyali giriş olarak
  verir, test başına farklı sinyal kullanmayı sağlar.
- **Ekran görüntüleri karşılaştırma için değil, gözle kontrol için** alınır (`screenshots/`, git'e girmez). Yazı tipi
  farkları yüzünden Windows/Linux arasında piksel karşılaştırması kırılgan olurdu. Bunun yerine her ekranda yatay
  taşma ve 44 px altı dokunma hedefi otomatik denetlenir.

## Yayınlama

- **`gh` CLI giriş yapmamış olduğu için** GitHub reposu oluşturulamadı ve push edilemedi. CLAUDE.md'deki kurala göre
  bu adım atlandı; gerekli komutlar README'de. İş akışı dosyası (`.github/workflows/deploy.yml`) hazır.
