# Steps a chart in the HTS one candle at a time with Ctrl+wheel and saves one
# screenshot per step: <OutDir>\<Prefix>_000.png (before any step), _001.png ...
# Progress goes to <OutDir>\<Prefix>.log.
#
# Sends nothing but Ctrl and mouse-wheel/move input - no clicks. Before every
# step the window under the cursor must belong to the HTS. Esc aborts.
#
# The HTS runs elevated, and Windows drops input sent from a lower-privilege
# process, so run with -Elevate from an ordinary shell.
param(
  [Parameter(Mandatory)] [string]$OutDir,
  [string]$Prefix = 'f',
  [Parameter(Mandatory)] [int]$X, [Parameter(Mandatory)] [int]$Y,   # capture rectangle, screen pixels
  [Parameter(Mandatory)] [int]$W, [Parameter(Mandatory)] [int]$H,
  [Parameter(Mandatory)] [int]$CursorX, [Parameter(Mandatory)] [int]$CursorY,   # where the wheel is sent
  [int]$ParkX = -1, [int]$ParkY = -1,   # where the cursor rests while a frame is taken (-1: stay)
  [string]$Plan = 'fwd5',               # comma-separated back<N> / fwd<N>: N candles into the past / toward now
  [switch]$NoCtrl,                      # the user holds Ctrl; only the wheel is sent
  [switch]$StopWhenUnchanged,           # end a segment when a step no longer changes the picture
  [string]$ProcessName = 'nfrunlite',
  [switch]$Elevate                      # relaunch this script elevated and wait for it
)

$log = Join-Path $OutDir "$Prefix.log"

if ($Elevate) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  foreach ($name in $PSBoundParameters.Keys) {
    $value = $PSBoundParameters[$name]
    if ($name -eq 'Elevate') { continue }
    if ($value -is [switch]) { if ($value) { $argLine += " -$name" } } else { $argLine += " -$name `"$value`"" }
  }
  Remove-Item $log -ErrorAction SilentlyContinue
  # Starting an elevated process fails now and then on this PC ("Access is
  # denied", or exit 0xC0000142) before the script runs at all. No log means
  # nothing ran, so trying again is safe. The log, not the process handle,
  # tells when the run is over: waiting on the handle has returned early.
  foreach ($try in 1..5) {
    try { Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList $argLine -ErrorAction Stop } catch { }
    for ($i = 0; $i -lt 50 -and -not (Test-Path $log); $i++) { Start-Sleep -Milliseconds 200 }
    if (Test-Path $log) { break }
  }
  if (-not (Test-Path $log)) { 'the elevated run never started'; return }
  while (-not (Select-String -Path $log -Pattern '^(done|ERROR)' -Quiet)) { Start-Sleep -Milliseconds 300 }
  Start-Sleep -Milliseconds 300
  Get-Content $log
  return
}

# Two runs at once would fight over the cursor; the second one leaves quietly.
$mutex = New-Object System.Threading.Mutex($false, 'Global\PocTraderHtsStep')
try { if (-not $mutex.WaitOne(0)) { return } } catch [System.Threading.AbandonedMutexException] { }

Set-Content -Path $log -Value "start $(Get-Date -Format o)" -Encoding utf8
function Log([string]$line) { Add-Content -Path $log -Value $line -Encoding utf8 }

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public static class Hts {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();

  public static uint ForegroundPid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
  public static uint PidAt(int x, int y) {
    POINT p; p.X = x; p.Y = y; uint pid; GetWindowThreadProcessId(WindowFromPoint(p), out pid); return pid;
  }
  // Windows only lets the thread that owns the foreground hand it over, so
  // borrow that thread's input state for the call.
  public static void Activate(IntPtr hwnd) {
    uint pid; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid); uint me = GetCurrentThreadId();
    if (fg != me) AttachThreadInput(me, fg, true);
    BringWindowToTop(hwnd); SetForegroundWindow(hwnd);
    if (fg != me) AttachThreadInput(me, fg, false);
  }
  public static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  static string Send(INPUT input) {
    uint sent = SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    return sent == 1 ? "ok" : "FAILED(err " + Marshal.GetLastWin32Error() + ")";
  }
  public static string Key(ushort vk, bool up) {
    INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.dwFlags = up ? 2u : 0u;
    return Send(i);
  }
  public static string Wheel(int delta) {
    INPUT i = new INPUT(); i.type = 0; i.u.mi.dwFlags = 0x0800; i.u.mi.mouseData = unchecked((uint)delta);
    return Send(i);
  }

  public static Bitmap Capture(int x, int y, int w, int h) {
    Bitmap bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
    using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
    return bmp;
  }
  public static string Hash(Bitmap bmp) {
    BitmapData d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    try {
      byte[] bytes = new byte[d.Stride * d.Height];
      Marshal.Copy(d.Scan0, bytes, 0, bytes.Length);
      using (MD5 md5 = MD5.Create()) return BitConverter.ToString(md5.ComputeHash(bytes)).Replace("-", "");
    } finally { bmp.UnlockBits(d); }
  }
}
'@

  [void][Hts]::SetProcessDPIAware()
  $me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  Log "elevated: $($me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

  # One wheel notch away from the user (+120) moves the chart one candle into
  # the past, one notch toward the user (-120) one candle toward now.
  $segments = foreach ($segment in $Plan.Split(',')) {
    if ($segment.Trim() -notmatch '^(back|fwd)(\d+)$') { throw "bad plan segment '$segment'" }
    [pscustomobject]@{ Delta = $(if ($Matches[1] -eq 'back') { 120 } else { -120 }); Count = [int]$Matches[2] }
  }

  $proc = Get-Process -Name $ProcessName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { throw "no window for process $ProcessName" }
  $hwnd = $proc.MainWindowHandle
  if ([Hts]::IsIconic($hwnd)) { throw 'the HTS window is minimized' }

  # Get this console out of the way (without activating anything) and bring
  # the HTS to the front. Windows may refuse the latter; what matters for the
  # wheel is the window under the cursor, so that is what gets checked.
  $console = [Hts]::GetConsoleWindow()
  if ([Hts]::IsWindowVisible($console)) { [void][Hts]::ShowWindow($console, 7) }
  [Hts]::Activate($hwnd)
  Start-Sleep -Milliseconds 700
  Log "foreground pid $([Hts]::ForegroundPid()), HTS pid $($proc.Id)"
  if ([Hts]::PidAt($CursorX, $CursorY) -ne $proc.Id) { throw "the window at $CursorX,$CursorY is not the HTS (pid $([Hts]::PidAt($CursorX, $CursorY)))" }

  $start = New-Object Hts+POINT
  [void][Hts]::GetCursorPos([ref]$start)

  # A frame is taken once two captures in a row are identical, so a chart that
  # is still redrawing is not saved half-done.
  function Settled {
    $bmp = [Hts]::Capture($X, $Y, $W, $H); $hash = [Hts]::Hash($bmp)
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Milliseconds 120
      $next = [Hts]::Capture($X, $Y, $W, $H); $nextHash = [Hts]::Hash($next)
      if ($nextHash -eq $hash) { $next.Dispose(); return @($bmp, $hash, $i) }
      $bmp.Dispose(); $bmp = $next; $hash = $nextHash
    }
    return @($bmp, $hash, -1)
  }
  function Save($bmp, [int]$index) {
    $bmp.Save((Join-Path $OutDir ('{0}_{1:000}.png' -f $Prefix, $index)), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }

  if ($ParkX -ge 0) { [void][Hts]::SetCursorPos($ParkX, $ParkY); Start-Sleep -Milliseconds 200 }
  $bmp, $prev, $waits = Settled
  Save $bmp 0
  Log "frame 0 hash=$prev settle=$waits"

  $index = 0
  $aborted = $false
  try {
    foreach ($segment in $segments) {
      for ($n = 0; $n -lt $segment.Count; $n++) {
        if ([Hts]::Down(0x1B)) { Log 'aborted: Esc'; $aborted = $true; break }
        if ([Hts]::PidAt($CursorX, $CursorY) -ne $proc.Id) { Log "aborted: the window at $CursorX,$CursorY is pid $([Hts]::PidAt($CursorX, $CursorY))"; $aborted = $true; break }

        [void][Hts]::SetCursorPos($CursorX, $CursorY)
        Start-Sleep -Milliseconds 60
        $k1 = '-'; $k2 = '-'; $held = [Hts]::Down(0x11)
        if (-not $NoCtrl) { $k1 = [Hts]::Key(0x11, $false); Start-Sleep -Milliseconds 40; $held = [Hts]::Down(0x11) }
        $wheel = [Hts]::Wheel($segment.Delta)
        Start-Sleep -Milliseconds 40
        if (-not $NoCtrl) { $k2 = [Hts]::Key(0x11, $true) }
        if ($ParkX -ge 0) { [void][Hts]::SetCursorPos($ParkX, $ParkY) }
        Start-Sleep -Milliseconds 150

        $bmp, $hash, $waits = Settled
        $changed = $hash -ne $prev
        $index++
        Log "frame $index delta=$($segment.Delta) ctrlDown=$k1 ctrlHeld=$held wheel=$wheel ctrlUp=$k2 changed=$changed settle=$waits fg=$([Hts]::ForegroundPid()) hash=$hash"
        Save $bmp $index
        $prev = $hash
        if (-not $changed -and $StopWhenUnchanged) { Log 'segment ended: picture did not change'; break }
      }
      if ($aborted) { break }
    }
  } finally {
    if (-not $NoCtrl) { [void][Hts]::Key(0x11, $true) }
    [void][Hts]::SetCursorPos($start.X, $start.Y)
  }
  Log "done frames=$($index + 1) aborted=$aborted"
} catch {
  Log "ERROR: $($_.Exception.Message)"
  Log $_.ScriptStackTrace
} finally {
  $mutex.ReleaseMutex()
}
