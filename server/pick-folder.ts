// The machine's own folder picker, for "add a folder as context" (§59): the page can't learn a
// path from the browser's file picker, but the server runs on the same computer, so it opens the
// modern Windows "Select Folder" window itself (IFileOpenDialog with FOS_PICKFOLDERS, the one
// Explorer and editors use, through a few lines of C# in a PowerShell process; owned by the
// window in front, so it opens over the browser) and answers with the path. Cancel answers with
// nothing. Elsewhere than Windows: a plain error.

import { execFile } from 'node:child_process';

const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;
public static class CcPick {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint n, IntPtr rg);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr e, out uint c);
    void Unadvise(uint c);
    void SetOptions(uint o);
    void GetOptions(out uint o);
    void SetDefaultFolder(IntPtr si);
    void SetFolder(IntPtr si);
    void GetFolder(out IntPtr si);
    void GetCurrentSelection(out IntPtr si);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);
    void GetFileName(out IntPtr n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string l);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string l);
    void GetResult(out IShellItem si);
    void AddPlace(IntPtr si, int f);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string e);
    void Close(int hr);
    void SetClientGuid(ref Guid g);
    void ClearClientData();
    void SetFilter(IntPtr f);
    void GetResults(out IntPtr e);
    void GetSelectedItems(out IntPtr e);
  }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem psi);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attrs);
    void Compare(IShellItem psi, uint hint, out int order);
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_NOCHANGEDIR = 0x8;
  const uint SIGDN_FILESYSPATH = 0x80058000;
  public static string Pick(string title, string ok) {
    var d = (IFileOpenDialog)new FileOpenDialog();
    uint o; d.GetOptions(out o);
    d.SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR);
    d.SetTitle(title);
    d.SetOkButtonLabel(ok);
    if (d.Show(GetForegroundWindow()) != 0) return "";
    IShellItem si; d.GetResult(out si);
    string p; si.GetDisplayName(SIGDN_FILESYSPATH, out p);
    return p;
  }
}
`;

const SCRIPT = `
Add-Type -TypeDefinition @'
${CSHARP}
'@
$p = [CcPick]::Pick('Pick a folder for Claude to use as context', 'Use this folder')
[Console]::Out.Write($p)
`;

/** Opens the picker and resolves with the folder, or null when it was cancelled. */
export function pickFolder(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.reject(new Error('The folder picker is Windows only here; type the path instead.'));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`The folder picker could not open: ${(stderr || err.message).trim().split('\n')[0]}`)); return; }
      const path = stdout.trim();
      resolve(path || null);
    });
  });
}
