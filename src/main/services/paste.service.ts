import { execFile } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';

const execFileAsync = promisify(execFile);

// Top-level window classes that are NOT valid paste targets (Windows shell UI)
const EXCLUDED_SHELL_CLASSES = new Set([
  'Progman',               // Desktop
  'WorkerW',               // Desktop background worker
  'Shell_TrayWnd',         // Primary taskbar
  'Shell_SecondaryTrayWnd', // Multi-monitor taskbar
  'NotifyIconOverflowWindow', // System tray overflow
]);

// PowerShell: returns "hwnd|topLevelWindowClass|processName" for the foreground window
const GET_HWND_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;using System.Diagnostics;public class WinCapE{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);}'; $h=[WinCapE]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder(256); [WinCapE]::GetClassName($h,$sb,256)|Out-Null; $pid=0; [WinCapE]::GetWindowThreadProcessId($h,[ref]$pid)|Out-Null; $pname=try{[System.Diagnostics.Process]::GetProcessById($pid).ProcessName}catch{'unknown'}; "$h|$($sb.ToString())|$pname"`,
];

// Types text character-by-character via SendInput with KEYEVENTF_UNICODE (0x0004).
// This bypasses the terminal's keyboard shortcut system — characters go directly to the
// focused application as WM_CHAR messages. Works with TUI apps (Claude Code, vim, etc.)
// where Ctrl+V is intercepted or passed through instead of triggering paste.
// Structs KI/MI/IU/IP mirror Win32 KEYBDINPUT/MOUSEINPUT/union/INPUT (MI is needed
// so the Explicit union has the correct 32-byte size on x64).
function buildPasteArgs(hwnd: string): string[] {
  return [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PW{[StructLayout(LayoutKind.Sequential)]public struct KI{public ushort vk;public ushort sc;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Sequential)]public struct MI{public int dx;public int dy;public uint md;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Explicit)]public struct IU{[FieldOffset(0)]public KI ki;[FieldOffset(0)]public MI mi;}[StructLayout(LayoutKind.Sequential)]public struct IP{public uint tp;public IU u;}[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,IP[] i,int s);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool c);public static void T(string s){int z=Marshal.SizeOf(typeof(IP));foreach(char ch in s){IP[] inp=new IP[2];inp[0].tp=1;inp[0].u.ki.sc=(ushort)ch;inp[0].u.ki.fl=4;inp[1].tp=1;inp[1].u.ki.sc=(ushort)ch;inp[1].u.ki.fl=6;SendInput(2,inp,z);}}}'; Add-Type -AssemblyName System.Windows.Forms; $t=[IntPtr]${hwnd}; $fg=[PW]::GetForegroundWindow(); $ft=[PW]::GetWindowThreadProcessId($fg,[IntPtr]::Zero); $mt=[PW]::GetCurrentThreadId(); $att=$false; if($ft -ne $mt){$att=[PW]::AttachThreadInput($mt,$ft,$true)}; if([PW]::IsIconic($t)){[PW]::ShowWindow($t,9)}; [PW]::SetForegroundWindow($t); if($att){[PW]::AttachThreadInput($mt,$ft,$false)}; Start-Sleep -Milliseconds 80; $txt=[System.Windows.Forms.Clipboard]::GetText(); if($txt){[PW]::T($txt)}`,
  ];
}

export class PasteService {
  private targetHwnd: string | null = null;
  private targetAppName: string | null = null;

  // Call when recording STARTS — captures the focused window if it's a valid paste target
  captureTarget(): void {
    if (process.platform !== 'win32') return;

    // Always reset — each recording starts with a clean slate (prevents stale targets)
    this.targetHwnd = null;
    this.targetAppName = null;

    execFileAsync('powershell', GET_HWND_ARGS, { timeout: 3000, windowsHide: true })
      .then(({ stdout }) => {
        const parts = stdout.trim().split('|');
        const hwnd = parts[0]?.trim() ?? '';
        const windowClass = parts[1]?.trim() ?? '';
        const processName = parts[2]?.trim() ?? 'unknown';

        if (!hwnd || !/^\d+$/.test(hwnd) || hwnd === '0') return;

        if (this.isOwnWindow(hwnd)) {
          console.log('[Dictator] Foreground is own Electron window — skipping paste target (transcription will still run)');
          return;
        }
        if (EXCLUDED_SHELL_CLASSES.has(windowClass)) {
          console.log('[Dictator] Shell/desktop window ("%s") — skipping paste target (transcription will still run)', windowClass);
          return;
        }

        this.targetHwnd = hwnd;
        this.targetAppName = processName;
        console.log('[Dictator] Captured paste target HWND: %s (class: %s, process: %s)', hwnd, windowClass, processName);
      })
      .catch((err) => console.warn('[Dictator] captureTarget failed:', err.message));
  }

  getAppName(): string | null {
    return this.targetAppName;
  }

  private isOwnWindow(hwnd: string): boolean {
    for (const win of BrowserWindow.getAllWindows()) {
      const buf = win.getNativeWindowHandle();
      const winHwnd = buf.length >= 8
        ? buf.readBigUInt64LE(0).toString()
        : buf.readUInt32LE(0).toString();
      if (winHwnd === hwnd) return true;
    }
    return false;
  }

  hasTarget(): boolean {
    return this.targetHwnd !== null;
  }

  // Focuses the captured window and types text from clipboard character-by-character
  async simulatePaste(): Promise<void> {
    if (process.platform !== 'win32' || !this.targetHwnd) return;
    const hwnd = this.targetHwnd;
    this.targetHwnd = null;
    this.targetAppName = null;

    try {
      await execFileAsync('powershell', buildPasteArgs(hwnd), { timeout: 10000, windowsHide: true });
      console.log('[Dictator] Auto-typed to HWND:', hwnd);
    } catch (err) {
      console.warn('[Dictator] simulatePaste failed:', err instanceof Error ? err.message : err);
    }
  }
}
