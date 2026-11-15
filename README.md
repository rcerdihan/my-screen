# My Screen

Android telefonu Windows bilgisayarın ikinci ekranı olarak kullanır. Görüntü Wi-Fi etkin nokta veya USB kablo üzerinden, internete çıkmadan doğrudan telefona akar. Telefonda uygulama kurmak gerekmez; tarayıcı yeterlidir (Samsung Internet önerilir).

Ekran ffmpeg ile doğrudan Windows'tan (Desktop Duplication) yakalanır, NVIDIA NVENC (yoksa Intel Quick Sync) ile H.264'e kodlanır ve telefonda donanımla (WebCodecs) çözülür. Test ortamında 2340×1080'de 140+ fps ölçüldü.

## Gereksinimler

- Windows 10/11, Node.js
- ffmpeg: `winget install Gyan.FFmpeg` (uygulama yolu kendisi bulur; başka bir yer için `MYSCREEN_FFMPEG` ortam değişkeni)
- İkinci ekran için bir sanal ekran sürücüsü (aşağıda)

## Çalıştırma

`start.bat` dosyasına çift tıkla (veya klasörde `npm install`, sonra `npm start`).

İlk açılışta Windows Güvenlik Duvarı izin sorarsa **hem özel hem ortak ağlar** için izin ver; yoksa telefon bağlanamaz.

## Telefonu bağlama

### Wi-Fi etkin nokta
1. Uygulamada "Etkin nokta ayarlarını aç"a bas ve Windows mobil etkin noktasını aç (bant: 5 GHz önerilir).
2. Telefonu bu etkin noktanın Wi-Fi ağına bağla.
3. Uygulamadaki "Wi-Fi etkin nokta" kartında çıkan QR kodu telefonla okut.

Windows, bilgisayarın kendisinde hiçbir bağlantı yokken etkin noktayı açmayabilir. O durumda USB yolunu kullan.

### USB kablo
1. Telefonu kabloyla bilgisayara tak.
2. Telefonda: Ayarlar → Bağlantılar → Mobil etkin nokta ve tethering → **USB tethering**'i aç.
3. Uygulamadaki "USB kablo" kartında çıkan QR kodu okut.

USB tethering açıkken bilgisayar telefonun internetini de kullanabilir. Mobil veri harcanmasın istiyorsan telefonda mobil veriyi kapat; ekran yayını bundan etkilenmez.

### Sertifika uyarısı
Sayfa HTTPS ile açılır (telefon tarayıcısı görüntü çözmeyi yalnızca güvenli bağlantıda açar). Sertifikayı uygulama ilk açılışta bu bilgisayarda üretir, bu yüzden telefon bir kez "bağlantı gizli değil" uyarısı verir: **Gelişmiş → Yine de devam et**.

Adres ve QR kod her açılışta aynıdır; sayfayı ana ekrana ekleyip sonraki sefer doğrudan açabilirsin. Eski `http://…:8787` kısayolları yeni adrese yönlendirilir.

## Telefonda kullanım

- "Tam ekran başlat"a dokun; ekran yatay moda geçer.
- Dokun: tık. Sürükle: sürükleme. Basılı tut: sağ tık. İki parmak: kaydırma.
- Dokunmatik kontrolü PC'deki panelden kapatabilirsin.
- Adrese `&hud` eklersen telefonda anlık fps ve çözme süresi görünür.

Kare hızı ekrandaki harekete göre değişir: ekran dururken kare gönderilmez, hızlı hareket ve videolarda 120 fps'in üstüne çıkabilir.

## Gerçek ikinci ekran (masaüstünü genişletme)

Sanal monitör yokken uygulama ana ekranı yansıtır. Telefonu ayrı bir monitör gibi kullanmak için:

1. **Virtual Display Driver**'ı kur: `winget install VirtualDrivers.Virtual-Display-Driver`, ardından "VDD Control" uygulamasında **Install**.
2. Telefonun çözünürlüğünü `C:\VirtualDisplayDriver\vdd_settings.xml` içine ekle (ör. Galaxy A36 için 2340×1080), sürücüyü yeniden başlat (yönetici): `pnputil /restart-device "ROOT\DISPLAY\0000"`.
3. `Win + P` → Genişlet; Ayarlar → Ekran'da sanal ekranı 2340×1080 @ 120 Hz yap.
4. My Screen sanal ekranı kendiliğinden seçer.

Pencereler varsayılan olarak ana ekranda açılır; `Win + Shift + →` ile telefona taşı. Ayarlar → Kişiselleştirme → Görev çubuğu → "Görev çubuğumu tüm ekranlarda göster" kullanışlıdır.

## Sorun giderme

- **Telefon etkin noktada "internet yok" diyor:** Hyper-V/WSL/Docker ağı Windows'un internet paylaşımını kendine bağlamış olabilir. Etkin noktayı kapat, yönetici PowerShell'de `Restart-Service hns -Force` çalıştır, etkin noktayı yeniden aç.
- **Sayfa telefonda açılmıyor (`ERR_TOO_MANY_RETRIES` vb.):** Başka bir tarayıcı dene (ör. Samsung Internet). Tarayıcı VPN'i, veri tasarrufu veya reklam engelleyici yerel adreslere erişimi kesebilir.
- **Görüntü gelmiyor:** Paneldeki hata satırına bak (ffmpeg yok, ekran bulunamadı vb.). Ayrıntılar `%APPDATA%\my-screen\stats.log` dosyasında.
- **İstek PC'ye ulaşıyor mu:** Paneldeki "Son istek" satırı ve `%APPDATA%\my-screen\requests.log` dosyası telefondan gelen her bağlantıyı gösterir.

Eski (Electron/WebRTC, ~48 fps) sürüm git'te `webrtc-stabil` etiketiyle duruyor.

## Yapı

- `src/main.js` — Electron ana süreç: HTTPS/WebSocket sunucusu, sertifika, ağ arayüzü algılama, QR, fare girdisi
- `src/native.js` — ffmpeg ile yakalama ve kodlama, kareleri telefona gönderme
- `src/host/` — PC kontrol paneli
- `src/client/` — telefonda açılan sayfa: kareleri çözer ve çizer, dokunuşları gönderir
- `src/input-helper.ps1` — fareyi hareket ettiren yardımcı süreç
