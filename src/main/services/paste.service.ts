import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { BrowserWindow } from 'electron';
import logger from './logger';

const log = logger.scope('Paste');

const execFileAsync = promisify(execFile);

// Top-level window classes that are NOT valid paste targets (Windows shell UI)
const EXCLUDED_SHELL_CLASSES = new Set([
  'Progman',               // Desktop
  'WorkerW',               // Desktop background worker
  'Shell_TrayWnd',         // Primary taskbar
  'Shell_SecondaryTrayWnd', // Multi-monitor taskbar
  'NotifyIconOverflowWindow', // System tray overflow
]);

const MARKER = '__DICTATOR_DONE__';

// Add-Type definitions compiled once at PowerShell startup (saves ~200-400ms per call)
const INIT_SCRIPT = [
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;using System.Diagnostics;public class WinCapE{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);}'`,
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PW{[StructLayout(LayoutKind.Sequential)]public struct KI{public ushort vk;public ushort sc;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Sequential)]public struct MI{public int dx;public int dy;public uint md;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Explicit)]public struct IU{[FieldOffset(0)]public KI ki;[FieldOffset(0)]public MI mi;}[StructLayout(LayoutKind.Sequential)]public struct IP{public uint tp;public IU u;}[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,IP[] i,int s);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool c);public static void Paste(){int z=Marshal.SizeOf(typeof(IP));IP[] inp=new IP[4];inp[0].tp=1;inp[0].u.ki.vk=0x11;inp[0].u.ki.fl=0;inp[1].tp=1;inp[1].u.ki.vk=0x56;inp[1].u.ki.fl=0;inp[2].tp=1;inp[2].u.ki.vk=0x56;inp[2].u.ki.fl=2;inp[3].tp=1;inp[3].u.ki.vk=0x11;inp[3].u.ki.fl=2;SendInput(4,inp,z);}public static void PasteSI(){int z=Marshal.SizeOf(typeof(IP));IP[] inp=new IP[4];inp[0].tp=1;inp[0].u.ki.vk=0x10;inp[0].u.ki.fl=0;inp[1].tp=1;inp[1].u.ki.vk=0x2D;inp[1].u.ki.fl=1;inp[2].tp=1;inp[2].u.ki.vk=0x2D;inp[2].u.ki.fl=3;inp[3].tp=1;inp[3].u.ki.vk=0x10;inp[3].u.ki.fl=2;SendInput(4,inp,z);}}'`,
  `Write-Output '${MARKER}'`,
].join('\n');

const CAPTURE_CMD = `$h=[WinCapE]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder(256); [WinCapE]::GetClassName($h,$sb,256)|Out-Null; $wpid=0; [WinCapE]::GetWindowThreadProcessId($h,[ref]$wpid)|Out-Null; $pname=try{[System.Diagnostics.Process]::GetProcessById($wpid).ProcessName}catch{'unknown'}; Write-Output "$h|$($sb.ToString())|$pname"`;

// Ctrl+V is broken in xterm.js terminals (prints `^V`) and in Monaco on Electron >= 32.3.0
// (Chromium isTrusted gating, vscode#238609). Shift+Insert sidesteps both.
const SHIFT_INSERT_APPS = new Set(['cursor', 'code', 'windsurf']);

function buildPasteCmd(hwnd: string, appName?: string | null): string {
  if (!/^\d+$/.test(hwnd)) {
    throw new Error(`Invalid hwnd: expected digits only, got "${hwnd}"`);
  }
  const focus = `$t=[IntPtr]${hwnd}; $fg=[PW]::GetForegroundWindow(); $ft=[PW]::GetWindowThreadProcessId($fg,[IntPtr]::Zero); $mt=[PW]::GetCurrentThreadId(); $att=$false; if($ft -ne $mt){[void][PW]::AttachThreadInput($mt,$ft,$true);$att=$true}; if([PW]::IsIconic($t)){[void][PW]::ShowWindow($t,9)}; [void][PW]::SetForegroundWindow($t); if($att){[void][PW]::AttachThreadInput($mt,$ft,$false)}; Start-Sleep -Milliseconds 250;`;
  const useShiftInsert = !!appName && SHIFT_INSERT_APPS.has(appName.toLowerCase());
  const inject = useShiftInsert ? `[PW]::PasteSI()` : `[PW]::Paste()`;
  return `${focus} ${inject}`;
}

// Fallback: cold-start PowerShell for captureTarget (used when persistent process isn't ready)
const GET_HWND_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;using System.Diagnostics;public class WinCapE{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);}'; $h=[WinCapE]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder(256); [WinCapE]::GetClassName($h,$sb,256)|Out-Null; $wpid=0; [WinCapE]::GetWindowThreadProcessId($h,[ref]$wpid)|Out-Null; $pname=try{[System.Diagnostics.Process]::GetProcessById($wpid).ProcessName}catch{'unknown'}; "$h|$($sb.ToString())|$pname"`,
];

export class PasteService {
  private targetHwnd: string | null = null;
  private targetAppName: string | null = null;
  private psProcess: ChildProcess | null = null;
  private psReady = false;
  private commandQueue: Array<{ cmd: string; resolve: (output: string) => void; reject: (err: Error) => void }> = [];
  private currentCommand: { resolve: (output: string) => void; reject: (err: Error) => void } | null = null;
  private outputBuffer = '';
  private destroyed = false;
  private spawnAttempts = 0;
  private static readonly MAX_SPAWN_ATTEMPTS = 3;

  constructor() {
    if (process.platform === 'win32') {
      this.spawnPersistentProcess();
    }
  }

  private spawnPersistentProcess(): void {
    const ps = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command',
      '& { while ($true) { $line = [Console]::ReadLine(); if ($line -eq $null) { break }; try { Invoke-Expression $line } catch { Write-Error $_ } } }',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    ps.on('error', (err) => {
      log.warn('Persistent PowerShell failed to spawn:', err.message);
      this.psProcess = null;
      this.psReady = false;
    });

    ps.on('exit', (code) => {
      log.info('Persistent PowerShell exited with code:', code);
      this.psProcess = null;
      this.psReady = false;
      this.outputBuffer = '';
      const exitErr = new Error('PowerShell process exited');
      if (this.currentCommand) {
        this.currentCommand.reject(exitErr);
        this.currentCommand = null;
      }
      for (const queued of this.commandQueue) {
        queued.reject(exitErr);
      }
      this.commandQueue = [];
      if (!this.destroyed && this.spawnAttempts < PasteService.MAX_SPAWN_ATTEMPTS) {
        log.info('Respawning persistent PowerShell in 1s (attempt %d/%d)...', this.spawnAttempts + 1, PasteService.MAX_SPAWN_ATTEMPTS);
        setTimeout(() => {
          if (!this.destroyed && !this.psProcess) this.spawnPersistentProcess();
        }, 1000);
      }
    });

    ps.stdout?.on('data', (data: Buffer) => {
      this.outputBuffer += data.toString();
      this.processOutput();
    });

    ps.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) log.warn('PS stderr:', msg);
    });

    this.psProcess = ps;
    this.spawnAttempts++;
    ps.stdin?.write(INIT_SCRIPT + '\n');
  }

  private processOutput(): void {
    let markerIdx: number;
    while ((markerIdx = this.outputBuffer.indexOf(MARKER)) !== -1) {
      const output = this.outputBuffer.substring(0, markerIdx).trim();
      this.outputBuffer = this.outputBuffer.substring(markerIdx + MARKER.length).replace(/^\r?\n/, '');

      if (!this.psReady) {
        // First marker = init complete
        this.psReady = true;
        this.spawnAttempts = 0;
        log.info('Persistent PowerShell ready (Add-Type compiled)');
        this.drainQueue();
        continue;
      }

      if (this.currentCommand) {
        this.currentCommand.resolve(output);
        this.currentCommand = null;
        this.drainQueue();
      }
    }
  }

  private drainQueue(): void {
    if (this.currentCommand || this.commandQueue.length === 0) return;
    const next = this.commandQueue.shift();
    if (!next) return;
    this.execImmediate(next.cmd, next.resolve, next.reject);
  }

  private execImmediate(cmd: string, resolve: (output: string) => void, reject: (err: Error) => void): void {
    if (!this.psProcess || !this.psProcess.stdin) {
      reject(new Error('PowerShell process not available'));
      return;
    }
    this.currentCommand = { resolve, reject };
    this.psProcess.stdin.write(cmd + `\nWrite-Output '${MARKER}'\n`);
  }

  private exec(cmd: string, timeout = 10000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.psProcess || this.psProcess.exitCode !== null) {
        reject(new Error('PowerShell process not running'));
        return;
      }

      let settled = false;
      const wrappedResolve = (output: string) => { if (settled) return; settled = true; clearTimeout(timer); resolve(output); };
      const wrappedReject = (err: Error) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); };

      const entry = { cmd, resolve: wrappedResolve, reject: wrappedReject };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Match by resolve reference — execImmediate stores the same function objects
        if (this.currentCommand && this.currentCommand.resolve === wrappedResolve) {
          this.currentCommand = null;
          this.drainQueue();
        } else {
          const idx = this.commandQueue.indexOf(entry);
          if (idx !== -1) this.commandQueue.splice(idx, 1);
        }
        reject(new Error('PowerShell command timed out'));
      }, timeout);

      if (this.psReady && !this.currentCommand) {
        this.execImmediate(entry.cmd, entry.resolve, entry.reject);
      } else {
        this.commandQueue.push(entry);
      }
    });
  }

  async captureTarget(): Promise<void> {
    if (process.platform !== 'win32') return;

    this.targetHwnd = null;
    this.targetAppName = null;

    let stdout: string;
    try {
      if (this.psReady && this.psProcess) {
        stdout = await this.exec(CAPTURE_CMD, 3000);
      } else {
        const result = await execFileAsync('powershell', GET_HWND_ARGS, { timeout: 3000, windowsHide: true });
        stdout = result.stdout;
      }
    } catch (err) {
      log.warn('captureTarget failed:', err instanceof Error ? err.message : err);
      return;
    }

    const parts = stdout.trim().split('|');
    const hwnd = parts[0]?.trim() ?? '';
    const windowClass = parts[1]?.trim() ?? '';
    const processName = parts[2]?.trim() ?? 'unknown';

    if (!hwnd || !/^\d+$/.test(hwnd) || hwnd === '0') return;

    if (this.isOwnWindow(hwnd)) {
      log.info('Foreground is own Electron window — skipping paste target');
      return;
    }
    if (EXCLUDED_SHELL_CLASSES.has(windowClass)) {
      log.info('Shell/desktop window ("%s") — skipping paste target', windowClass);
      return;
    }

    this.targetHwnd = hwnd;
    this.targetAppName = processName;
    log.info('Captured paste target (class: %s, process: %s)', windowClass, processName);
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

  async simulatePaste(): Promise<void> {
    if (process.platform !== 'win32' || !this.targetHwnd) return;
    const hwnd = this.targetHwnd;
    const appName = this.targetAppName;

    try {
      if (this.psReady && this.psProcess) {
        await this.exec(buildPasteCmd(hwnd, appName), 10000);
      } else {
        const args = [
          '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
          `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PW{[StructLayout(LayoutKind.Sequential)]public struct KI{public ushort vk;public ushort sc;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Sequential)]public struct MI{public int dx;public int dy;public uint md;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Explicit)]public struct IU{[FieldOffset(0)]public KI ki;[FieldOffset(0)]public MI mi;}[StructLayout(LayoutKind.Sequential)]public struct IP{public uint tp;public IU u;}[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,IP[] i,int s);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool c);public static void Paste(){int z=Marshal.SizeOf(typeof(IP));IP[] inp=new IP[4];inp[0].tp=1;inp[0].u.ki.vk=0x11;inp[0].u.ki.fl=0;inp[1].tp=1;inp[1].u.ki.vk=0x56;inp[1].u.ki.fl=0;inp[2].tp=1;inp[2].u.ki.vk=0x56;inp[2].u.ki.fl=2;inp[3].tp=1;inp[3].u.ki.vk=0x11;inp[3].u.ki.fl=2;SendInput(4,inp,z);}public static void PasteSI(){int z=Marshal.SizeOf(typeof(IP));IP[] inp=new IP[4];inp[0].tp=1;inp[0].u.ki.vk=0x10;inp[0].u.ki.fl=0;inp[1].tp=1;inp[1].u.ki.vk=0x2D;inp[1].u.ki.fl=1;inp[2].tp=1;inp[2].u.ki.vk=0x2D;inp[2].u.ki.fl=3;inp[3].tp=1;inp[3].u.ki.vk=0x10;inp[3].u.ki.fl=2;SendInput(4,inp,z);}}'; ${buildPasteCmd(hwnd, appName)}`,
        ];
        await execFileAsync('powershell', args, { timeout: 10000, windowsHide: true });
      }
      log.info('Pasted successfully (app=%s)', appName ?? 'unknown');
    } catch (err) {
      log.warn('simulatePaste failed:', err instanceof Error ? err.message : err);
      throw err;
    } finally {
      this.targetHwnd = null;
      this.targetAppName = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.psProcess) {
      try {
        this.psProcess.stdin?.end('exit\n');
        this.psProcess.kill();
      } catch { /* already dead */ }
      this.psProcess = null;
      this.psReady = false;
    }
  }
}
