# Başlat menüsüne "My Screen" kısayolu ekler (yönetici izni gerekmez).
#   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1           -> Başlat menüsü
#   powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1 -Desktop  -> ayrıca masaüstü
# Kaldırmak için: Başlat menüsünde My Screen'e sağ tıkla → Kaldır değil, "Dosya konumunu aç" ve .lnk'yi sil.
param([switch]$Desktop)

$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'
if (-not (Test-Path $electron)) { throw "Electron bulunamadı: $electron (önce 'npm install' çalıştır)" }

$targets = @([Environment]::GetFolderPath('Programs'))
if ($Desktop) { $targets += [Environment]::GetFolderPath('Desktop') }

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $targets) {
  $path = Join-Path $dir 'My Screen.lnk'
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $electron
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Android telefonu ikinci ekran olarak kullan'
  $lnk.WindowStyle = 1
  $lnk.Save()
  "Oluşturuldu: $path"
}
