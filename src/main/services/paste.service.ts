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

// PowerShell: returns "hwnd|topLevelWindowClass" for the foreground window
const GET_HWND_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class WinCapE{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);}'; $h=[WinCapE]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder(256); [WinCapE]::GetClassName($h,$sb,256)|Out-Null; "$h|$($sb.ToString())"`,
];

function buildPasteArgs(hwnd: string): string[] {
  return [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PasteFgWin{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}'; $h=[IntPtr]${hwnd}; [PasteFgWin]::ShowWindow($h,9); [PasteFgWin]::SetForegroundWindow($h); Start-Sleep -Milliseconds 80; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`,
  ];
}

export class PasteService {
  private targetHwnd: string | null = null;

  // Call when recording STARTS — captures the focused window if it's a valid paste target
  captureTarget(): void {
    if (process.platform !== 'win32') return;

    execFileAsync('powershell', GET_HWND_ARGS, { timeout: 3000 })
      .then(({ stdout }) => {
        const parts = stdout.trim().split('|');
        const hwnd = parts[0]?.trim() ?? '';
        const windowClass = parts[1]?.trim() ?? '';

        if (!hwnd || !/^\d+$/.test(hwnd) || hwnd === '0') return;

        if (this.isOwnWindow(hwnd)) {
          console.log('[Dictator] Foreground is own Electron window — skipping paste target');
          return;
        }
        if (EXCLUDED_SHELL_CLASSES.has(windowClass)) {
          console.log('[Dictator] Shell/desktop window ("%s") — skipping paste target', windowClass);
          return;
        }

        this.targetHwnd = hwnd;
        console.log('[Dictator] Captured paste target HWND: %s (class: %s)', hwnd, windowClass);
      })
      .catch((err) => console.warn('[Dictator] captureTarget failed:', err.message));
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

  // Focuses the captured window and simulates Ctrl+V
  async simulatePaste(): Promise<void> {
    if (process.platform !== 'win32' || !this.targetHwnd) return;
    const hwnd = this.targetHwnd;
    this.targetHwnd = null;

    try {
      await execFileAsync('powershell', buildPasteArgs(hwnd), { timeout: 5000 });
      console.log('[Dictator] Auto-pasted to HWND:', hwnd);
    } catch (err) {
      console.warn('[Dictator] simulatePaste failed:', err instanceof Error ? err.message : err);
    }
  }
}
