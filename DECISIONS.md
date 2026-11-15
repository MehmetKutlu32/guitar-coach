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

## Akor tanıma

- **Kroma, spektral tepelerden** (HPCP benzeri): 170 ms pencere (kalın tellerin temel seslerini ayırmak için),
  tepe frekansı parabolik ara değerlemeyle inceltilir, her tepe en yakın perde sınıflarına cos² ağırlığıyla
  dağıtılır. Tüm spektrumu toplamak yerine tepeleri kullanmak gürültüyü ve akortsuzluğu tolere eder.
- **Şablonlar harmonikleri içerir.** Do majörde Mi'nin 3. harmoniği Si'dir; düz (yalnızca akor notaları) şablonla
  bu Cmaj7 sanılır. Her notanın ilk altı harmoniğinin düştüğü perde sınıfları şablona azalan ağırlıkla eklenir.
- **Bas notası ayrı ölçülür** ve kök ile aynıysa küçük bir puan ekler. Aynı notalardan oluşan akorlar
  (Asus2 = A B E, Esus4 = E A B) yalnızca böyle ayrılır.
- **Kroma 0,3. kuvvetle sıkıştırılır.** Karekökle (0,5) zayıf çınlayan üçlüler kayboluyor, akor power akor
  sanılıyordu (açık akorlarda %94). 0,3 ile %98,9; 0,25 ile %100 oldu. 0,25 kendi sentez sesimize aşırı uyum
  riski taşıdığı için 0,3 seçildi.
- **İki ayrı görev, iki ayrı karar kuralı.** Açık tanıma (108 aday) dinleyicide gösterim içindir. Egzersizde
  adaylar bellidir (iki akor): `pickTarget` yalnızca onları karşılaştırır, benzerlik eşiği ve aradaki fark payı
  ister. Bu çok daha güvenilirdir ve ilgisiz akoru / sessizliği "hiçbiri" sayar.
- **Geçiş, akor üç kare (~130 ms) üst üste duyulunca sayılır**; tek karelik sıçramalar ve aynı akorun yeniden
  vurulması geçiş değildir. Sayım yalnızca süre işlerken yapılır (geri sayımda çalınanlar sayılmaz).
- **Otomatik sayım isteğe bağlı ve düzeltilebilir.** Tanıma gerçek gitarda doğrulanmadığı için varsayılan elle
  sayımdır; otomatik sayımda da sonuç ekranında sayı değiştirilebilir.
- **Performans: WebAssembly'ye gerek görülmedi.** Kroma için saniyede ~23 adet 8192'lik FFT, vuruş için ~375 adet
  1024'lük FFT; saf TypeScript ile worklet içinde çalışıyor. Gerçek cihazda yük ölçülmedi.

## Kulak eğitimi

- **Seviye ilerlemesi ayrı saklanmaz, sonuç kayıtlarından türetilir** (`unlockedLevel`): seviye N, 1…N−1'in her
  birinde geçer bir tur varsa açıktır. Tek doğruluk kaynağı `results` deposu olduğu için dışa/içe aktarmada
  tutarsızlık olamaz.
- **Geçme ölçütü: 10 soruluk tam turda %80.** Yarıda bırakılan tur kaydedilmez ve seviye açmaz ("ilk 4 soruyu
  bilip çık" ile ilerlenmesin). %80, iki seçenekli ilk akor seviyesinde şansla geçmeyi zorlaştırır (10'da 8+
  tutturma olasılığı ~%5).
- **Seviyeler birikimlidir** (her seviye öncekinin türlerini içerir) ve önce birbirinden çok farklı duyulanlar
  gelir (B3 / T5 / oktav; majör / minör). Çalınış biçimi de seviyeyle zorlaşır: çıkıcı → inici → birlikte.
- **Tur soruları torbadan çekilir, bağımsız rastgele değil**: her tür yaklaşık eşit sayıda sorulur. Bağımsız
  çekimde 10 soruda bir türün hiç gelmemesi sık olur ve "tür başına doğruluk" anlamsızlaşır.
- **Kök her soruda değişir** (art arda aynı kök gelmez): mutlak perdeyi ezberleyip aralığı tanımış gibi
  görünmek engellenir. Akor kökleri A2–A3 arasında, dar dizilimde ve kök konumunda; çevrimler bilinçli olarak
  yok (başlangıç düzeyi için tür tınısını öğrenmek öncelikli).
- **Doğruda kendiliğinden ilerleme, yanlışta bekleme.** Yanlış yanıt öğrenme anıdır: doğru ses ile seçilen
  yanıtın sesi aynı kökten art arda dinlenebilsin diye ilerleme kullanıcıya bırakıldı. "Sonraki" düğmesi
  seçeneklerin üstünde durur, 12 seçenekli seviyede de kaydırmadan görünür.
- **Her çalma ayrı bir kazanç düğümünden geçer ve yeni çalmada önceki kısılır**: önceki sorunun çınlayan kuyruğu
  yeni sorunun aralığına karışıp yanlış duyulmasın.
- **Türkçe kısa aralık adları K/B/T** (K3 = küçük üçlü, T5 = tam beşli), İngilizcede m/M/P. Akor kısa adları iki
  dilde de simge (maj, m, 7, maj7…).

## Sap ve teori

- **Sap yatay ve 12 perdelik pencerelerle gösterilir** (0–12, 6–17, 13–24), kaydırılan 24 perdelik tek şerit
  yerine. 390 px'te 24 perde okunmaz olurdu; yatay kaydırma ise tek elle kullanımı ve ekran görüntüsüyle
  doğrulamayı zorlaştırır. Yön tab ile aynı: kalın Mi altta.
- **Noktaların dokunma alanı perde hücresinin tamamıdır** (görünmez dikdörtgen). 12 perde mobil genişliğe
  sığdığından hücre ~24×22 px; 44 px hedefi burada geometrik olarak mümkün değil. Bu yüzden sapa dokunmak yalnızca
  ikincil bir işlev (notayı dinleme); oyunda yanıtlar sapa değil büyük düğmelere basılarak verilir.
- **Derece adları majör gama göre yazılır** (Lidyen'de "#4", Frigyen'de "b2"); yedi notalı olmayan gamlarda
  (pentatonik, blues) genel bemollü adlar kullanılır.
- **CAGED biçimleri açık akor verisinden türetilir** (`OPEN_CHORDS`'taki C, A, G, E, D taşınır), ayrı bir biçim
  tablosu tutulmaz: akor kütüphanesiyle tutarlı kalır. Her kök için biçimin sapta bulunduğu en alçak konum
  gösterilir; yalnızca majör biçimler var.
- **"Perdeyi bul" modunda açık tel sorulmaz ve 12 perde sonrası da doğru sayılır**: aynı telde 0 ve 12 aynı
  notadır, tek doğru yanıtlı soru kalsın diye.
- **Oyun geçmişi ayar başına ayrı tutulur** (tür + perde aralığı + doğal notalar): kolay ayarın %100'ü zor
  ayarın "en iyi"sini gölgelemesin. Puan doğruluk yüzdesi; süre ayrıca gösterilir, puana katılmaz (hız baskısı
  ezberi değil tahmini ödüllendirir).
- **Yanlış yanıtın geri bildirimi daha uzun kalır** (1,4 sn; doğruda 0,55 sn): doğrusunu okumaya zaman kalsın.

## Tab editörü ve oynatıcı

- **Izgara tabanlı model**: 4/4, ölçü başına 16 adım, adım başına 6 tel değeri. Serbest süreli nota modeli yerine
  ızgara seçildi: telefonda tek elle yazmak, döngü almak ve zamanlamak çok daha basit. Bedeli: üçlemeler ve
  on altılıktan kısa notalar yazılamaz.
- **Nota süresi yazılmaz, çıkarılır**: bir nota, aynı teldeki sonraki notaya (ya da çalınan bölümün sonuna, en çok
  iki ölçü) kadar çınlar. Gerçek gitardaki "tel yeni notaya kadar titrer" davranışına uyar ve süre girme derdini
  ortadan kaldırır.
- **Yazma tuş takımıyla, hücreye dokunarak değil.** Mobilde bir tab hücresi ~20 px genişliğinde; 44 px altındaki
  hedefe dokunarak perde girmek kullanışsız. İmleç oklarla (ya da hücreye dokunarak) taşınır, perde büyük
  tuşlardan yazılır. İki haneli perdeler için "+10" tuşu son yazılan hücreye 10 ekler.
- **İmleç ve tab, çizimi beklemeyen referanslarda da tutulur.** İlk sürümde hızlı art arda tuş basışlarında
  imleç geride kalıyor ve nota yanlış hücreye yazılıyordu (uçtan uca test yakaladı).
- **Hazır içerik yalnızca genel teknik egzersizler** (kromatik, pentatonik kalıp, boogie eşliği, power akor
  ritmi, tel atlama): bilinen parçalardan riff yok.
- **Hazır egzersizde yapılan tempo/nota değişiklikleri kaydedilmez**; kalıcı olması için egzersiz kopyalanır.

## Şarkı modu

- **Hazır içerik yalnızca kendi yazdığımız çalışma şarkıları.** CLAUDE.md telifsiz (kamu malı) örneklere izin
  veriyor, ama hangi sözün/düzenlemenin gerçekten kamu malı olduğunu bu oturumda doğrulamak mümkün değil;
  yanlışlıkla telifli bir düzenleme eklemek yerine sözleri ve akor dizilerini sıfırdan yazdık.
- **ChordPro süre taşımaz; her akor eşit sürer** ("akor başına vuruş": 1, 2, 4 ya da 8). Ölçü çizgisi ya da
  akor süresi için standart dışı bir sözdizimi icat etmek, başka yerden kopyalanan ChordPro metinlerini bozardı.
- **Transpoze duyulan tonu, kapo yalnızca gösterilen biçimi değiştirir.** Gösterilen akor = yazılan + transpoze −
  kapo; eşlik = yazılan + transpoze. Böylece "+2 transpoze, 2. perdede kapo" aynı parmak biçimleriyle çalınır.
- **Ayarlar şarkı başına ve ayrı saklanır** (kalıcı durum), şarkı kaydının içinde değil: hazır şarkıların ayarları
  da kalıcı olsun ve metin düzenlenince ayarlar kaybolmasın diye.
- **Otomatik kaydırma, çalma konumunu izler** (zamanlayıcıyla sabit hızda kaydırmak yerine): geçerli akorun
  satırı ekranın ortasına getirilir. Tempo değişince ya da satırlar farklı uzunlukta olunca da doğru kalır.
- **Çalma motoru eşlik grubudur** (`BackingPlayer`); grup kapatılınca seviyeler sıfırlanır ve metronom tıkı
  açılır. Sayma ve tıklar artık davul seviyesinden bağımsız, doğrudan ana çıkıştan çalar.
- **Hazır şarkılar düzenlenemez, kopyalanır.** Güncellemelerde hazır içeriği değiştirebilmek ve kullanıcının
  değişikliklerini ezmemek için.

## Günlük plan

- **Seviye testi bir öz değerlendirme anketi** (6 soru, ~1 dakika), çalarak ölçüm değil. İlk açılışta mikrofon
  izni, akort ve kalibrasyon istemek kullanıcıyı uygulamaya girmeden yorar; gerçek ölçümler (geçiş hızı, ritim
  isabeti) zaten ilk egzersizlerle birikir ve plan bunları kullanır.
- **Test zorunlu değil**: karşılama kartı ana sayfadadır, modal değil; "Şimdilik geç" yeni başlayan profiliyle
  devam eder. Araçlar testten bağımsız kullanılabilir.
- **Plan saf bir fonksiyondur** (`generatePlan`): profil + süre + gün + geçmiş → maddeler. Rastgelelik yok;
  çeşitlilik gün sırasından gelir. Bu sayede her kural birim testiyle sınanır ve aynı gün plan değişmez.
- **Her maddenin nedeni yazılır** ("En zayıf geçişin: dakikada 12, hedef 30"). Plan bir kara kutu gibi
  görünmesin; kullanıcı neden o çifti çalıştığını bilsin.
- **Akor çifti önceliği**: hedefin altındaki en zayıf çift (en zayıf iki çift arasında günaşırı dönüşümlü) → hiç
  çalışılmamış sıradaki çift → diğer zayıflar → en eski çalışılan. Hedef hız seviyeye göre dakikada 30 / 45 / 60.
- **Ritim kuralı son üç ölçümün ortalamasına bakar**: <60 yavaşlat (−10 BPM), 60–85 aynı tempoda kal (belirgin
  erken/geç eğilimi varsa onu söyle), ≥85 önce nota değerini sıklaştır, sonra +5 BPM.
- **Dakikaların toplamı her zaman seçilen süreye eşittir** (test edilir); hedef ve ihmal edilen konu dakikaları
  bloklar arasında kaydırır, toplamı değiştirmez.
- **"Tamamlandı" iki kaynaktan**: elle işaret (güne bağlı saklanır) ve bugün kaydedilmiş sonuçlar. Akort ve eşlik
  için güvenilir bir otomatik ölçüt yok; onlar elle işaretlenir.

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
