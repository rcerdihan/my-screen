# Üçüncü taraf bileşenler

My Screen kurulumu aşağıdaki bileşenleri değiştirmeden içerir.

## FFmpeg
- Sürüm: n9.0 (BtbN/FFmpeg-Builds, `ffmpeg-n9.0-latest-win64-lgpl-shared-9.0`)
- Lisans: GNU LGPL v3 veya sonrası (`resources/ffmpeg/LICENSE.txt`)
- Kaynak kod: https://ffmpeg.org/download.html , derleme betikleri: https://github.com/BtbN/FFmpeg-Builds
- Kurulumdaki `resources/ffmpeg` klasöründeki DLL'ler aynı sürümün başka bir derlemesiyle değiştirilebilir.

## Virtual Display Driver
- Proje: https://github.com/VirtualDrivers/Virtual-Display-Driver (sürücü 11.30.4.434, SignPath Foundation imzalı)
- Lisans: MIT (`resources/vdd/LICENSE.txt`)

## Electron ve npm paketleri
- Electron (MIT), ws (MIT), qrcode (MIT), selfsigned (MIT) ve bağımlılıkları.
