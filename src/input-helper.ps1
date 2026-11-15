# Standart girdiden komut okuyup fareyi hareket ettirir.
#   m X Y  -> imleci fiziksel piksel konumuna taşı
#   d / u  -> sol tuş bas / bırak
#   r      -> sağ tık
#   w N    -> dikey tekerlek, h N -> yatay tekerlek
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MyScreenInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
}
"@

# Per-monitor DPI farkındalığı: koordinatlar gerçek piksel olsun.
[MyScreenInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$zero = [UIntPtr]::Zero
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  switch ($p[0]) {
    'm' { [MyScreenInput]::SetCursorPos([int]$p[1], [int]$p[2]) | Out-Null }
    'd' { [MyScreenInput]::mouse_event(0x0002, 0, 0, 0, $zero) }
    'u' { [MyScreenInput]::mouse_event(0x0004, 0, 0, 0, $zero) }
    'r' {
      [MyScreenInput]::mouse_event(0x0008, 0, 0, 0, $zero)
      [MyScreenInput]::mouse_event(0x0010, 0, 0, 0, $zero)
    }
    'w' { [MyScreenInput]::mouse_event(0x0800, 0, 0, [int]$p[1], $zero) }
    'h' { [MyScreenInput]::mouse_event(0x1000, 0, 0, [int]$p[1], $zero) }
  }
}
