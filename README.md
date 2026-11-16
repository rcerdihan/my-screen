# My Screen

**İndir:** https://rcerdihan.github.io/my-screen/ · [Son sürüm](https://github.com/rcerdihan/my-screen/releases/latest)

Android telefonu Windows bilgisayarın ikinci ekranı olarak kullanır. Görüntü Wi-Fi etkin nokta veya USB kablo üzerinden, internete çıkmadan doğrudan telefona akar. Telefonda uygulama kurmak gerekmez; tarayıcı yeterlidir (Samsung Internet önerilir).

Ekran ffmpeg ile doğrudan Windows'tan (Desktop Duplication) yakalanır, NVIDIA NVENC (yoksa Intel Quick Sync) ile H.264'e kodlanır ve telefonda donanımla (WebCodecs) çözülür. Gönderilen kare hızı sanal ekranın yenileme hızıyla sınırlanır (A36: 120, Tab S6: 60).

İki ekran kartlı dizüstülerde sanal ekranı NVIDIA kartına ayarlamak (`vdd_settings.xml` → `<friendlyname>NVIDIA …</friendlyname>`) kareleri kopyalamadan kodlamayı sağlar; Intel kartta 2560×1600'de ~40 fps'te tıkanıyordu, NVIDIA'da sabit 60 fps ölçüldü.

## Kurulum (paylaşmak için)

`MyScreen-Setup-<sürüm>.exe` tek dosyadır: uygulamayı, ffmpeg'i (LGPL) ve Virtual Display Driver'ı (imzalı) içerir. Çalıştıran kişi bir kez yönetici onayı verir; kurulum:

- uygulamayı Program Files'a kurar, Başlat menüsü ve masaüstü kısayolu ekler,
- sanal ekran sürücüsünü kurar (bilgisayarda zaten bir Virtual Display Driver varsa dokunmaz),
- `C:\VirtualDisplayDriver` ayar klasörünü hazırlar ve kullanıcılara yazma izni verir,
- güvenlik duvarına uygulama için yalnızca yerel ağ adreslerinden gelen bağlantı izni ekler.

Kaldırınca güvenlik duvarı kuralı silinir; sürücü yalnızca bu kurulum kurduysa kaldırılır. Kurulum günlüğü: `%ProgramData%\MyScreen\setup.log`.

Kurulum dosyası imzasız olduğu için Windows "bilgisayarınızı korudu" uyarısı gösterir: **Ek bilgi → Yine de çalıştır**.

### Kurulum dosyasını üretme
1. `vendor\ffmpeg\` içine BtbN `ffmpeg-n9.0-latest-win64-lgpl-shared` arşivinin `bin\` içeriğini koy (ffplay/ffprobe gerekmez).
2. `vendor\vdd\` içine Virtual Display Driver'ın `MttVDD.inf`, `MttVDD.dll`, `mttvdd.cat` ve `LICENSE.txt` dosyalarını koy.
3. `npm install`, sonra `npm run dist` → `dist\MyScreen-Setup-<sürüm>.exe`.

## Gereksinimler (geliştirme)

- Windows 10/11, Node.js
- ffmpeg: `winget install Gyan.FFmpeg` (uygulama yolu kendisi bulur; başka bir yer için `MYSCREEN_FFMPEG` ortam değişkeni)
- İkinci ekran için bir sanal ekran sürücüsü (aşağıda)

## Çalıştırma

`start.bat` dosyasına çift tıkla (veya klasörde `npm install`, sonra `npm start`).

Başlat menüsüne kısayol eklemek için (masaüstüne de eklemek istersen sonuna `-Desktop` ekle):

```
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

Uygulama zaten açıkken kısayola tıklamak yeni kopya açmaz, mevcut pencereyi öne getirir. Simge `scripts\make-icon.ps1` ile üretilir.

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

### Cihaz seçimi
Paneldeki **Cihaz** listesinden bağlayacağın cihazı seç; sanal ekran o cihazın ekranına göre ayarlanır:

| Cihaz | Çözünürlük | Yenileme |
|---|---|---|
| Galaxy A36 (telefon) | 2340×1080 | 120 Hz |
| Galaxy Tab S6 (tablet) | 2560×1600 | 60 Hz |

Çözünürlük sürücünün ayar dosyasında yoksa uygulama ekler ve sürücüyü yeniden yükletir (yönetici izni gerekmez); bu sırada sanal ekran birkaç saniye kaybolup geri gelir. Yeni cihaz eklemek için `src/main.js` içindeki `DEVICES` listesine bir satır eklemek yeterli.

**Otomatik** seçeneğinde bağlanan cihazın sayfası ekranının çözünürlüğünü ve ölçtüğü yenileme hızını bildirir; sanal ekran buna göre ayarlanır (yeni bir çözünürlükte sürücü bir kez yeniden yüklenir). Tarayıcının "masaüstü sürümü" açıkken cihaz sahte bir ekran boyutu bildirdiği için otomatik ayar yapılmaz. Tarayıcının bildirdiği değer panelde görünür; cihazın gerçek panel çözünürlüğünden farklıysa elle profil seç.

My Screen açılınca sanal ekranı masaüstüne bağlar, kapanınca ayırır (son çözünürlük/hız/konum hatırlanır; yönetici izni gerekmez). Bunu paneldeki "Sanal ekranı uygulamayla birlikte aç ve kapat" kutusuyla kapatabilirsin. Uygulama çökerse ya da Görev Yöneticisi'nden sonlandırılırsa sanal ekran açık kalır; bir sonraki açılış/kapanışta düzelir, ya da `Win + P` → "Yalnızca bilgisayar ekranı".

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
- `src/display-helper.ps1` — sanal ekranı masaüstüne bağlayan/ayıran yardımcı
