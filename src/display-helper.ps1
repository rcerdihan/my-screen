# Sanal ekranı (Virtual Display Driver) masaüstüne bağlar veya ayırır. Yönetici izni gerekmez:
# Win+P ile "Genişlet"/"Yalnızca bilgisayar ekranı" seçmekle aynı türden bir ekran düzeni değişikliği.
#   status                      -> sanal ekranın durumunu yazar
#   attach W H HZ X Y           -> sanal ekranı bu çözünürlük/hız/konumla bağlar
#   detach                      -> sanal ekranı ayırır (önce durumunu yazar)
#   modes                       -> sürücünün sunduğu çözünürlük@hız listesini yazar
#   set W H HZ                  -> bağlıyken çözünürlüğü/hızı değiştirir (bağlı değilse bağlar)
# Çıktı: tek satır JSON.
param([string]$Action = 'status', [int]$Width = 0, [int]$Height = 0, [int]$Hz = 0, [int]$X = -1, [int]$Y = 0)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VirtualDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE dd, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, int flags, IntPtr param);

  const int ATTACHED = 0x1, PRIMARY = 0x4;
  const int DM_POSITION = 0x20, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
  const int CDS_UPDATEREGISTRY = 0x1, CDS_NORESET = 0x10000000;

  static DEVMODE NewMode() { var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return dm; }

  // Sanal ekranın aygıt adını bul (ör. \\.\DISPLAY10). Yalnızca "Virtual Display Driver" adlı aygıta dokunulur.
  public static string Find(out bool attached) {
    var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
    for (int i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++) {
      if (dd.DeviceString.IndexOf("Virtual Display Driver", StringComparison.OrdinalIgnoreCase) >= 0) {
        attached = (dd.StateFlags & ATTACHED) != 0;
        return dd.DeviceName;
      }
      dd.cb = Marshal.SizeOf(dd);
    }
    attached = false;
    return null;
  }

  // Sürücünün sunduğu tüm modlar: "GxY@Hz" listesi.
  public static string[] Modes(string name) {
    var set = new System.Collections.Generic.SortedSet<string>();
    var dm = NewMode();
    for (int i = 0; EnumDisplaySettings(name, i, ref dm); i++) set.Add(dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency);
    var arr = new string[set.Count]; set.CopyTo(arr); return arr;
  }

  public static int[] Current(string name) {
    var dm = NewMode();
    if (!EnumDisplaySettings(name, -1, ref dm)) return null;
    return new[] { dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency, dm.dmPositionX, dm.dmPositionY };
  }

  // Ana ekranın sağ kenarı (sanal ekranın varsayılan konumu).
  public static int PrimaryRight() {
    var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
    for (int i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++) {
      if ((dd.StateFlags & PRIMARY) != 0) {
        var dm = NewMode();
        if (EnumDisplaySettings(dd.DeviceName, -1, ref dm)) return dm.dmPositionX + dm.dmPelsWidth;
      }
      dd.cb = Marshal.SizeOf(dd);
    }
    return 1920;
  }

  public static int Apply(string name, int w, int h, int hz, int x, int y) {
    var dm = NewMode();
    dm.dmDeviceName = name;
    dm.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT | (hz > 0 ? DM_DISPLAYFREQUENCY : 0);
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = hz;
    dm.dmPositionX = x; dm.dmPositionY = y;
    int r = ChangeDisplaySettingsEx(name, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
    if (r != 0) return r;
    return ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
  }
}
"@

function Out-Json($obj) { $obj | ConvertTo-Json -Compress }

$attached = $false
$name = [VirtualDisplay]::Find([ref]$attached)
if (-not $name) { Out-Json @{ ok = $false; found = $false; error = 'Sanal ekran sürücüsü bulunamadı' }; exit 0 }

$mode = if ($attached) { [VirtualDisplay]::Current($name) } else { $null }
$state = @{ ok = $true; found = $true; device = $name; attached = $attached }
if ($mode) { $state.width = $mode[0]; $state.height = $mode[1]; $state.hz = $mode[2]; $state.x = $mode[3]; $state.y = $mode[4] }

switch ($Action) {
  'status' { Out-Json $state }
  'modes' { $state.modes = [VirtualDisplay]::Modes($name); Out-Json $state }
  # Bağlıyken çözünürlük/hızı değiştir (konum korunur); bağlı değilse bu modla bağla.
  'set' {
    $px = if ($attached -and $mode) { $mode[3] } elseif ($X -ge 0) { $X } else { [VirtualDisplay]::PrimaryRight() }
    $py = if ($attached -and $mode) { $mode[4] } else { $Y }
    $r = [VirtualDisplay]::Apply($name, $Width, $Height, $Hz, $px, $py)
    $state.result = $r
    $state.ok = ($r -eq 0)
    $now = [VirtualDisplay]::Current($name)
    if ($now) { $state.attached = $true; $state.width = $now[0]; $state.height = $now[1]; $state.hz = $now[2]; $state.x = $now[3]; $state.y = $now[4] }
    Out-Json $state
  }
  'detach' {
    if ($attached) {
      $r = [VirtualDisplay]::Apply($name, 0, 0, 0, 0, 0)
      $state.result = $r
      $state.ok = ($r -eq 0)
    }
    Out-Json $state
  }
  'attach' {
    if (-not $attached) {
      if ($X -lt 0) { $X = [VirtualDisplay]::PrimaryRight() }
      $r = [VirtualDisplay]::Apply($name, $Width, $Height, $Hz, $X, $Y)
      if ($r -ne 0 -and $Hz -gt 0) { $r = [VirtualDisplay]::Apply($name, $Width, $Height, 0, $X, $Y) } # hız desteklenmezse varsayılanla dene
      $state.result = $r
      $state.ok = ($r -eq 0)
      $now = [VirtualDisplay]::Current($name)
      if ($now) { $state.attached = $true; $state.width = $now[0]; $state.height = $now[1]; $state.hz = $now[2]; $state.x = $now[3]; $state.y = $now[4] }
    }
    Out-Json $state
  }
}
