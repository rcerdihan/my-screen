# My Screen kurulum yardımcısı. Kurulum programı bunu yönetici olarak çalıştırır.
#   -Action install   : sanal ekran sürücüsünü kurar (zaten varsa dokunmaz), ayar klasörünü hazırlar,
#                       güvenlik duvarına uygulama için yerel ağ izni ekler.
#   -Action uninstall : güvenlik duvarı kuralını siler; sürücüyü yalnızca bu kurulum kurduysa kaldırır.
# Günlük: %ProgramData%\MyScreen\setup.log
param(
  [Parameter(Mandatory)] [ValidateSet('install', 'uninstall')] [string]$Action,
  [Parameter(Mandatory)] [string]$ResDir,   # ...\resources (içinde vdd\ ve setup\)
  [string]$AppExe = ''
)

$ErrorActionPreference = 'Continue'
# 32-bit PowerShell'de SetupAPI kök aygıtı oluşturamıyor (ERROR_IN_WOW64, -536870347). 64-bit'te yeniden başlat.
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
  $ps64 = Join-Path $env:WINDIR 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
  $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Action', $Action, '-ResDir', $ResDir)
  if ($AppExe) { $relaunch += @('-AppExe', $AppExe) }
  & $ps64 @relaunch
  exit $LASTEXITCODE
}
$logDir = Join-Path $env:ProgramData 'MyScreen'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'setup.log'
function Log($text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Action] $text" | Add-Content -Path $log -Encoding UTF8 }

$hardwareId = 'Root\MttVDD'
$settingsDir = 'C:\VirtualDisplayDriver'
$marker = Join-Path $settingsDir '.myscreen-installed'
$ruleName = 'My Screen'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RootDevice {
  [StructLayout(LayoutKind.Sequential)]
  struct SP_DEVINFO_DATA { public int cbSize; public Guid ClassGuid; public int DevInst; public IntPtr Reserved; }
  [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid classGuid, IntPtr hwnd);
  [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool SetupDiCreateDeviceInfo(IntPtr set, string name, ref Guid classGuid, string desc, IntPtr hwnd, int flags, ref SP_DEVINFO_DATA data);
  // CharSet.Unicode şart: yoksa ...PropertyA çağrılır, UTF-16 kimlik "R" olarak kaydedilir ve
  // aygıt "Unknown" kalır (0.1.0-0.1.3 hatası).
  [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool SetupDiSetDeviceRegistryProperty(IntPtr set, ref SP_DEVINFO_DATA data, int prop, byte[] buf, int size);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiCallClassInstaller(int fn, IntPtr set, ref SP_DEVINFO_DATA data);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("newdev.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool UpdateDriverForPlugAndPlayDevices(IntPtr hwnd, string hwid, string inf, int flags, out bool reboot);

  // devcon install ile aynı adımlar: kök aygıt oluştur, donanım kimliğini ver, kaydet, sürücüyü bağla.
  public static string Create(string hwid, string inf) {
    var displayClass = new Guid("4d36e968-e325-11ce-bfc1-08002be10318");
    IntPtr set = SetupDiCreateDeviceInfoList(ref displayClass, IntPtr.Zero);
    if (set == new IntPtr(-1)) return "liste " + Marshal.GetLastWin32Error();
    try {
      var data = new SP_DEVINFO_DATA(); data.cbSize = Marshal.SizeOf(data);
      if (!SetupDiCreateDeviceInfo(set, "Display", ref displayClass, null, IntPtr.Zero, 1 /*DICD_GENERATE_ID*/, ref data)) return "olustur " + Marshal.GetLastWin32Error();
      byte[] ids = System.Text.Encoding.Unicode.GetBytes(hwid + "\0\0");
      if (!SetupDiSetDeviceRegistryProperty(set, ref data, 1 /*SPDRP_HARDWAREID*/, ids, ids.Length)) return "kimlik " + Marshal.GetLastWin32Error();
      if (!SetupDiCallClassInstaller(0x19 /*DIF_REGISTERDEVICE*/, set, ref data)) return "kaydet " + Marshal.GetLastWin32Error();
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return Bind(hwid, inf);
  }

  // Sürücüyü bu donanım kimliğindeki aygıtlara bağla. Yeni kaydedilen aygıt PnP'ye hemen
  // görünmeyebiliyor (ERROR_NO_SUCH_DEVINST, -536870389); birkaç kez bekleyip yeniden dene.
  public static string Bind(string hwid, string inf) {
    int err = 0;
    for (int i = 0; i < 10; i++) {
      bool reboot;
      if (UpdateDriverForPlugAndPlayDevices(IntPtr.Zero, hwid, inf, 1 /*INSTALLFLAG_FORCE*/, out reboot))
        return reboot ? "ok-yeniden-baslatma" : "ok";
      err = Marshal.GetLastWin32Error();
      System.Threading.Thread.Sleep(1000);
    }
    return "surucu " + err;
  }
}
"@

function Get-VddDevices {
  Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_HardwareIds -ErrorAction Stop).Data -contains $hardwareId } catch { $false }
  }
}

if ($Action -eq 'install') {
  Log "basladi ResDir=$ResDir AppExe=$AppExe"

  # 1) Ayar klasörü: uygulama çözünürlük eklerken bu dosyayı yazıyor; kullanıcılara yazma izni ver.
  New-Item -ItemType Directory -Force $settingsDir | Out-Null
  $settings = Join-Path $settingsDir 'vdd_settings.xml'
  if (-not (Test-Path $settings)) {
    Copy-Item (Join-Path $ResDir 'setup\vdd_settings.xml') $settings -Force
    Log 'varsayilan vdd_settings.xml kopyalandi'
  }
  & icacls $settingsDir /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null
  Log "ayar klasoru izni: $LASTEXITCODE"

  # 2) Sürücü: zaten kurulu bir sanal ekran varsa ikinci bir tane ekleme.
  $inf = Join-Path $ResDir 'vdd\MttVDD.inf'
  # Eski sürümlerin yanlış kimlikle ("R") oluşturduğu sürücüsüz aygıtları temizle.
  Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'ROOT\DISPLAY\*' } | ForEach-Object {
    $ids = @(try { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_HardwareIds -ErrorAction Stop).Data } catch { })
    $ids = @($ids | Where-Object { $_ })
    if ($_.Status -ne 'OK' -and ($ids.Count -eq 0 -or ($ids.Count -eq 1 -and $ids[0] -eq 'R'))) {
      $o = & pnputil.exe /remove-device "$($_.InstanceId)" 2>&1 | Out-String
      Log "bozuk aygit silindi $($_.InstanceId): $LASTEXITCODE $($o -replace '\s+', ' ')"
    }
  }
  $existing = @(Get-VddDevices)
  $working = @($existing | Where-Object { $_.Status -eq 'OK' })
  if ($working.Count -gt 0) {
    Log "sanal ekran zaten var ($($working.InstanceId -join ', ')), surucu kurulmadi"
  } else {
    $out = & pnputil.exe /add-driver "$inf" /install 2>&1 | Out-String
    Log "pnputil add-driver: $LASTEXITCODE $($out -replace '\s+', ' ')"
    if ($existing.Count -gt 0) {
      # Önceki kurulumdan kalan, sürücüsü bağlanmamış aygıt: yenisini ekleme, sürücüyü ona bağla.
      Log "surucusuz aygit bulundu ($($existing.InstanceId -join ', ') durum=$($existing.Status -join ','))"
      $r = [RootDevice]::Bind($hardwareId, $inf)
    } else {
      $r = [RootDevice]::Create($hardwareId, $inf)
    }
    Log "kok aygit: $r"
    if ($r -notlike 'ok*') {
      & pnputil.exe /scan-devices | Out-Null
      Start-Sleep -Seconds 3
    }
    $after = @(Get-VddDevices)
    Log "aygit durumu: $(($after | ForEach-Object { "$($_.InstanceId)=$($_.Status)" }) -join ', ')"
    if ($r -like 'ok*' -or @($after | Where-Object { $_.Status -eq 'OK' }).Count -gt 0) {
      Set-Content -Path $marker -Value (Get-Date -Format o) -Encoding ASCII
    }
  }

  # 3) Güvenlik duvarı: telefon/tablet yerel ağdan bağlanabilsin (yalnızca özel ağ adresleri).
  if ($AppExe) {
    & netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
    $o = & netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow program="$AppExe" enable=yes profile=any remoteip=localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 2>&1 | Out-String
    Log "guvenlik duvari: $LASTEXITCODE $($o.Trim())"
  }
  Log 'bitti'
}

if ($Action -eq 'uninstall') {
  Log 'basladi'
  & netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
  Log "guvenlik duvari kurali silindi: $LASTEXITCODE"

  if (Test-Path $marker) {
    foreach ($d in @(Get-VddDevices)) {
      $o = & pnputil.exe /remove-device "$($d.InstanceId)" 2>&1 | Out-String
      Log "aygit kaldirildi $($d.InstanceId): $LASTEXITCODE $($o -replace '\s+', ' ')"
    }
    # Sürücü paketini (oemNN.inf) bul ve sil.
    $enum = & pnputil.exe /enum-drivers 2>&1 | Out-String
    $blocks = $enum -split '(\r?\n){2,}'
    foreach ($b in $blocks) {
      if ($b -match '(?im)^\s*Original Name:\s*mttvdd\.inf' -or $b -match '(?im)mttvdd\.inf') {
        if ($b -match '(?im)^\s*Published Name:\s*(oem\d+\.inf)') {
          $o = & pnputil.exe /delete-driver $Matches[1] /uninstall /force 2>&1 | Out-String
          Log "surucu paketi silindi $($Matches[1]): $LASTEXITCODE $($o -replace '\s+', ' ')"
        }
      }
    }
    Remove-Item $marker -Force -ErrorAction SilentlyContinue
  } else {
    Log 'surucu bu kurulumdan once vardi, dokunulmadi'
  }
  Log 'bitti'
}
