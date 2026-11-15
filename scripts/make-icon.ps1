# assets\icon.ico dosyasını üretir: mavi zemin üzerinde laptop + yanında telefon.
# Simgeyi değiştirmek istersen bu betiği düzenleyip yeniden çalıştır.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'assets\icon.ico'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

function Draw-Icon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0

  function RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); return $p
  }

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $size, $size), ([System.Drawing.Color]::FromArgb(255, 91, 140, 255)), ([System.Drawing.Color]::FromArgb(255, 58, 92, 214))
  $g.FillPath($bg, (RoundRect (8*$s) (8*$s) (240*$s) (240*$s) (52*$s)))

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 58, 92, 214))
  # laptop ekranı
  $g.FillPath($white, (RoundRect (30*$s) (70*$s) (118*$s) (84*$s) (10*$s)))
  $g.FillPath($blue, (RoundRect (40*$s) (80*$s) (98*$s) (64*$s) (4*$s)))
  # laptop tabanı
  $g.FillPath($white, (RoundRect (18*$s) (160*$s) (142*$s) (16*$s) (6*$s)))
  # telefon (dikey, laptopun sağında, arada boşluk)
  $g.FillPath($white, (RoundRect (176*$s) (82*$s) (58*$s) (96*$s) (12*$s)))
  $g.FillPath($blue, (RoundRect (184*$s) (94*$s) (42*$s) (72*$s) (4*$s)))
  $g.Dispose()
  return $bmp
}

# Küçük boyutlar için 32 bit DIB (BMP) girdisi: her Windows bileşeni okuyabilsin diye.
function To-Dib($bmp) {
  $n = $bmp.Width
  $ms = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $ms
  $w.Write([UInt32]40); $w.Write([Int32]$n); $w.Write([Int32]($n * 2)); $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]0); $w.Write([UInt32]0); $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
  for ($y = $n - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $n; $x++) { $c = $bmp.GetPixel($x, $y); $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A) }
  }
  $maskRow = [int]([Math]::Ceiling($n / 32.0) * 4)
  $w.Write((New-Object byte[] ($maskRow * $n))) # saydamlık alfa kanalından geliyor; maske boş
  $w.Flush()
  return ,$ms.ToArray()
}

# Çok boyutlu ICO yaz: 256 PNG, diğerleri DIB.
$sizes = 256, 64, 48, 32, 16
$images = foreach ($sz in $sizes) {
  $bmp = Draw-Icon $sz
  if ($sz -ge 256) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    ,$ms.ToArray()
  } else {
    ,(To-Dib $bmp)
  }
}
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $w.Write($img) }
$w.Close()
"Olusturuldu: $out"
