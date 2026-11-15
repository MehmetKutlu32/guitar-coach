# Kararlar

Önemli tasarım kararları ve nedenleri. Yeni kararlar sona eklenir.

## Genel mimari

- **Arayüz kütüphanesi: Preact + @preact/signals.** JSX ile hızlı geliştirme, ~5 KB çalışma zamanı. Durum için
  sinyaller kullanılıyor; ayrı bir durum yönetim kütüphanesi yok.
- **Yönlendirme: hash tabanlı (`#/tuner`).** GitHub Pages'te sunucu tarafı yönlendirme ayarı gerektirmez, alt dizinde
  (`/guitar-coach/`) sorunsuz çalışır, service worker yalnızca `index.html`'i önbelleğe alarak tüm ekranları açabilir.
- **Service worker elle yazıldı** (`public/sw.js`), eklenti (vite-plugin-pwa/workbox) kullanılmadı. Build sonunda
  `vite.config.ts` içindeki küçük bir eklenti dosya listesini ve içerik özetini `sw.js`'e yazar. Neden: bağımlılık
  yok, davranış tamamen görünür, Vite sürüm uyumsuzluğu riski yok. Strateji: tüm dosyalar kurulumda önbelleğe alınır,
  istekler önce önbellekten karşılanır; yeni sürümde önbellek adı değiştiği için eski önbellek silinir.
- **Önbellek eşleşmesinde `ignoreVary`.** Bazı sunucular (ör. `vite preview`) `Vary: Origin` gönderiyor; modül
  betikleri farklı istek başlıklarıyla geldiği için önbellek eşleşmiyor ve çevrimdışı açılış bozuluyordu. Dosya adları
  içerik özetli olduğundan `Vary`'yi yok saymak güvenli.
- **Vite `base` = `/guitar-coach/`**, `BASE_PATH` ortam değişkeniyle değiştirilebilir. CI bunu repo adından üretir.
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

## Eşlik (backing track)

- **Diziler roma rakamlarıyla tanımlanır**, tona göre akora çözülür; nota yazımı tona uyar (Fa majörde Bb, Mi
  majörde C#m). Kullanıcı dizileri mutlak akorlarla yazılır; "ev tonu" ilk akordur ve ton seçimi diziyi oraya taşır.
- **Yalnızca 4/4.** Hazır tarz kalıpları 4/4 için yazıldı; diğer ölçüler ayrı kalıp setleri gerektirir.
- **Vuruş başına 12 adım**: hem on altılıkları (3'er adım) hem üçlemeleri/shuffle'ı (4'er adım) tek ızgarada taşır.
- **Kalıp mantığı saf (`styles.ts` → `eventsAt`)**, ses üretimi ayrı (`band.ts`). Böylece hangi adımda ne
  çalınacağı Node'da sınanır; sesler `BaseAudioContext` aldığından çevrimdışı işlenip seviyeleri ölçülür.
- **Akor enstrümanı gitar değil, klavye benzeri bir ses.** Kullanıcı üstüne gitar çalacak; aynı tınıda bir eşlik
  hem kullanıcının sesini maskeler hem de ileride akor tanımayı (Aşama 7) yanıltır.
- **Seviyeler ölçülerek dengelendi.** İlk karışımda bas RMS 0,57 ve ham tepe 1,9 çıktı (sınırlayıcı sürekli
  çalışacaktı); kazançlar düşürülerek ham tepe 0,85'e indirildi. Test, tepenin 1'in altında kaldığını ve hiçbir
  partinin karışımın dörtte birinden az olmadığını denetler.
- **Genel `Transport` sınıfı** (`src/audio/transport.ts`) eşlikle birlikte eklendi; şarkı ve tab oynatıcıları da
  bunu kullanacak. Metronom kendi (eşdeğer) döngüsünü koruyor: çalışan, testli kodu yeniden yazmanın getirisi yok.
- **Blues gamındaki mavi nota bemollü yazılır** (A blues: A C D Eb E G), ton diyezli olsa da.

## Ritim geri bildirimi

- **Vuruş algılama: logaritmik spektral akı** (20 ms Hann penceresi, ~2,7 ms adım, yalnızca artışlar toplanır).
  İlk denenen yöntem zaman alanında enerji sıçramasıydı ve testlerde üç sorun çıkardı: (1) çınlayan kalın telin
  her periyottaki enerji tepeleri vuruş sanıldı, (2) çınlayan akorun üstüne gelen vuruşlar kaçtı, (3) güçlü
  vuruştan hemen sonraki zayıf vuruş kaçtı. Eşiği oynatmak birini düzeltip diğerini bozdu; yöntem değiştirildi.
- **Pencere 10 ms değil 20 ms.** 10 ms'de frekans çözünürlüğü (94 Hz) kalın tellerin temel seslerini ayıramıyor,
  boğuk vuruşlar çınlamanın içinde kayboluyordu. 20 ms'de hepsi yakalanıyor; zaman doğruluğu yine ~2–3 ms.
- **Sabit gecikme düzeltmesi (pencerenin %40'ı)** üretilmiş sinyallerle ölçülerek belirlendi: Hann penceresi en yeni
  örnekleri sıfıra yakın ağırlıkladığından atak akıda gecikmeli görünür.
- **Vuruş zamanı worklet'te `currentFrame` üzerinden** ses saatine çevrilir; ana iş parçacığına mesajın ne zaman
  ulaştığı ölçümü etkilemez.
- **Sapma = vuruş zamanı − hedef zamanı − gecikme.** Gecikme, çıkış + giriş toplamıdır ve Ayarlar'da ölçülür.
  Otomatik ölçüm hoparlör + mikrofon ister; kulaklık/doğrudan bağlantıda "çalarak ölç" kullanılır.
- **Eşleştirme: en yakın çiftler önce**, her hedef ve vuruş en çok bir kez; pencere hedef aralığının %45'i,
  en çok 150 ms. Eşleşmeyen vuruş "fazla", eşleşmeyen hedef "kaçırılan".
- **İki ayrı puan.** İsabet: vuruş başına 10 ms'ye kadar 100, 100 ms'de 0 (doğrusal); kaçırılan 0 sayar, fazla
  vuruş paydayı büyütür. Tutarlılık: sapmaların standart sapması 0 ms → 100, 40 ms → 0. Hep 30 ms geç çalan biri
  düşük isabet ama tam tutarlılık alır — düzeltmesi gereken şey farklıdır, o yüzden ayrı gösterilir.
- **Metronomla ölçümde bitiş, son ölçüden sonraki "bir"dir** ve o da hedeftir (müzikal bitiş). Metronoma
  `endAtBar` eklendi; sonrasında tık çalmaz.
- **Erken bitirilen ölçümde henüz çalınmamış hedefler değerlendirmeye girmez** (kaçırılmış sayılmaz).
- **Ayar yazmaları da sıraya alındı** (`queueWrite`): ayar değişikliğinden hemen sonra sayfa kapanırsa son değerin
  kaybolmaması ve testlerin `flush()` ile bekleyebilmesi için.

## Pratik günlüğü

- **Süre, açık olan ekrana göre kendiliğinden ayrılır.** Kullanıcı her egzersiz için ayrı sayaç başlatmak zorunda
  kalmaz: tek oturum başlatır, araçlar arasında gezer. Eşleme özellik kaydındaki `activity` alanındadır.
- **Egzersiz türü, çizimi beklemeden değişir** (sinyal `effect`'i, `useEffect` değil): ekran geçişinde süre yanlış
  türe yazılmasın diye.
- **İki sayım arasında en çok 5 sn sayılır.** Cihaz uyursa ya da sekme gizlenirse geçen süre çalışma sayılmaz;
  aksi halde açık unutulan oturum günlüğü şişirirdi. Bedeli: ekran kapalıyken çalışılan süre sayılmaz.
- **Seri, bugün henüz çalışılmadıysa dünden sayılır**; gün bitmeden seri "bozulmuş" görünmez. Bir günün sayılması
  için o gün toplam en az 1 dakika gerekir.
- **10 saniyeden kısa oturumlar kaydedilmez** (yanlışlıkla başlat/bitir).
- **Yarım kalan oturum duraklatılmış olarak geri gelir**, kendiliğinden devam etmez: uygulama kapalıyken geçen
  süre çalışma değildir; kullanıcı devam etmeyi ya da bitirmeyi seçer.
- **Gün anahtarları yerel saate göredir** (`YYYY-AA-GG`); gün ekleme öğlen saatinden yapılır ki yaz saati
  geçişlerinde gün atlanmasın.
- **Mobil alt çubukta en çok 5 öğe.** Günlük eklenince Ayarlar üst çubuktaki simgeye taşındı; sonraki araçlar ana
  sayfadaki listeden (masaüstünde yan menüden) açılır.

## Test

- **Playwright, derlenmiş sürüme (`vite preview`) karşı çalışır**: service worker ve gerçek paket test edilsin diye.
- **İki tür sahte giriş:** (1) Chromium'un sahte mikrofonu, üretilmiş bir WAV dosyasını çalar — gerçek
  `getUserMedia` yolu test edilir; (2) `window.__gitarTestInput` kancası — sayfa içinde üretilen sinyali giriş olarak
  verir, test başına farklı sinyal kullanmayı sağlar.
- **Ekran görüntüleri karşılaştırma için değil, gözle kontrol için** alınır (`screenshots/`, git'e girmez). Yazı tipi
  farkları yüzünden Windows/Linux arasında piksel karşılaştırması kırılgan olurdu. Bunun yerine her ekranda yatay
  taşma ve 44 px altı dokunma hedefi otomatik denetlenir.

## Yayınlama

- **Depo `MehmetKutlu32/guitar-coach`.** `gh` CLI bu makinede giriş yapmadığı için depoyu kullanıcı kendisi
  oluşturup uzak depoyu bağladı (2026-11-15). Depo adı planlanan `gitar-app` değil `guitar-coach` olduğundan yerel
  varsayılan `base` yolu `/guitar-coach/` yapıldı. CI zaten yolu repo adından üretiyordu.
- **Veritabanı ve yedek dosyası kimliği `gitar-app` kaldı.** Bunlar yayın yoluna bağlı değil; değiştirmek mevcut
  kayıtları ve eski yedekleri geçersiz kılardı.
- **Commit mesajları İngilizce, ortak yazar satırı yok** (kullanıcı isteği, 2026-11-15). İlk altı commit Türkçe
  kaldı: yayınlanmış geçmişi yeniden yazmak zorla gönderme (force push) gerektirir, bu açıkça istenmeden yapılmadı.
- **`gh` olmadan CI ve Pages durumu** GitHub'ın herkese açık API'sinden ve yayınlanan siteden okunur.
