# cc-control's launcher for a card's terminal tab. Windows Terminal runs this; it starts `claude`
# in the same console and gets out of the way. Its one job: the channel into the session needs
# `--dangerously-load-development-channels` (channels are a research preview), and that flag stops
# at a confirmation prompt ("I am using this for local development"). The launcher watches this
# console's own screen buffer for exactly that prompt and presses Enter once; nothing else is ever
# typed. The trust-the-folder prompt, if it comes, is still yours to answer.
#
# The arguments come as one base64 argument (a JSON array: claude, then its arguments), so they
# survive Windows Terminal re-quoting the command line, and are quoted here the way Windows wants.
param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'

# PowerShell 5.1 hands a top-level JSON array back as one nested object; the pipeline unrolls it.
$decoded = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)))
$argv = @($decoded | ForEach-Object { [string]$_ })
$exe = [string]$argv[0]
# A bare name (claude) becomes its full path: Process.Start doesn't search PATH the way a shell does.
$found = Get-Command $exe -ErrorAction SilentlyContinue
if ($found -and $found.Source) { $exe = $found.Source }
$rest = @($argv | Select-Object -Skip 1)

# One argument, quoted as CommandLineToArgv undoes it: quotes escaped, backslashes before a quote or at the end doubled.
function Quote([string]$a) {
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  $s = [regex]::Replace($a, '(\\*)"', { param($m) $m.Groups[1].Value + $m.Groups[1].Value + '\"' })
  $s = [regex]::Replace($s, '(\\+)$', { param($m) $m.Groups[1].Value + $m.Groups[1].Value })
  return '"' + $s + '"'
}
$arguments = ($rest | ForEach-Object { Quote ([string]$_) }) -join ' '

Add-Type -Namespace CcControl -Name Con -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CONSOLE_SCREEN_BUFFER_INFO info);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool ReadConsoleOutputCharacterW(IntPtr h, [Out] char[] buf, uint len, COORD at, out uint read);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] recs, uint n, out uint written);
[StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
[StructLayout(LayoutKind.Sequential)] public struct SMALL_RECT { public short L, T, R, B; }
[StructLayout(LayoutKind.Sequential)] public struct CONSOLE_SCREEN_BUFFER_INFO { public COORD Size; public COORD Cursor; public ushort Attr; public SMALL_RECT Window; public COORD Max; }
[StructLayout(LayoutKind.Explicit, Size = 20)] public struct INPUT_RECORD {
  [FieldOffset(0)] public ushort EventType;
  [FieldOffset(4)] public int KeyDown;
  [FieldOffset(8)] public ushort RepeatCount;
  [FieldOffset(10)] public ushort VirtualKeyCode;
  [FieldOffset(12)] public ushort VirtualScanCode;
  [FieldOffset(14)] public char Char;
  [FieldOffset(16)] public uint ControlKeyState;
}
public static string Screen() {
  IntPtr h = GetStdHandle(-11);
  CONSOLE_SCREEN_BUFFER_INFO info;
  if (!GetConsoleScreenBufferInfo(h, out info)) return "";
  int rows = info.Window.B - info.Window.T + 1, cols = info.Size.X;
  if (rows <= 0 || cols <= 0) return "";
  var buf = new char[rows * cols];
  uint read;
  COORD at; at.X = 0; at.Y = info.Window.T;
  if (!ReadConsoleOutputCharacterW(h, buf, (uint)buf.Length, at, out read)) return "";
  return new string(buf, 0, (int)read);
}
public static bool PressEnter() {
  IntPtr h = GetStdHandle(-10);
  var recs = new INPUT_RECORD[2];
  for (int i = 0; i < 2; i++) { recs[i].EventType = 1; recs[i].KeyDown = i == 0 ? 1 : 0; recs[i].RepeatCount = 1; recs[i].VirtualKeyCode = 0x0D; recs[i].VirtualScanCode = 0x1C; recs[i].Char = '\r'; }
  uint n;
  return WriteConsoleInputW(h, recs, 2, out n) && n == 2;
}
'@

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = $arguments
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)

# Up to 30 s for the prompt; claude shows it before anything else. Once it is gone, stop looking.
$deadline = (Get-Date).AddSeconds(30)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $screen = [CcControl.Con]::Screen()
  if ($screen -match 'Loading development channels' -and $screen -match 'I am using this for local development') {
    [void][CcControl.Con]::PressEnter()
    break
  }
}

$p.WaitForExit()
exit $p.ExitCode
