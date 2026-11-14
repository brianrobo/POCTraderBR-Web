# Read-only: screenshot of the whole desktop + window rectangles of a process.
param([string]$OutDir, [string]$ProcessName = 'nfrunlite')

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Probe {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  static string Describe(IntPtr h, int depth) {
    RECT r; GetWindowRect(h, out r);
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var txt = new StringBuilder(256); GetWindowText(h, txt, 256);
    return String.Format("{0}{1:X} [{2}] \"{3}\" x={4} y={5} w={6} h={7}{8}", new String(' ', depth * 2), h.ToInt64(), cls, txt,
      r.L, r.T, r.R - r.L, r.B - r.T, IsIconic(h) ? " (minimized)" : "");
  }
  public static List<string> Windows(uint pid, int minSize) {
    var lines = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      lines.Add(Describe(h, 0));
      EnumChildWindows(h, delegate(IntPtr c, IntPtr l2) {
        RECT r; GetWindowRect(c, out r);
        if (IsWindowVisible(c) && r.R - r.L >= minSize && r.B - r.T >= minSize) lines.Add(Describe(c, 1));
        return true;
      }, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
    return lines;
  }
  public static string Foreground() {
    IntPtr h = GetForegroundWindow(); uint p; GetWindowThreadProcessId(h, out p);
    return Describe(h, 0) + " pid=" + p;
  }
}
'@

[void][Probe]::SetProcessDPIAware()
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
"virtual screen: x=$($vs.X) y=$($vs.Y) w=$($vs.Width) h=$($vs.Height)"
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) { "screen: $($s.DeviceName) $($s.Bounds) primary=$($s.Primary)" }
"foreground: " + [Probe]::Foreground()

$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save((Join-Path $OutDir 'desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

foreach ($p in Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) {
  "process $($p.Id) $($p.ProcessName)"
  [Probe]::Windows([uint32]$p.Id, 200)
}
