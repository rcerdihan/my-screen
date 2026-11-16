# Standart girdiden komut okuyup fareyi hareket ettirir.
#   m X Y  -> imleci fiziksel piksel konumuna taşı
#   d / u  -> sol tuş bas / bırak
#   r      -> sağ tık
#   w N    -> dikey tekerlek, h N -> yatay tekerlek
#
# Hareket, gerçek fare girdisi olarak (SendInput, mutlak konum) gönderilir. Eskiden SetCursorPos
# kullanılıyordu: imleç yer değiştiriyor ama Windows'a hareket olayı gitmiyordu; Paint gibi çizim
# uygulamaları yalnızca basma ve bırakma noktasını görüp aralarına düz çizgi çekiyordu.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MyScreenInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx, dy; public int mouseData; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public MOUSEINPUT mi; } // 64 bitte 40 bayt: birleşimin en büyük üyesi MOUSEINPUT
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  const uint MOVE = 0x0001, LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
  const uint WHEEL = 0x0800, HWHEEL = 0x1000, VIRTUALDESK = 0x4000, ABSOLUTE = 0x8000;

  static void Send(uint flags, int dx, int dy, int data) {
    var input = new INPUT[1];
    input[0].type = 0; // INPUT_MOUSE
    input[0].mi.dx = dx; input[0].mi.dy = dy; input[0].mi.mouseData = data; input[0].mi.dwFlags = flags;
    SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
  }

  // Fiziksel piksel konumunu tüm masaüstüne göre 0..65535 aralığına çevirip mutlak hareket gönder.
  public static void MoveTo(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    if (vw < 2 || vh < 2) return;
    // Windows mutlak değeri piksele "değer * genişlik / 65536" diye çevirir. Pikselin ortasını
    // hedefle; eski yuvarlama ekranın en kenarında imleci 1 piksel yandaki ekrana taşıyabiliyordu.
    int nx = (int)Math.Floor(((x - vx) + 0.5) * 65536.0 / vw);
    int ny = (int)Math.Floor(((y - vy) + 0.5) * 65536.0 / vh);
    nx = Math.Max(0, Math.Min(65535, nx));
    ny = Math.Max(0, Math.Min(65535, ny));
    Send(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny, 0);
  }
  public static void Down() { Send(LEFTDOWN, 0, 0, 0); }
  public static void Up() { Send(LEFTUP, 0, 0, 0); }
  public static void RightClick() { Send(RIGHTDOWN, 0, 0, 0); Send(RIGHTUP, 0, 0, 0); }
  public static void Wheel(int delta) { Send(WHEEL, 0, 0, delta); }
  public static void HWheel(int delta) { Send(HWHEEL, 0, 0, delta); }
}
"@

# Per-monitor DPI farkındalığı: koordinatlar gerçek piksel olsun.
[MyScreenInput]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  switch ($p[0]) {
    'm' { [MyScreenInput]::MoveTo([int]$p[1], [int]$p[2]) }
    'd' { [MyScreenInput]::Down() }
    'u' { [MyScreenInput]::Up() }
    'r' { [MyScreenInput]::RightClick() }
    'w' { [MyScreenInput]::Wheel([int]$p[1]) }
    'h' { [MyScreenInput]::HWheel([int]$p[1]) }
  }
}
