# Brings a card's Windows Terminal tab to the front: the tab whose title is the card's key (the
# tab was opened with `wt nt --title <KEY>`). Windows Terminal has no command for "focus the tab
# called X" (`wt ft` wants an index), so this walks its windows with UI Automation, selects the
# matching tab and brings that window forward. Prints "ok" or "not found"; touches nothing else.
# -Find only looks: "ok" when such a tab exists, nothing selected or brought forward (§87).
param([Parameter(Mandatory = $true)][string]$Title, [switch]$Find)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace CcControl -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$byClass = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $byClass)
$tabType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
foreach ($w in $windows) {
  $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabType)
  foreach ($t in $tabs) {
    $name = [string]$t.Current.Name
    # The tab's name is the title, sometimes followed by state ("KEY", or "KEY - ...").
    if ($name -eq $Title -or $name.StartsWith("$Title ") -or $name.StartsWith("$Title -")) {
      if ($Find) { Write-Output 'ok'; exit 0 }
      $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $sel.Select()
      $h = [IntPtr]$w.Current.NativeWindowHandle
      if ([CcControl.Win]::IsIconic($h)) { [CcControl.Win]::ShowWindow($h, 9) | Out-Null }
      # Windows only lets the foreground thread hand focus over: borrow its input queue for the call.
      $fg = [CcControl.Win]::GetForegroundWindow()
      $fgThread = [CcControl.Win]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
      $me = [CcControl.Win]::GetCurrentThreadId()
      $attached = $false
      if ($fgThread -ne 0 -and $fgThread -ne $me) { $attached = [CcControl.Win]::AttachThreadInput($me, $fgThread, $true) }
      [CcControl.Win]::SetForegroundWindow($h) | Out-Null
      if ($attached) { [CcControl.Win]::AttachThreadInput($me, $fgThread, $false) | Out-Null }
      Write-Output 'ok'
      exit 0
    }
  }
}
Write-Output 'not found'
exit 0
