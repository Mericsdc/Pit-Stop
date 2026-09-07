# Pit-Stop

![Pit-Stop](public/assets/banner.webp)

Türkçe Discord botu ve Discord ile giriş yapılan yönetim paneli. Node.js 24, discord.js 14, SQLite ve Lavalink kullanır.

- Ayrılan üyeler için kanal ve mesaj şablonu; katılan insan üyelere otomatik rol.
- Panelden tanımlanan `!komut` cevapları; büyük/küçük harf duyarsız tam eşleşme.
- Yetki kontrollü `/clear` ve `/temizle`; sabitlenmiş, sistem ve 14 günden eski mesajları korur.
- Üye, rol, zaman aşımı, mesaj düzenleme/silme, komut, ayar ve müzik kayıtları.
- YouTube / YouTube Music araması, YouTube ve Spotify bağlantıları, kuyruk, ses, DJ rolü.
- Sunucu başına kalıcı ayarlar, son 30 gün / en fazla 10.000 olay. Mesaj içerikleri ve bot token’ları loglanmaz.

## Web sitesi ve canlı panel

GitHub Pages adresi: **https://mericsdc.github.io/Pit-Stop/**

Pages, `public/` arayüzünün giriş sayfasını yayınlar. Node botu, OAuth2 oturumları, SQLite ve müzik arka ucu GitHub Pages üzerinde çalışmaz. Canlı panel bot sunucusunda çalışır; GitHub Pages giriş düğmesi bu panele yönlendirir. Kod, site ve sunucudaki çalışır uygulama ayrı yayın adımlarıdır.

Depoda **Settings → Pages → Source: GitHub Actions** seçin. Sunucu HTTPS ile hazır olduktan sonra **Settings → Secrets and variables → Actions → Variables** içinde `PUBLIC_PANEL_URL` değerini güvenli canlı panel adresi olarak ekleyin ve `Publish website` iş akışını yeniden çalıştırın. Bu değer yalnızca herkese açık URL olmalı; hiçbir token veya parola eklemeyin. Değer boşken site, canlı sunucu bağlantısının beklediğini açıkça gösterir.

## Discord kurulumu

1. [Developer Portal](https://discord.com/developers/applications) üzerinden Pit-Stop uygulamasını açın.
2. **Bot** sayfasında `Server Members Intent` ve `Message Content Intent` açın. Presence Intent gerekmez. Bot token’ı yalnızca oluşturulurken görünür; gerekiyorsa hesabın sahibi yeni token oluşturur.
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

## Doğrulama ve veri

`npm test` HTTP OAuth2/CSRF akışı, yetki iptali, rol hiyerarşisi, sunucu izolasyonu, SQLite kalıcılığı, olaylar, mesaj temizleme ve müzik doğrulama testlerini çalıştırır. CI ayrıca Docker imajı oluşturur. Bu testler gerçek Discord/YouTube hesabıyla canlı müzik testi yerine geçmez.

`.env`, veri tabanları, özel anahtarlar ve `node_modules` Git’e alınmaz. Bot mesajları kendiliğinden @everyone/rol/kullanıcı ping’i üretmez. Oturum çerezleri HttpOnly/SameSite; dışarıya açık panelde HTTPS zorunludur. Loglar olaydan sonra tutulur; bot kapalıyken geçmiş olaylar geriye dönük oluşturulmaz. Mesaj silen moderatör audit log alınmadan tahmin edilmez.

Yedek için botu kısa süre durdurup tüm `DATA_DIR` dizinini özel bir konuma kopyalayın; SQLite WAL dosyaları bulunabileceği için çalışan veritabanının yalnızca ana dosyasını kopyalamayın. `.env` yedeklerini depo dışında, özel saklayın.
