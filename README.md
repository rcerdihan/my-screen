# My Screen

Android telefonu Windows bilgisayarın ekranı olarak kullanır. Görüntü Wi-Fi etkin nokta veya USB kablo üzerinden, internete çıkmadan doğrudan telefona akar. Telefonda uygulama kurmak gerekmez; Chrome yeterlidir.

## Çalıştırma

`start.bat` dosyasına çift tıkla (veya klasörde `npm start`).

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

Adres ve QR kod her açılışta aynıdır; telefonda sayfayı ana ekrana ekleyip sonraki sefer doğrudan açabilirsin.

## Telefonda kullanım

- "Tam ekran başlat"a dokun; ekran yatay moda geçer.
- Dokun: tık. Sürükle: sürükleme. Basılı tut: sağ tık. İki parmak: kaydırma.
- Dokunmatik kontrolü PC'deki panelden kapatabilirsin.

## Gerçek ikinci ekran (masaüstünü genişletme)

Uygulama, Windows'un gördüğü herhangi bir ekranı yayınlar. Sanal bir monitör yokken ana ekranı yansıtır. Telefonu ayrı bir monitör gibi kullanmak için bir sanal ekran sürücüsü gerekir:

1. Açık kaynak **Virtual Display Driver** projesini (GitHub: `VirtualDrivers/Virtual-Display-Driver`) indirip kur. Sürücü kurulumu yönetici izni ister.
2. Windows Ayarlar → Sistem → Ekran'da yeni monitör görünür; "Bu ekranları genişlet"i seç.
3. My Screen'de "Gönderilecek ekran" listesinden sanal monitörü seç.

Sanal monitörün çözünürlüğünü telefonun en-boy oranına yakın ayarlarsan (ör. 2400×1080) görüntü ekranı tam doldurur.

## Sorun giderme

- **Telefon etkin noktada "internet yok" diyor:** Hyper-V/WSL/Docker ağı Windows'un internet paylaşımını kendine bağlamış olabilir. Etkin noktayı kapat, yönetici PowerShell'de `Restart-Service hns -Force` çalıştır, etkin noktayı yeniden aç.
- **Sayfa telefonda açılmıyor (`ERR_TOO_MANY_RETRIES` vb.):** Başka bir tarayıcı dene (ör. Samsung Internet). Tarayıcı VPN'i, veri tasarrufu veya reklam engelleyici yerel adreslere erişimi kesebilir.
- **Kare hızı 60'a çıkmıyor:** Yakalanan ekran 144 Hz ise yakalama en fazla 48 fps verir (144'ün üçte biri). Ekranı 60 Hz'e almak ya da 60 Hz'lik sanal ekranı yayınlamak 60 fps'e izin verir. Paneldeki yayın satırı ve `%APPDATA%\my-screen\stats.log` anlık kare hızını, kodlayıcıyı ve sınırlayan etkeni gösterir.
- **İstek PC'ye ulaşıyor mu:** Paneldeki "Son istek" satırı ve `%APPDATA%\my-screen\requests.log` dosyası telefondan gelen her bağlantıyı gösterir.

## Yapı

- `src/main.js` — Electron ana süreç: HTTP/WebSocket sunucusu, ağ arayüzü algılama, QR, fare girdisi
- `src/host/` — PC kontrol paneli; ekranı yakalar ve WebRTC ile gönderir
- `src/client/` — telefonda açılan sayfa; görüntüyü oynatır, dokunuşları gönderir
- `src/input-helper.ps1` — fareyi hareket ettiren yardımcı süreç
