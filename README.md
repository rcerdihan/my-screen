<p align="center"><img src="docs/icon-64.png" width="64" height="64" alt=""></p>

<h1 align="center">My Screen</h1>

<p align="center">
  Android telefonunu veya tabletini Windows bilgisayarının <b>gerçek ikinci ekranı</b> yap.<br>
  Cihaza uygulama kurmadan, tarayıcıdan, Wi-Fi ya da USB üzerinden, 120 fps'e kadar.
</p>

<p align="center">
  <a href="https://rcerdihan.github.io/my-screen/"><b>İndirme sayfası</b></a> ·
  <a href="https://github.com/rcerdihan/my-screen/releases/latest">Son sürüm</a> ·
  <a href="#hızlı-başlangıç">Hızlı başlangıç</a> ·
  <a href="#sorun-giderme">Sorun giderme</a>
</p>

---

## Özellikler

- **Gerçek ikinci monitör:** Windows cihazı ayrı bir ekran olarak görür, masaüstü genişler. Sanal ekran uygulama açılınca bağlanır, kapanınca kaybolur.
- **Akıcı görüntü:** Ekran, kopyalanmadan ekran kartında (NVIDIA NVENC, yoksa Intel Quick Sync) H.264'e kodlanır ve cihazda donanımla çözülür. Cihazın yenileme hızında akar (telefonda 120, tablette 60 fps ölçüldü).
- **Uygulama gerekmez:** Cihazda tarayıcı yeterli. QR kodu okut, sayfayı ana ekrana ekle.
- **Otomatik ayar:** Bağlanan cihazın çözünürlüğünü ve yenileme hızını algılar, sanal ekranı ona göre ayarlar.
- **Dokunmatik kontrol:** Dokun = tık, sürükle = sürükle, basılı tut = sağ tık, iki parmak = kaydırma. Paint gibi uygulamalarda el yazısı akıcı çıkar.
- **Yalnızca yerel ağ:** Görüntü internete çıkmaz. Bağlantı şifreli (HTTPS/WSS), yalnızca özel ağ adreslerinden ve QR koddaki gizli anahtarla kabul edilir.
- **Tek dosya kurulum:** Uygulama, ffmpeg ve sanal ekran sürücüsü tek bir `MyScreen-Setup.exe` içinde gelir.

## Hızlı başlangıç

1. [**MyScreen-Setup.exe**'yi indir](https://github.com/rcerdihan/my-screen/releases/latest/download/MyScreen-Setup.exe) ve çalıştır.
   Windows "bilgisayarınızı korudu" derse **Ek bilgi → Yine de çalıştır**, sonra yönetici onayı ver (dosya imzasız).
2. **My Screen**'i Başlat menüsünden aç.
3. Cihazı bağla:
   - **Wi-Fi etkin nokta:** Uygulamada "Etkin nokta ayarlarını aç" → Windows mobil etkin noktasını aç (5 GHz önerilir) → cihazı bu ağa bağla.
   - **USB:** Cihazı kabloyla tak → cihazda Ayarlar → Bağlantılar → Mobil etkin nokta ve tethering → **USB tethering**.
4. Pencerede çıkan **QR kodu** cihazla okut (Samsung'da Samsung Internet, diğerlerinde Chrome).
5. İlk seferde "bağlantı gizli değil" uyarısında **Gelişmiş → Yine de devam et** (sertifikayı uygulama bilgisayarında kendisi üretir).
6. **Tam ekran başlat**'a dokun. Pencereleri laptop ekranının kenarından cihaza sürükle ya da `Win + Shift + ←/→` ile taşı.

Adres ve QR kod her açılışta aynıdır; sayfayı cihazın ana ekranına ekleyip sonraki sefer tek dokunuşla açabilirsin.

## Gereksinimler

| | |
|---|---|
| Bilgisayar | Windows 10/11, 64 bit; NVIDIA veya Intel ekran kartı |
| Cihaz | Android telefon/tablet; Samsung Internet veya güncel Chrome |
| Bağlantı | Bilgisayarda mobil etkin nokta ya da cihazda USB tethering |

**Bilinen sınırlar:** AMD ekran kartları henüz desteklenmiyor · iPhone/iPad denenmedi (Safari'de bağlantı sorunları olabilir) · kalem basıncı yok · aynı anda tek cihaz bağlanabilir.

## Kullanım

Kontrol panelindeki ayarlar:

| Ayar | Ne yapar |
|---|---|
| **Cihaz** | *Otomatik* (bağlanan cihaza göre) ya da hazır profil: Galaxy A36 (2340×1080 @ 120 Hz), Galaxy Tab S6 (2560×1600 @ 60 Hz). Yeni bir çözünürlükte sürücü bir kez yeniden yüklenir, sanal ekran birkaç saniye kaybolup geri gelir. |
| **Sanal ekranın konumu** | Windows'ta laptop ekranının sağında ya da solunda. Cihazı masada nereye koyduysan onu seç. |
| **Gönderilecek ekran** | Varsayılan sanal ekran; istersen laptop ekranını yansıtabilirsin. |
| **Kalite** | 15–60 Mbps. Gerçek kullanım genelde 5–30 Mbps. |
| **Dokunmatik kontrol** | Cihazdan fareyi kontrol etmeyi açar/kapatır. |
| **Sanal ekranı uygulamayla birlikte aç ve kapat** | Kapatırsan sanal ekran uygulama kapalıyken de kalır. |
| **Bağlantıyı kes** | Cihazın bağlantısını keser; cihazda "Yeniden bağlan" düğmesi çıkar. |

Panelde canlı kare hızı, bit hızı ve kodlayıcı görünür. Cihazda adresin sonuna `&hud` eklersen anlık çizilen kare ve çözme süresi gösterilir.

## Sorun giderme

<details>
<summary><b>Kare hızı düşük ya da 30'a kilitli</b></summary>

- Laptopu **prize tak**: pilde Windows ve tarayıcılar kare hızını yarıya düşürebiliyor.
- İki ekran kartlı dizüstülerde, ikinci ekranda video oynatan tarayıcıyı **Ayarlar → Sistem → Ekran → Grafik** bölümünden "Yüksek performans" karta al.
- Sanal ekran sürücüsünü NVIDIA kartına ayarlamak kareleri kopyalamadan kodlamayı sağlar: `C:\VirtualDisplayDriver\vdd_settings.xml` içinde `<friendlyname>` değerini ekran kartının adı yap (ör. `NVIDIA GeForce RTX 3060 Laptop GPU`), sonra cihaz profilini yeniden seç.
- Maç yayınları gibi videolar saniyede 50 (bazı bölümlerde 25) kare çekilmiş olabilir; ekranda değişmeyen kare gönderilmez.
</details>

<details>
<summary><b>Etkin noktaya bağlanınca "internet yok" diyor</b></summary>

Görüntü için internet gerekmez. Bilgisayarda Hyper-V/WSL/Docker varsa bunların ağı Windows'un internet paylaşımını kendine bağlamış olabilir: etkin noktayı kapat, yönetici PowerShell'de `Restart-Service hns -Force` çalıştır, etkin noktayı yeniden aç. Ya da USB tethering kullan.
</details>

<details>
<summary><b>Sayfa cihazda açılmıyor (ERR_TOO_MANY_RETRIES vb.)</b></summary>

Başka bir tarayıcı dene (bazı telefonlarda Chrome yerel adrese bağlanamıyor, Samsung Internet bağlanıyor). Tarayıcı VPN'i, veri tasarrufu ya da reklam engelleyici yerel adreslere erişimi kesebilir. Paneldeki "Son istek" satırı cihazdan bilgisayara bir istek ulaşıp ulaşmadığını gösterir.
</details>

<details>
<summary><b>Otomatik mod yanlış çözünürlük seçiyor</b></summary>

Tarayıcının **masaüstü sürümü** açıksa cihaz sahte bir ekran boyutu bildirir; uygulama bu durumda ayar yapmaz ve cihazda uyarı gösterir. Tarayıcı menüsünden kapat. Cihazın bildirdiği değer panelde görünür; beğenmezsen hazır profil seç.
</details>

<details>
<summary><b>Pencereler hep ana ekranda açılıyor</b></summary>

Bu Windows davranışı. `Win + Shift + ←/→` ile pencereyi cihaza taşı; çoğu uygulama son kapandığı ekranı hatırlar. Ayarlar → Kişiselleştirme → Görev çubuğu → "Görev çubuğumu tüm ekranlarda göster" da işe yarar.
</details>

<details>
<summary><b>Uygulama çöktü, sanal ekran kaldı</b></summary>

`Win + P` → "Yalnızca bilgisayar ekranı". Uygulamayı bir sonraki açıp kapatışta da düzelir.
</details>

**Günlükler:** kurulum `%ProgramData%\MyScreen\setup.log`, yayın ölçümleri `%APPDATA%\my-screen\stats.log`, cihaz bağlantıları `%APPDATA%\my-screen\requests.log`. Sorun bildirirken bunları ekle.

## Nasıl çalışır?

```
 Windows                                                     Cihaz (tarayıcı)
 ┌───────────────────────────────────────────────┐          ┌──────────────────────────┐
 │ Virtual Display Driver  →  sanal monitör       │          │                          │
 │        │                                       │  H.264   │ WebCodecs (donanım)      │
 │ ffmpeg ddagrab (Desktop Duplication)           │ ───────► │   → <video> katmanı      │
 │        → NVENC / Quick Sync, kopyasız          │  WSS     │                          │
 │ Electron: HTTPS + WebSocket sunucusu, panel    │ ◄─────── │ dokunuşlar → fare        │
 │        ← SendInput (fare)                      │          │                          │
 └───────────────────────────────────────────────┘          └──────────────────────────┘
```

- Sanal ekran [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) ile oluşturulur; uygulama çözünürlüğü, yenileme hızını ve konumu kendisi ayarlar (gerekirse sürücüyü yönetici izni olmadan yeniden yükletir).
- ffmpeg sanal ekranı, bulunduğu ekran kartında yakalar ve aynı kartta kodlar. Saniye, ekranın yenileme hızı kadar dilime bölünür ve her dilimden en fazla bir kare gönderilir.
- Kareler HTTPS sayfasına WebSocket ile gider; cihaz WebCodecs ile çözüp `MediaStreamTrackGenerator` ile bir `<video>` öğesinde gösterir (desteklenmezse tuval).
- Dokunuşlar WebSocket üzerinden geri gelir ve `SendInput` ile gerçek fare girdisine çevrilir.

## Geliştirme

**Kaynaktan çalıştırma**

```bash
npm install
npm start
```

ffmpeg'i `vendor\ffmpeg\` klasöründe, kurulu bir Gyan.FFmpeg paketinde ya da `PATH`'te arar (`MYSCREEN_FFMPEG` ortam değişkeniyle de verilebilir). Sanal ekran için Virtual Display Driver kurulu olmalı (`winget install VirtualDrivers.Virtual-Display-Driver`, ardından VDD Control → Install). Geliştirme kopyası için Başlat menüsü kısayolu: `powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1`.

**Kurulum dosyasını üretme**

1. `powershell -ExecutionPolicy Bypass -File scripts\fetch-vendor.ps1` → ffmpeg (LGPL) ve Virtual Display Driver'ı sabit sürüm ve SHA-256 kontrolüyle `vendor\` altına indirir.
2. `npm run dist` → `dist\MyScreen-Setup-<sürüm>.exe`.

GitHub'da her `v*` etiketi aynı adımları [Actions](.github/workflows/build.yml) üzerinde çalıştırır ve kurulumu taslak sürüme ekler; yayınlamak elle onaylanır.

Kurulum (`installer/setup-driver.ps1`, yönetici olarak) sürücüyü kurar (bilgisayarda zaten bir Virtual Display Driver varsa dokunmaz), `C:\VirtualDisplayDriver` ayar klasörünü hazırlayıp kullanıcılara yazma izni verir ve güvenlik duvarına yalnızca yerel ağ adreslerinden izin ekler. Kaldırınca güvenlik duvarı kuralı silinir; sürücü yalnızca kurulum kurduysa kaldırılır.

**Proje yapısı**

| Yol | İçerik |
|---|---|
| `src/main.js` | Electron ana süreç: HTTPS/WebSocket sunucusu, sertifika, ağ algılama, QR, cihaz profilleri, sanal ekran yönetimi |
| `src/native.js` | ffmpeg ile yakalama ve kodlama, kare sınırlama, kareleri cihaza gönderme |
| `src/host/` | Kontrol paneli |
| `src/client/` | Cihazda açılan sayfa: çözme, gösterme, dokunmatik |
| `src/display-helper.ps1` | Sanal ekranı bağlama/ayırma, mod ve konum değiştirme |
| `src/input-helper.ps1` | Dokunuşları fare girdisine çeviren yardımcı |
| `installer/` | Kurulum betiği, NSIS eklentisi, varsayılan sürücü ayarı |
| `docs/` | İndirme sayfası (GitHub Pages) |

Electron/WebRTC tabanlı ilk sürüm (~48 fps) `webrtc-stabil` etiketinde duruyor.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org) (başvuru hazırlık aşamasında; onaylanana kadar kurulum dosyaları imzasız).

- Kurulum dosyaları GitHub Actions'ta bu repodaki kaynaktan üretilir ([build.yml](.github/workflows/build.yml)); üçüncü taraf dosyalar sabit sürüm ve SHA-256 kontrolüyle resmi kaynaklarından indirilir ([fetch-vendor.ps1](scripts/fetch-vendor.ps1)).
- Committers and reviewers: [@rcerdihan](https://github.com/rcerdihan) · Approvers: [@rcerdihan](https://github.com/rcerdihan)
- Privacy policy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

Ayrıntılar: [Code signing policy sayfası](https://rcerdihan.github.io/my-screen/code-signing.html).

## Üçüncü taraf bileşenler

Kurulum FFmpeg (LGPL v3) ve Virtual Display Driver (MIT) içerir; ayrıntılar [THIRD_PARTY.md](THIRD_PARTY.md) dosyasında.

## Lisans

My Screen [MIT lisansı](LICENSE) ile dağıtılır.
