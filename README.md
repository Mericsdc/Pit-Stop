# Pit-Stop

![Pit-Stop](public/assets/banner.webp)

Türkçe Discord botu ve Discord ile giriş yapılan yönetim paneli. Node.js 24, discord.js 14, SQLite ve Lavalink kullanır.

Panel arayüzünde metin kopyalama, kesme, görsel/video sürükleme ve sağ tık menüsü kapalıdır.
Form alanları yazma ve yapıştırma için seçilebilir kalır. Bu tarayıcı arayüzü önlemidir;
web istemcisine gönderilmiş içeriğin geliştirici araçlarıyla alınamayacağına dair bir güvenlik sınırı oluşturmaz.

- Ayrılan üyeler için kanal ve mesaj şablonu; katılan insan üyelere birden fazla otomatik rol.
- Panelden tanımlanan `!komut` cevapları; büyük/küçük harf duyarsız tam eşleşme.
- Yetki kontrollü `/clear` ve `/temizle`; sabitlenmiş, sistem ve 14 günden eski mesajları korur.
- Kullanıcı/yetkili adı, kimlik, tarih-saat ve işlem ayrıntılarıyla kayıtlar. Yeni mesaj düzenleme logu üretilmez.
- YouTube / YouTube Music araması, YouTube ve Spotify bağlantıları, kuyruk, ses, DJ rolü.
- Kalıcı hatırlatıcılar, isteğe bağlı sağlık asistanı, spam/phishing koruması, özel destek ve savunma odaları, yönetilebilir üye blacklist’i.
- NightRiderz Crew #1636 için REP, Last login, Events completed ve Driver score listesi; Europe/Istanbul gün başlangıcına göre günlük karşılaştırma.
- Sunucu başına kalıcı ayarlar, son 30 gün / en fazla 10.000 olay. Otomatik cevap, koruma ve özel oda kayıtları ilgili mesaj içeriğini içerir; bot token’ları loglanmaz.

## Mini RPG ve ekonomi

`/rpg-rehber` başlangıç adımlarını, bütün RPG komutlarını ve savaş kurallarını özel yanıtla açıklar.
Panelde **Oyun ve topluluk → Mini RPG ve ekonomi** sayfası; çalışan komutları,
eşya fiyat/güç listesini, sınıfları, üretim tariflerini, canavarları ve ilk 10 oyuncuyu gösterir.
Sıralama sayfa açıkken 15 saniyede bir yenilenir; oyuncuların kuşandığı kılıç ve zırh da listelenir.

Her Discord sunucusunun ekonomisi ayrıdır. `/çalış` 30 dakikada bir 50–100 altın,
`/maden` 15 dakikada bir 25–65 altın verir; %15 olasılıkla nadir kristal 100–180 altın kazandırır.
`/mağaza` ekipmanları listeler, `/satın-al eşya:...` satın alır; en güçlü kılıç ve zırh otomatik kuşanılır.
`/profil` bakiye, XP, seviye, envanter ve savaş sonuçlarını gösterir.

`/savaş canavar:...` 5 dakikada bir kullanılabilir. Oyuncu ve canavar d20 atar.
Oyuncunun zarına kılıç, zırh ve en fazla 10 seviye bonusu eklenir; canavarın zarına
gücü eklenir. Eşitlikte oyuncu kazanır. Galibiyet altın ve XP verir; yenilgi ödülün
%20'si kadar mevcut altını götürür, bakiye sıfırın altına düşmez. Ekipman kaybolmaz.
Seviye `floor(sqrt(XP / 100)) + 1` olarak hesaplanır.

`/sıralama` sunucunun ilk 10 oyuncusunu kanalda paylaşır: XP, ardından galibiyet,
ardından eldeki altın. Diğer RPG yanıtlarını yalnızca komutu kullanan kişi görür.
Altın, ekipman ve bekleme süreleri SQLite `feature_records` tablosunda saklanır;
ayrı migration veya gizli anahtar gerekmez. Satın alma ve ödüller tek transaction ile kaydedilir.

### Sınıflar, sosyal oyun ve üretim (v1.3)

- `/sınıf seçim:...`: Seviye 10'da **kalıcı** Savaşçı, Büyücü veya Okçu seçimi.
  Savaşçı +3 güç ve `/öfke` (+7), Büyücü +2 ve `/ateş-topu` (+9), Okçu +2 ve `/nişan` (+8) kazanır.
  Yetenekler 30 dakika, normal savaşla paylaşılan savaş beklemesi 5 dakikadır. Okçu nadir madene +5 şans puanı ekler.
- `/gönder oyuncu:... altın:...` veya `eşya:...`: aynı sunucudaki bir insana 1–100.000 altın veya tek eşya gönderir.
  İksirler adetle, ekipmanlar tekil tutulur. Gönderilen kuşanılmış eşyanın yerine kalan en güçlü eşya takılır.
  Gönderen, alıcı ve işlem kaydı aynı SQLite transaction'ında güncellenir; yetersiz bakiye, kopya veya taşma tüm işlemi geri alır.
- `/günlük`: 24 saat arayla 100 altın / 25 XP'den başlayıp 7. günde 250 altın / 55 XP'ye ulaşır.
  48 saati aşan ara seriyi sıfırlar; 7. gün sonrasında ödül sabit kalır.
- `/düello oyuncu:... altın:...`: 1–500 altınlık davet. Yalnızca rakip kabul veya ret verebilir; 2 dakikada geçersizleşir.
  Kabulde üyelik, bakiye ve 10 dakikalık ortak düello beklemesi yeniden kontrol edilir. İki d20 ve güncel güç karşılaştırılır;
  kaybedenin seçilen altını kazanana aktarılır. Eşitlikte altın değişmez. PvP XP üretmez.
- `/zindan`: Seviye 3'ten itibaren 1 saatte bir. Saldır / İksir İç / Kaç düğmeleri;
  100 boss canı, 15 dakika veya en fazla 20 tur. Zafer 600 altın, 250 XP ve bir boss parçası verir.
  %25 nadir kılıç (şans iksiriyle %45); kılıç zaten varsa ek boss parçası verilir.
  Can her 30 dakikada 10 yenilenir. Zindan sırasında diğer savaş, alışveriş ve transferler engellenir.
  Tur numarası eski düğmeleri reddeder; aktif savaş ve giriş beklemesi yeniden başlatmada korunur.
- `/market` ve `/mağaza`: fiyatı görünen seçim menüsünden doğrudan alışveriş.
  İksirler, iki kazma ve iki balta seviyesi eklenmiştir. Kazma maden gelirini %15/%35, balta çalışma gelirini %15/%30 artırır.
  `/iksir tür:...`: can iksiri +50 can, şans iksiri 30 dakika nadir maden/boss düşüşüne +20 yüzde puanı verir.
- `/görev`: 3 Goblin veya faaliyetlerden 500 altın görevi; `ödül` seçeneğiyle bir kez tahsil edilir.
  İstanbul gece yarısında yenilenir. Gönderilen altın, günlük ödül, düello, görev ödülü ve bahis geliri görev sayacını artırmaz.
- `/üret`: demir, odun, kristal ve boss parçalarıyla özel kılıç/zırh ve iksir tariflerini gösterir;
  `tarif` seçilince altın ve malzemeler aynı işlemde harcanır.
- `/dünya`: sunucu ve tarihe göre sabit oyun havasını gösterir. Gece (20.00–06.00) ve meteor yağmuru
  nadir maden olasılığını ayrı ayrı +5 puan artırır. Bu gerçek hava durumu servisi değildir.
- `/karaborsa`: sunucu ve tarihe göre günde iki ayrı bir saatlik aralıkta açılır.
  Gölge zırhı ve lanetli kılıç satar. Lanetli kılıç %25 ihtimalle PvE saldırısından 10 güç düşürür.
- `/zar-at altın:...` ve `/bahis altın:...`: aynı 1 dakikalık bekleme, 10–500 sanal altın.
  d6'da 5–6 (1/3) bahsin iki katını brüt öder; 1–4 bahsi kaybettirir. Altın gerçek para ile alınamaz, bozdurulamaz.

Panelin RPG sayfasından **Başarı duyuruları** kanalı seçilebilir; boss zaferleri ve efsanevi üretimler bu kanala gönderilir.
Kanal boşsa yalnızca olay kayıtlarında tutulur. Transfer ve düello sonuçları da olay kayıtlarına işlenir.
Yeni alanlar eski oyuncu kayıtlarına okunurken varsayılanlarla eklenir; mevcut XP, altın, ekipman ve beklemeler korunur.
Bu sürüm şema değişikliği veya ek environment variable gerektirmez.

### Garaj araçları ve açık artırma (v1.10)

**Garajım → Araçlarım** bölümünde her İstanbul gününde üç müşteri tamiri yenilenir. Tamirler depodaki gerekli parçaları tüketir; vardiyalar da zaman zaman yedek parça kazandırır. Oyuncu parçaları PitCoin ile alabilir, garaj seviyesi ve boş park yeri uygunsa bozuk araç satın alıp tamir edebilir. Tamirli araçlar 30 dakikalık açık artırmaya çıkarılır. Diğer oyuncular mevcut tekliften en az 50 PitCoin yüksek teklif verir; teklif tutarı geçici olarak ayrılır ve geçilirse iade edilir. Teklif gelmezse başlangıç tutarından oyun içi alıcıya satılır. Süre dolunca ilk panel veya Discord görüntülemesinde satış tek işlemde sonuçlandırılır. Web ve Discord aynı oyuncu, depo, araç ve açık artırma kayıtlarını kullanır. `/araçlarım`, `/parça-al`, `/müşteri-tamir`, `/araba-al`, `/araba-tamir`, `/araba-sat`, `/açık-artırma` ve `/teklif-ver` komutları da kullanılabilir.

### Dinamik garaj ve modifiye (v1.11)

Garaj sahnesi oyuncunun gerçek seviyesi, araç doluluğu, lift, boya kabini ve diagnostik cihazına göre SVG olarak çizilir. Garaj ekipmanı satın alınınca 15 dakika kargoda kalır; PitCoin ile hızlandırılabilir. Kullanılan ekipman aşınır, bakım yapılmazsa bonusu durur. Araç deposunda görsel ve performans modları, dört nadirlikte parça kutusu, 45 dakikalık hurdalık keşfi ve bozuk araç parçalama bulunur. Nadir parçalarda karaborsa saatleri ve oyuncu başına günlük/haftalık stok geçerlidir. Modifiye başarı şansı ve sonuçları sunucuda hesaplanır. Açık artırmalarda pasif ve agresif oyun içi alıcılar 1–3 dakikalık aralıklarla teklif verebilir; oyuncu teklifi geçilirse ayrılan PitCoin iade edilir. **Başarı duyuruları** kanalı seçiliyse bot o kanalda aralıklı 60 saniyelik SOS çağrısı yayınlar; uygun garaj ve çekiciye sahip ilk `/yol-yardım` oyuncusu çağrıyı alır. Web ve Discord işlemleri aynı kayıtları kullanır. Yeni komutlar: `/mod-kutusu`, `/hurdalık`, `/araba-parçala`, `/modifiye`, `/kargo-hızlandır`, `/ekipman-bakım`.

## Web sitesi ve canlı panel

GitHub Pages adresi: **https://mericsdc.github.io/Pit-Stop/**

Pages, `public/` arayüzünün giriş sayfasını yayınlar. Node botu, OAuth2 oturumları, SQLite ve müzik arka ucu GitHub Pages üzerinde çalışmaz. Canlı panel bot sunucusunda çalışır; GitHub Pages giriş düğmesi bu panele yönlendirir. Kod, site ve sunucudaki çalışır uygulama ayrı yayın adımlarıdır.

Depoda **Settings → Pages → Source: GitHub Actions** seçin. Sunucu HTTPS ile hazır olduktan sonra **Settings → Secrets and variables → Actions → Variables** içinde `PUBLIC_PANEL_URL` değerini güvenli canlı panel adresi olarak ekleyin ve `Publish website` iş akışını yeniden çalıştırın. Bu değer yalnızca herkese açık URL olmalı; hiçbir token veya parola eklemeyin. Değer boşken site, canlı sunucu bağlantısının beklediğini açıkça gösterir.

## Discord kurulumu

1. [Developer Portal](https://discord.com/developers/applications) üzerinden Pit-Stop uygulamasını açın.
2. **Bot** sayfasında `Server Members Intent` ve `Message Content Intent` açın. Oyun süresi takibi için ayrıca `Presence Intent` ve `PRESENCE_ENABLED=true` gerekir. Bot token’ı yalnızca oluşturulurken görünür; gerekiyorsa hesabın sahibi yeni token oluşturur.
3. `.env.example` dosyasını `.env` olarak kopyalayın. `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` ve panel için `DISCORD_CLIENT_SECRET` alanlarını doldurun. `SESSION_SECRET` üretin:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

4. **OAuth2 → Redirects** listesine `PUBLIC_URL` ile aynı kökü kullanan `/auth/callback` adresini ekleyin; yerel kullanım için `http://localhost:3001/auth/callback`.
5. `npm run invite` ile davet adresi üretin; botu hedef sunucuya ekleyin. Botun rolünü otomatik vereceği rolün üzerine taşıyın. Paneldeki otomatik rolü ayarlayan kişinin hem Sunucuyu Yönet hem Rolleri Yönet yetkisi olmalı.

Üye ve otomatik cevap olayları için intentler zorunludur. Panelde yalnızca **Sunucuyu Yönet** izninizin bulunduğu ve botun da üyesi olduğu sunucular görünür. Yetki her yönetim isteğinde Discord’dan tekrar doğrulanır.

## Yerel çalıştırma

Node.js **24.x** ve npm gerekir.

```sh
npm ci
npm run check
npm test
npm start
```

Panel `http://localhost:3001` adresindedir. `GET http://127.0.0.1:3000/healthz` Discord bağlantısı hazırsa 200, değilse 503 döner. `npm run dev` dosya değişikliklerini izler. Slash komutları başlangıçta isim bazlı güncellenir; uygulamanın başka komutları topluca silinmez. `DISCORD_GUILD_ID` geliştirme sunucusuna kayıt için isteğe bağlıdır; boşsa global kayıt yapılır. Scope değiştirince eski scope’taki komutları ayrıca temizlemek gerekir.

## Sunucuda Docker ile bot, panel ve müzik

Hedef makinede Docker Engine ve Compose gerekir. Tek bir bot kopyası çalıştırın; systemd ile Docker seçeneğini aynı anda kullanmayın.

```sh
git clone https://github.com/Mericsdc/Pit-Stop.git
cd Pit-Stop
sudo install -d -m 700 /etc/pit-stop
sudo install -m 600 .env.example /etc/pit-stop/pit-stop.env
sudo nano /etc/pit-stop/pit-stop.env
sudo docker compose up -d --build
sudo docker compose logs --tail=100 pit-stop
```

`LAVALINK_PASSWORD` güçlü ve rastgele bir değer olmalı. Compose bot için Lavalink adresini kendisi ayarlar. Lavalink dışarıya port açmaz; panel yalnızca sunucunun `127.0.0.1:3001` adresinde açılır. `pit-stop-data` volume SQLite verilerini korur. `docker compose down -v` verileri siler; normal güncellemelerde kullanmayın.

### Alan adı olmadan erişim

İlk yönetim için SSH tüneli kullanabilirsiniz:

```sh
ssh -L 3001:127.0.0.1:3001 KULLANICI@SUNUCU_IP
```

Tarayıcıda `http://localhost:3001` açılır. `PUBLIC_URL=http://localhost:3001` ve Discord callback’i aynı kökte olmalı.

Herkese açık panel için geçerli TLS sertifikası gerekir. Kendi alan adınız yoksa [sslip.io](https://sslip.io) gibi IP’yi DNS adına çeviren bir adres ve Caddy kullanılabilir. Örneğin `SUNUCU-IP.sslip.io` biçimindeki adın gerçekten sunucunuza çözümlendiğini doğrulayın. `deploy/Caddyfile` şablonunu gerçek adla kurun; yalnızca HTTP/HTTPS için gereken portları açın. `PUBLIC_URL`, Discord callback ve GitHub `PUBLIC_PANEL_URL` aynı HTTPS kökünü kullanmalı. Özel anahtarları GitHub’a yüklemeyin.

### systemd alternatifi

Node.js 24 ve npm kurulu Linux makinede:

```sh
sudo bash deploy/install.sh /tam/yol/Pit-Stop
```

İlk çalıştırma `/etc/pit-stop/pit-stop.env` oluşturur ve eksik kimlik bilgilerini bildirir. Dosyayı doldurup komutu yeniden çalıştırın. Ayrı `pit-stop` kullanıcısı, `/opt/pit-stop/current` sürüm bağlantısı ve `/var/lib/pit-stop` kalıcı veri dizini kullanılır. Bağımlılıklar hazırlanıp yapılandırma doğrulanmadan mevcut servis durdurulmaz; başarısız hazır olma kontrolünde önceki sürüme dönülür. Müzik için Lavalink’i ayrıca çalıştırıp `LAVALINK_HOST` ayarlayın.

```sh
sudo systemctl status pit-stop
sudo journalctl -u pit-stop -n 100 --no-pager
```

## Müzik kaynakları

Lavalink **4.2.2**, youtube-source **1.18.2**, LavaSrc **4.8.3** ve lavalink-client **2.11.0** sabitlenmiştir. Yapılandırma `deploy/lavalink.yml` içindedir.

Panelden müzik modülünü açın; bir ses kanalına girin ve `/play` kullanın. Web oynatıcısı da aynı ses kanalı / DJ kontrollerine uyar. Bir istekte en fazla 50 parça ve toplam 200 parça alınır. Boş kuyruk veya boş ses kanalında yaklaşık 2 dakika, uzun duraklatmada 10 dakika sonra bağlantı kapanır.

Spotify için `SPOTIFY_ENABLED=true`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` gerekir. Spotify, parça ve liste bilgisi için kullanılır; ses YouTube’dan eşleştirilir, Spotify’dan doğrudan veya DRM aşarak aktarılmaz. Eşleşme bulunmayabilir veya farklı kayıt gelebilir. Özel listeler desteklenmez.

YouTube bazı sunucu IP’lerinde oturum/istek doğrulaması isteyebilir. Gerekirse youtube-source’ın [resmi kılavuzuna](https://github.com/lavalink-devs/youtube-source) göre `YOUTUBE_OAUTH_ENABLED`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_PO_TOKEN`, `YOUTUBE_VISITOR_DATA` ayarlayın. Canlı ses testi yapılmadan yalnızca kod/test sonuçlarıyla oynatmanın çalıştığı varsayılmamalıdır.

YouTube oynatıcı imzası uyumluluğu için aynı sunucuda [yt-cipher](https://github.com/kikkia/yt-cipher) kurulabilir:

```sh
sudo bash deploy/install-cipher.sh
```

Kurucu Deno 2.9.6 indirmesinin SHA-256 değerini doğrular; yt-cipher ve EJS kaynaklarını belirli commit’lere sabitler. Servis yalnızca `127.0.0.1:8001` üzerinde, ayrı kullanıcıyla çalışır. `/etc/pit-stop-cipher/cipher.env` içindeki `API_TOKEN` değerini müzik servisinin özel ortam dosyasında `YOUTUBE_CIPHER_PASSWORD` olarak, adresi `YOUTUBE_CIPHER_URL=http://127.0.0.1:8001` olarak tanımlayın. Bu değerleri GitHub’a yüklemeyin.

Mevcut systemd müzik kurulumunu güncellerken `deploy/lavalink.yml` dosyasını `/opt/pit-stop-music/application.yml`, `deploy/music-oauth.mjs` dosyasını `/opt/pit-stop-music/music-oauth.mjs`, `deploy/pit-stop-music.service` dosyasını `/etc/systemd/system/pit-stop-music.service` konumuna kurun; `systemctl daemon-reload` ve `systemctl restart pit-stop-music` çalıştırın. OAuth yardımcısı için `/usr/local/bin/node` gerekir. Giriş anahtarı açılıştan sonra uygulanır; geçersiz bir YouTube oturumu tüm müzik servisini kapatmaz. Bot, müzik servisine 30 saniye aralıklarla yeniden bağlanır.

## Komutlar

| Komut | İşlev |
| --- | --- |
| `/yardim` | Komut rehberi |
| `/ping`, `/sunucu`, `/avatar` | Bağlantı ve bilgi |
| `/anket` | 2–10 seçenekli Discord anketi |
| `/clear`, `/temizle` | Son 1–100 mesajda güvenli temizleme |
| `/play` | Şarkı, YouTube veya Spotify bağlantısı |
| `/pause`, `/resume`, `/skip`, `/stop` | Müzik kontrolleri |
| `/queue`, `/volume` | Kuyruk ve ses |
| `!özelkomut` | Panelden tanımlanan cevap |
| `/hatırlat not:2 saat sonra NFS turnuvası var hedef:DM` | Kalıcı zamanlı bildirim |
| `/hatırlatıcılar [iptal:kimlik]` | Kişisel liste ve iptal |
| `/healthcare durum:aç [hedef:DM]` | Kişisel mola hatırlatmaları |
| `/bilet-kapat` | Destek talebini kapat, kanalı koru |
| `/uyar üye:... sebep:...` | Yetkili uyarısı ve özel savunma |
| `/savunma-yanıt mesaj:...` | Yetkiliden üyeye bot DM yanıtı |

## Topluluk araçları ve izinler

Panelin Spam & phishing, Destek & savunma, Hatırlatıcı & sağlık, Üye blacklist ve Yetkilendirme bölümlerinden ayarlanır. Hatırlatıcılar 15 saniyede bir kontrol edilir, yeniden başlatmada korunur; DM kapalıysa üç denemeden sonra hata kaydı kalır. Sağlık asistanı yalnızca `/healthcare` ile katılan kullanıcıları izler; kesintisiz ses veya oyun oturumu kullanılır, ekran etkinliği ölçülmez. Yeniden başlatma süreyi sıfırlar. Selamlama tarayıcının saat dilimini kullanır; konum izni/IP konum hizmeti kullanmaz.

Crew REP paneli üç saatte bir yenilenir ve panelden elle de güncellenebilir. Otomatik yenilemeler olay kayıtlarını doldurmaz; yalnızca panelde bir yetkilinin başlattığı manuel yenileme kullanıcı adıyla kaydedilir. `NRZ_USER_KEY` ve `NRZ_PERSONA_KEY` salt-okunur oturum değerleri ayarlandığında Admins ve Members kadrosu `GetMembersRep`, yarış hareketleri `GetActivityRep`, son giriş/etkinlik/sürücü puanı ise üye profillerinden alınır. Panel toplam, son 24 saat, günlük ve aylık REP farklarını kalıcı kayıtlarla hesaplar; önceki günlük kayıtları korur. Bu iki oturum değeri özel yapılandırmadır ve GitHub’a eklenmez.

Panel logosu, genel bakış bannerı ve giriş ekranı arka planı Bot ve sistem ayarları sayfasından değiştirilebilir. Giriş arka planı HTTPS üzerinden resim, GIF, MP4, WebM ve OGG kaynaklarını destekler; boş bırakıldığında siyah arka plan kullanılır.

Phishing alan adları [Discord-AntiScam](https://github.com/Discord-AntiScam/scam-links) listesinden 15 dakikada bir alınır ve yerel önbellekte tutulur. Bağlantılara istek gönderilmez; alan adı/alt alan adı karşılaştırılır. Listede olmayan saldırılar tespit edilmeyebilir. Discord ağ ve hız sınırları nedeniyle milisaniyelik silme garantisi yoktur. Botun Mesajları Yönet ve Üyeleri Zamanaşımına Uğrat izinleri ile hedef üyeden yüksek rolü gerekir. Phishing timeout süresi 12 saat, spam varsayılanı 10 dakikadır. Spam için aynı mesajın 3 saniyede 5 kez gelmesi gerekir.

Destek kanalları kullanıcı, destek rolü ve bot için izinlerle oluşturulur; @everyone görüntülemesi engellenir. Yönetici yetkisi olanlar Discord gereği görebilir. Savunmalar özel thread’dir; Thread Yönet izni olanlar erişebilir. Discord timeout’u tüm kanallarda yazmayı engellediğinden susturulan kişi botun DM düğmesiyle savunma gönderir; timeout kaldırılmaz. DM kapalıysa bu yol çalışmaz. Botun Kanalları Yönet, Özel Thread Oluştur, Thread Yönet, Thread İçinde Mesaj Gönder izinleri gerekir.

Mesaj silmede yazar ile silen kişi ayrıdır. `/clear` ve `/temizle` doğrudan komutu kullanan yetkiliyi kaydeder. Elle silmeler Denetim Kaydını Görüntüle izniyle kanal/yazar/zaman/adet üzerinden eşleştirilir. Birden fazla yetkili eşleşirse veya Discord kayıt üretmezse kimlik tahmin edilmez. Kişinin kendi mesajını silmesi denetim kaydına girmez. Eski mesaj düzenleme kayıtları 30 günlük saklama süresi dolana kadar kalabilir; yenileri üretilmez.

`ALLOWED_GUILD_IDS` izinli sunucuları, `BOT_OWNER_IDS` panelde listeyi değiştirebilen uygulama sahibini belirler. Genel kurulumu kapatmak için Installation → Install Link: None ve Bot → Public Bot: kapalı olmalıdır. Özel botu Discord uygulama sahibi/ekibi kurabilir. Ses/müzik kontrolü panelde rol/kullanıcı listesiyle sınırlıdır. Discord’un yerel sağ tık → Taşı eylemi sunucudaki Üyeleri Taşı iznine bağlıdır.

## Doğrulama ve veri

`npm test` HTTP OAuth2/CSRF akışı, yetki iptali, rol hiyerarşisi, sunucu izolasyonu, SQLite kalıcılığı, olaylar, mesaj temizleme ve müzik doğrulama testlerini çalıştırır. CI ayrıca Docker imajı oluşturur. Bu testler gerçek Discord/YouTube hesabıyla canlı müzik testi yerine geçmez.

`.env`, veri tabanları, özel anahtarlar ve `node_modules` Git’e alınmaz. @everyone ve rol ping’leri bastırılır; kanalda hatırlatma isteyen kullanıcı kendi bildirimiyle etiketlenir. Oturum çerezleri HttpOnly/SameSite; dışarıya açık panelde HTTPS zorunludur. Loglar olaydan sonra tutulur; bot kapalıyken geçmiş olaylar geriye dönük oluşturulmaz. Mesaj silen moderatör audit log alınmadan tahmin edilmez.

Yedek için botu kısa süre durdurup tüm `DATA_DIR` dizinini özel bir konuma kopyalayın; SQLite WAL dosyaları bulunabileceği için çalışan veritabanının yalnızca ana dosyasını kopyalamayın. `.env` yedeklerini depo dışında, özel saklayın.
