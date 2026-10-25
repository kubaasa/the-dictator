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
const PASTE_OK = '__DICTATOR_PASTED__';
const INIT_TIMEOUT_MS = 10000;

// Win32 interop shared by the persistent process and the cold-start fallbacks, so a change
// to either class reaches both paths.
const WINCAP_TYPEDEF = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;using System.Diagnostics;public class WinCapE{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);}'`;
const PW_TYPEDEF = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class PW{[StructLayout(LayoutKind.Sequential)]public struct KI{public ushort vk;public ushort sc;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Sequential)]public struct MI{public int dx;public int dy;public uint md;public uint fl;public uint tm;public IntPtr ex;}[StructLayout(LayoutKind.Explicit)]public struct IU{[FieldOffset(0)]public KI ki;[FieldOffset(0)]public MI mi;}[StructLayout(LayoutKind.Sequential)]public struct IP{public uint tp;public IU u;}[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,IP[] i,int s);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")]public static extern bool IsWindow(IntPtr h);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool c);public static void Paste(){int z=Marshal.SizeOf(typeof(IP));IP[] inp=new IP[4];inp[0].tp=1;inp[0].u.ki.vk=0x11;inp[0].u.ki.fl=0;inp[1].tp=1;inp[1].u.ki.vk=0x56;inp[1].u.ki.fl=0;inp[2].tp=1;inp[2].u.ki.vk=0x56;inp[2].u.ki.fl=2;inp[3].tp=1;inp[3].u.ki.vk=0x11;inp[3].u.ki.fl=2;SendInput(4,inp,z);}}'`;

// Add-Type definitions compiled once at PowerShell startup (saves ~200-400ms per call).
// The ready marker is printed only once both types resolve: the loop's Invoke-Expression
// catch swallows a failed Add-Type, so an unconditional marker would report a process
// that cannot capture or paste as ready.
const INIT_SCRIPT = [
  WINCAP_TYPEDEF,
  PW_TYPEDEF,
  `try { [void][WinCapE]::GetForegroundWindow(); [void][PW]::GetCurrentThreadId(); Write-Output '${MARKER}' } catch { Write-Error "interop init failed: $_" }`,
].join('\n');

const CAPTURE_CMD = `$h=[WinCapE]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder(256); [WinCapE]::GetClassName($h,$sb,256)|Out-Null; $wpid=0; [WinCapE]::GetWindowThreadProcessId($h,[ref]$wpid)|Out-Null; $pname=try{[System.Diagnostics.Process]::GetProcessById($wpid).ProcessName}catch{'unknown'}; Write-Output "$h|$($sb.ToString())|$pname"`;

// Always Ctrl+V. Shift+Insert used to be sent to VS Code forks, but their terminals
// (xterm.js with kitty keyboard protocol, enabled by e.g. Claude Code >= 2.1.269) now encode
// Shift+Insert as a key sequence instead of pasting. Ctrl+V is a VS Code keybinding on
// Windows (workbench.action.terminal.paste, in commandsToSkipShell), so it bypasses xterm.js.
// SendInput goes to whatever window is foreground, so the target is re-checked right before
// the keystrokes; a closed or un-focusable target throws instead of pasting somewhere else.
function buildPasteCmd(hwnd: string): string {
  if (!/^\d+$/.test(hwnd)) {
    throw new Error(`Invalid hwnd: expected digits only, got "${hwnd}"`);
  }
  const focus = `$t=[IntPtr]${hwnd}; if(-not [PW]::IsWindow($t)){ throw 'target window no longer exists' }; $fg=[PW]::GetForegroundWindow(); $ft=[PW]::GetWindowThreadProcessId($fg,[IntPtr]::Zero); $mt=[PW]::GetCurrentThreadId(); $att=$false; if($ft -ne $mt){[void][PW]::AttachThreadInput($mt,$ft,$true);$att=$true}; if([PW]::IsIconic($t)){[void][PW]::ShowWindow($t,9)}; [void][PW]::SetForegroundWindow($t); if($att){[void][PW]::AttachThreadInput($mt,$ft,$false)}; Start-Sleep -Milliseconds 250;`;
  const verify = `if([PW]::GetForegroundWindow().ToInt64() -ne $t.ToInt64()){ throw 'target window did not come to the foreground' };`;
  return `${focus} ${verify} [PW]::Paste(); Write-Output '${PASTE_OK}'`;
}

// Fallback: cold-start PowerShell for captureTarget (used when persistent process isn't ready)
const GET_HWND_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  `${WINCAP_TYPEDEF}; ${CAPTURE_CMD}`,
];

export class PasteService {
  private targetHwnd: string | null = null;
  private targetAppName: string | null = null;
  private psProcess: ChildProcess | null = null;
  private psReady = false;
  private commandQueue: Array<{ cmd: string; resolve: (output: string) => void; reject: (err: Error) => void }> = [];
  private currentCommand: { resolve: (output: string) => void; reject: (err: Error) => void } | null = null;
  private outputBuffer = '';
  // Markers still owed by commands that already timed out. PowerShell runs the pipe
  // sequentially, so each one arrives before the output of the command queued after it.
  private staleMarkers = 0;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.clearInitTimer();
      this.psProcess = null;
      this.psReady = false;
      this.outputBuffer = '';
      this.staleMarkers = 0;
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

    // No ready marker means Add-Type failed (or hung); the cold-start fallbacks take over
    // while psReady stays false, and killing the process routes through the bounded respawn.
    this.initTimer = setTimeout(() => {
      this.initTimer = null;
      if (this.psReady || this.psProcess !== ps) return;
      log.warn('Persistent PowerShell did not become ready within %dms — killing it', INIT_TIMEOUT_MS);
      try { ps.kill(); } catch { /* already dead */ }
    }, INIT_TIMEOUT_MS);
  }

  private clearInitTimer(): void {
    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
  }

  private processOutput(): void {
    let markerIdx: number;
    while ((markerIdx = this.outputBuffer.indexOf(MARKER)) !== -1) {
      const output = this.outputBuffer.substring(0, markerIdx).trim();
      this.outputBuffer = this.outputBuffer.substring(markerIdx + MARKER.length).replace(/^\r?\n/, '');

      if (!this.psReady) {
        // First marker = init complete
        this.psReady = true;
        this.clearInitTimer();
        log.info('Persistent PowerShell ready (Add-Type compiled)');
        this.drainQueue();
        continue;
      }

      if (this.staleMarkers > 0) {
        this.staleMarkers--;
        log.info('Discarding output of a timed-out PowerShell command');
        continue;
      }

      if (this.currentCommand) {
        // A completed user command is the signal the process is healthy, not the init marker:
        // resetting there let a process that dies on every command respawn forever.
        this.spawnAttempts = 0;
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
          // PowerShell is still running this command; its marker must not resolve the next one.
          this.staleMarkers++;
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
      let stdout: string;
      if (this.psReady && this.psProcess) {
        stdout = await this.exec(buildPasteCmd(hwnd), 10000);
      } else {
        const args = [
          '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
          `${PW_TYPEDEF}; ${buildPasteCmd(hwnd)}`,
        ];
        stdout = (await execFileAsync('powershell', args, { timeout: 10000, windowsHide: true })).stdout;
      }
      // A throw inside the paste script surfaces only on stderr (the persistent loop catches
      // it), so the success token is the one signal that SendInput actually ran.
      if (!stdout.includes(PASTE_OK)) {
        throw new Error('Paste target lost focus before the keystrokes were sent');
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
    this.clearInitTimer();
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
