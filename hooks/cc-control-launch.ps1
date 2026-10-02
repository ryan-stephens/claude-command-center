# cc-control's launcher for a card's terminal tab. Windows Terminal runs this; it starts `claude`
# in the same console and stays beside it with two jobs:
# 1. The channel into the session needs `--dangerously-load-development-channels` (channels are a
#    research preview), and that flag stops at a confirmation prompt ("I am using this for local
#    development"). The launcher watches this console's own screen buffer for exactly that prompt
#    and presses Enter once. The trust-the-folder prompt, if it comes, is still yours to answer.
# 2. When channels aren't allowed (an org setting), the page still reaches the session through
#    here (PLAN §87): while claude runs, the launcher asks the cc-control server what to type
#    (GET /launcher/poll, the card's token in a header, a long poll) and writes it into this
#    console's input buffer, the way the keyboard would: a message then Enter, or a prompt's keys
#    (1 for the first choice, Escape for no). Nothing else is ever typed, and nothing is typed
#    without the server having been asked for it by the page. Each poll also tells the server the
#    tab is alive, so a message never opens a second tab on this session.
#
# The arguments come as one base64 argument (a JSON array: claude, then its arguments), so they
# survive Windows Terminal re-quoting the command line, and are quoted here the way Windows wants.
param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'
# No progress bar from the web requests: it is drawn in this console, over claude's screen.
$ProgressPreference = 'SilentlyContinue'

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
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr template);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
// The screen as it is now: CONOUT$ is the console's *active* screen buffer, which claude draws
// into (its own, not the one this script's stdout handle points at, so that handle reads stale text).
public static string Screen() {
  IntPtr h = CreateFileW("CONOUT$", 0xC0000000u, 3u, IntPtr.Zero, 3u, 0u, IntPtr.Zero);
  if (h == IntPtr.Zero || h == new IntPtr(-1)) h = GetStdHandle(-11);
  try {
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!GetConsoleScreenBufferInfo(h, out info)) return "";
    int rows = info.Window.B - info.Window.T + 1, cols = info.Size.X;
    if (rows <= 0 || cols <= 0) return "";
    var buf = new char[rows * cols];
    uint read;
    COORD at; at.X = 0; at.Y = info.Window.T;
    if (!ReadConsoleOutputCharacterW(h, buf, (uint)buf.Length, at, out read)) return "";
    return new string(buf, 0, (int)read);
  } finally { if (h != GetStdHandle(-11)) CloseHandle(h); }
}
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScanW(char c);
[DllImport("user32.dll")] public static extern uint MapVirtualKeyW(uint code, uint type);
public static bool PressEnter() { return Press((ushort)0x0D, '\r', 0); }
// One key, down and up: a virtual key with its character (0 for a bare key like Escape) and control-key flags (SHIFT_PRESSED = 0x10).
public static bool Press(ushort vk, char ch, uint ctrl) {
  IntPtr h = GetStdHandle(-10);
  var recs = new INPUT_RECORD[2];
  ushort scan = (ushort)MapVirtualKeyW(vk, 0);
  for (int i = 0; i < 2; i++) { recs[i].EventType = 1; recs[i].KeyDown = i == 0 ? 1 : 0; recs[i].RepeatCount = 1; recs[i].VirtualKeyCode = vk; recs[i].VirtualScanCode = scan; recs[i].Char = ch; recs[i].ControlKeyState = ctrl; }
  uint n;
  return WriteConsoleInputW(h, recs, 2, out n) && n == 2;
}
// A character as typed: its key on this keyboard when it has one (shift noted), else the character alone.
public static bool Type(char c) {
  short k = VkKeyScanW(c);
  if (k == -1) return Press(0, c, 0);
  ushort vk = (ushort)(k & 0xFF);
  uint ctrl = ((k >> 8) & 1) != 0 ? 0x10u : 0u;
  return Press(vk, c, ctrl);
}
'@

# What the page sends is typed as a person would: the characters, a newline as a backslash then
# Enter (how Claude Code's prompt takes a new line), then a pause, then Enter on its own. The
# pause matters: characters that arrive together read as a paste, and an Enter inside a paste is
# a line break, not a send; one that comes after the paste has settled sends.
function Type-Text([string]$text) {
  $lines = $text -replace "`r`n", "`n" -split "`n"
  for ($i = 0; $i -lt $lines.Length; $i++) {
    foreach ($ch in $lines[$i].ToCharArray()) { [void][CcControl.Con]::Type($ch) }
    if ($i -lt $lines.Length - 1) { [void][CcControl.Con]::Type('\'); [void][CcControl.Con]::PressEnter(); Start-Sleep -Milliseconds 60 }
  }
  Start-Sleep -Milliseconds 700
  [void][CcControl.Con]::PressEnter()
}
# Claude Code's prompt is on screen: the status line under the input box ("? for shortcuts" up to
# 2.1.2xx, "? for agents" and "(shift+tab to cycle)" after), or the empty box's "Try …" hint.
# Before that, keys would be lost.
function Prompt-Ready() {
  $screen = [CcControl.Con]::Screen()
  return ($screen -match '\? for \w+') -or ($screen -match 'shift\+tab to cycle') -or ($screen -match 'Try "')
}
function Press-Keys([string[]]$keys) {
  foreach ($k in $keys) {
    switch ($k) {
      'Enter' { [void][CcControl.Con]::PressEnter() }
      'Escape' { [void][CcControl.Con]::Press(0x1B, [char]27, 0) }
      default { foreach ($ch in $k.ToCharArray()) { [void][CcControl.Con]::Type($ch) } }
    }
    Start-Sleep -Milliseconds 80
  }
}

# The server to ask what to type, from the card's variables (the same ones the hook uses); without them, the launcher only watches the prompt.
$card = $env:CC_CONTROL_CARD
$token = $env:CC_CONTROL_TOKEN
$base = $env:CC_CONTROL_URL
$polling = $card -and $token -and $base -and ($base -match '^http://127\.0\.0\.1:\d{1,5}$')
# What this launcher did and when, for a tab where a message was slow or lost (PLAN §90): one line
# per event in ~\.cc-control\launcher.log, with the card's id. Nothing typed is written, only sizes.
$logFile = Join-Path $env:USERPROFILE '.cc-control\launcher.log'
$started = Get-Date
function Log([string]$line) {
  try { Add-Content -Path $logFile -Value ("{0} {1} +{2:N1}s {3}" -f (Get-Date).ToString('o'), $(if ($card) { $card.Substring(0, 8) } else { '-' }), ((Get-Date) - $started).TotalSeconds, $line) -ErrorAction SilentlyContinue } catch {}
}
# The poll goes straight to the loopback address with no proxy: on a managed laptop, the system
# proxy (and its auto-detection) can hold a web request for many seconds even for 127.0.0.1, which
# is what made messages arrive minutes late. A plain HttpWebRequest with Proxy = $null never asks.
function Poll-Next([int]$waitSeconds) {
  $t0 = Get-Date
  try {
    $req = [System.Net.HttpWebRequest]::Create("$base/launcher/poll?wait=$($waitSeconds * 1000)")
    $req.Method = 'GET'
    $req.Proxy = $null
    $req.KeepAlive = $true
    $req.Timeout = ($waitSeconds + 10) * 1000
    $req.ReadWriteTimeout = ($waitSeconds + 10) * 1000
    $req.Headers.Add('x-cc-control-card', $card)
    $req.Headers.Add('x-cc-control-token', $token)
    $res = $req.GetResponse()
    try {
      if ([int]$res.StatusCode -eq 200) {
        $reader = New-Object System.IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ($body) { Log ("poll: something to type after {0:N1}s" -f ((Get-Date) - $t0).TotalSeconds); return ConvertFrom-Json $body }
      }
    } finally { $res.Close() }
    $took = ((Get-Date) - $t0).TotalSeconds
    if ($took -gt $waitSeconds + 3) { Log ("poll: slow, {0:N1}s for a {1}s wait" -f $took, $waitSeconds) }
  } catch {
    Log ("poll failed after {0:N1}s: {1}" -f ((Get-Date) - $t0).TotalSeconds, $_.Exception.Message)
    Start-Sleep -Seconds 2
  }
  return $null
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = $arguments
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)

# Up to 30 s for the prompt; claude shows it before anything else. Once it is gone, stop looking.
# Meanwhile, and from then on until claude exits, ask the server what to type (short polls while
# the prompt may still come, long ones after).
$deadline = (Get-Date).AddSeconds(30)
$watching = $true
# Nothing is typed until the prompt is on screen (or 40 s have passed, in case its hint changes).
$readyBy = (Get-Date).AddSeconds(40)
$ready = $false
$script:hintSeen = $false
# What came before the prompt was ready waits here, in order; the polls go on meanwhile so the server keeps seeing the tab alive.
$pending = New-Object System.Collections.ArrayList
Log "started: polling $polling, $exe"
# One item, typed when the prompt is up: after a message was sent, the prompt takes a moment to
# come back, and a second message typed into that moment lands over the first; so each item waits
# (up to 8 s) for the prompt again, and a sent message is followed by a short pause.
function Type-Item($item) {
  # Only a tab whose hint has been seen waits for it again: where it never shows, waiting would only delay every item.
  if ($script:hintSeen) { $waitUntil = (Get-Date).AddSeconds(8); while (-not (Prompt-Ready) -and (Get-Date) -lt $waitUntil) { Start-Sleep -Milliseconds 200 } }
  if ($item.kind -eq 'text' -and $item.text) { Type-Text ([string]$item.text); Log ("typed a message of {0} chars (prompt up: {1})" -f ([string]$item.text).Length, (Prompt-Ready)); Start-Sleep -Milliseconds 1200 }
  elseif ($item.kind -eq 'keys' -and $item.keys) { Press-Keys @($item.keys | ForEach-Object { [string]$_ }); Log ("pressed {0} key(s)" -f @($item.keys).Count) }
}
while (-not $p.HasExited) {
  if ($watching) {
    $screen = [CcControl.Con]::Screen()
    if ($screen -match 'Loading development channels' -and $screen -match 'I am using this for local development') { [void][CcControl.Con]::PressEnter(); $watching = $false; Log 'pressed Enter at the development-channels prompt' }
    elseif ((Get-Date) -ge $deadline) { $watching = $false }
  }
  if (-not $ready) {
    $script:hintSeen = Prompt-Ready
    $ready = $script:hintSeen -or ((Get-Date) -ge $readyBy)
    if ($ready) {
      if ($script:hintSeen) { Log 'prompt ready: its hint is on screen' }
      else { $tail = ([CcControl.Con]::Screen() -replace '\s+', ' ').Trim(); Log ("gave up waiting for the prompt hint, typing anyway; the screen ends: {0}" -f $(if ($tail.Length -gt 160) { $tail.Substring($tail.Length - 160) } else { $tail })) }
    }
  }
  if ($ready -and $pending.Count -gt 0) { Log ("typing {0} item(s) that waited for the prompt" -f $pending.Count); foreach ($item in @($pending)) { Type-Item $item }; $pending.Clear() }
  if ($polling) {
    $next = Poll-Next $(if ($watching -or -not $ready) { 1 } else { 20 })
    if ($next -and -not $p.HasExited) {
      if ($ready) { Type-Item $next } else { [void]$pending.Add($next) }
    }
  } else {
    if (-not $watching) { $p.WaitForExit(); break }
    Start-Sleep -Milliseconds 250
  }
}

$p.WaitForExit()
Log ("claude exited with {0}" -f $p.ExitCode)
exit $p.ExitCode
