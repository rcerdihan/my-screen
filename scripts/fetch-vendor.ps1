# Kuruluma konan üçüncü taraf dosyaları resmi kaynaklarından, sabit sürüm ve SHA-256 kontrolüyle
# indirir: vendor\ffmpeg (FFmpeg LGPL derlemesi) ve vendor\vdd (Virtual Display Driver).
# Hem yerelde hem GitHub Actions'ta aynı betik kullanılır, böylece kurulum dosyası
# doğrulanabilir şekilde kaynaktan üretilir. Sürüm yükseltmek için aşağıdaki adres ve özetleri değiştir.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
$cache = Join-Path $vendor '_indirilen'
New-Item -ItemType Directory -Force $cache | Out-Null

$files = @(
  @{
    Name   = 'ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-shared-9.0.zip'
    Url    = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-15-12-40/ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-shared-9.0.zip'
    Sha256 = '6305750bb1b4e3f80d17a6644fec1cf57eef12106c4f9192ddb05e14a6b522b0'
  },
  @{
    Name   = 'VirtualDisplayDriver-x86.Driver.Only.zip' # adı x86 olsa da içindeki sürücü x64 (NTamd64)
    Url    = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip'
    Sha256 = 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a'
  },
  @{
    Name   = 'VDD-LICENSE.txt'
    Url    = 'https://raw.githubusercontent.com/VirtualDrivers/Virtual-Display-Driver/25.7.23/LICENSE'
    Sha256 = 'c2285c867ddc9b88f43b4f8fa2c77a9eec66207166c1217b37353a2ccd62ac03'
  }
)

foreach ($f in $files) {
  $path = Join-Path $cache $f.Name
  $ok = (Test-Path $path) -and ((Get-FileHash $path -Algorithm SHA256).Hash -eq $f.Sha256.ToUpper())
  if (-not $ok) {
    Write-Host "indiriliyor: $($f.Url)"
    Invoke-WebRequest -Uri $f.Url -OutFile $path -UseBasicParsing
    $hash = (Get-FileHash $path -Algorithm SHA256).Hash
    if ($hash -ne $f.Sha256.ToUpper()) {
      Remove-Item $path -Force
      throw "SHA-256 uyuşmadı: $($f.Name) beklenen $($f.Sha256) bulunan $hash"
    }
  }
  Write-Host "dogrulandi: $($f.Name)"
}

# ffmpeg: yalnızca ffmpeg.exe, DLL'ler ve lisans (ffplay/ffprobe gerekmiyor)
$ffDir = Join-Path $vendor 'ffmpeg'
$tmp = Join-Path $cache 'ffmpeg-acik'
Remove-Item $ffDir, $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive (Join-Path $cache $files[0].Name) $tmp
$bin = Get-ChildItem $tmp -Recurse -Directory -Filter bin | Select-Object -First 1
New-Item -ItemType Directory -Force $ffDir | Out-Null
Get-ChildItem $bin.FullName -File | Where-Object { $_.Name -notin 'ffplay.exe', 'ffprobe.exe' } | Copy-Item -Destination $ffDir
$lic = Get-ChildItem $tmp -Recurse -File -Filter 'LICENSE.txt' | Select-Object -First 1
if ($lic) { Copy-Item $lic.FullName (Join-Path $ffDir 'LICENSE.txt') }
Remove-Item $tmp -Recurse -Force

# Virtual Display Driver: imzalı sürücü dosyaları ve lisans
$vddDir = Join-Path $vendor 'vdd'
$tmp = Join-Path $cache 'vdd-acik'
Remove-Item $vddDir, $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive (Join-Path $cache $files[1].Name) $tmp
New-Item -ItemType Directory -Force $vddDir | Out-Null
foreach ($n in 'MttVDD.inf', 'MttVDD.dll', 'mttvdd.cat') {
  $src = Get-ChildItem $tmp -Recurse -File -Filter $n | Select-Object -First 1
  if (-not $src) { throw "sürücü paketinde $n yok" }
  Copy-Item $src.FullName $vddDir
}
Copy-Item (Join-Path $cache $files[2].Name) (Join-Path $vddDir 'LICENSE.txt')
Remove-Item $tmp -Recurse -Force

$sig = Get-AuthenticodeSignature (Join-Path $vddDir 'mttvdd.cat')
Write-Host "surucu imzasi: $($sig.Status) ($($sig.SignerCertificate.Subject))"
if ($sig.Status -ne 'Valid') { throw 'sürücü kataloğu imzası geçersiz' }
Write-Host 'vendor hazir'
