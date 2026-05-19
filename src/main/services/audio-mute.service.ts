import { spawn, ChildProcess } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import type Store from 'electron-store';
import logger from './logger';
import type { AppSettings, SessionSnapshot } from '../../shared/types';

const log = logger.scope('AudioMute');

const MAX_SPAWN_ATTEMPTS = 3;
const READY_TIMEOUT_MS = 5000;
const CMD_TIMEOUT_MS = 3000;
const IGNORED_EVENTS = new Set(['reMuted', 'deviceEvent']);

interface HelperEvent {
  event: string;
  [key: string]: unknown;
}

interface PendingCmd {
  expect: string;
  resolve: (ev: HelperEvent) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages a bundled C# helper exe that mutes other Windows audio sessions while
 * The Dictator is recording, then restores prior state. Resilient to helper /
 * Electron crashes via a "dirty snapshot" persisted in electron-store.
 */
export class AudioMuteService {
  private proc: ChildProcess | null = null;
  private ready = false;
  private spawnAttempts = 0;
  private stdoutBuffer = '';
  private pending: PendingCmd | null = null;
  private queue: Array<() => void> = [];
  private muting = false;
  private destroyed = false;
  private initialized = false;

  constructor(private store: Store<AppSettings>) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (process.platform !== 'win32') {
      log.info('Not on win32 — feature disabled');
      return;
    }
    const exePath = this.resolveHelperPath();
    if (!exePath) {
      log.warn('Helper exe not found — feature disabled for this session');
      return;
    }
    try {
      await this.spawnAndWaitReady(exePath);
    } catch (err) {
      log.warn('Helper spawn failed:', err instanceof Error ? err.message : err);
      return;
    }
    const dirty = this.store.get('audio.muteSnapshot') as SessionSnapshot[] | undefined;
    if (dirty && dirty.length > 0) {
      log.info('Restoring %d dirty session(s) from previous run', dirty.length);
      try {
        await this.sendAndAwait({ cmd: 'restore', sessions: dirty }, 'restored', READY_TIMEOUT_MS);
      } catch (err) {
        log.warn('Dirty restore failed:', err instanceof Error ? err.message : err);
      }
      this.store.delete('audio.muteSnapshot' as keyof AppSettings);
    }
  }

  async startMuting(): Promise<void> {
    if (this.destroyed || process.platform !== 'win32') return;
    if (!this.proc || !this.ready) {
      log.info('Helper not ready — skipping mute');
      return;
    }
    if (this.muting) return;

    const excludePids = this.computeExcludePids();
    try {
      // excludeRootPid: helper enumerates all descendant PIDs of our main Electron process
      // (renderers, GPU, audio-service utility) every poll cycle — covers child processes
      // spawned AFTER startMuting (e.g. audio service utility lazy-spawned when first audio
      // cue plays), which otherwise would leak through the static excludePids snapshot.
      const ev = await this.sendAndAwait(
        { cmd: 'start', excludePids, excludeRootPid: process.pid },
        'snapshot',
        CMD_TIMEOUT_MS,
      );
      this.muting = true;
      const sessions = (ev.sessions as SessionSnapshot[] | undefined) ?? [];
      this.store.set('audio.muteSnapshot', sessions);
      const summary = sessions.length > 0
        ? sessions.map((s) => `${s.name || '?'}(${s.pid})`).join(', ')
        : '<none>';
      log.info('Muted %d session(s): %s', sessions.length, summary);
    } catch (err) {
      log.warn('startMuting failed:', err instanceof Error ? err.message : err);
    }
  }

  async stopMuting(): Promise<void> {
    if (this.destroyed || process.platform !== 'win32') return;
    if (!this.muting) return;
    this.muting = false;

    if (!this.proc || !this.ready) {
      // Helper died mid-recording — leave snapshot in store; next launch will restore.
      log.warn('Helper unavailable on stop — leaving dirty snapshot for next-start restore');
      return;
    }
    try {
      await this.sendAndAwait({ cmd: 'stop' }, 'stopped', CMD_TIMEOUT_MS);
      this.store.delete('audio.muteSnapshot' as keyof AppSettings);
      log.info('Unmuted, snapshot cleared');
    } catch (err) {
      log.warn('stopMuting failed:', err instanceof Error ? err.message : err);
    }
  }

  setEnabled(enabled: boolean): void {
    if (!enabled && this.muting) {
      this.stopMuting().catch((err) => log.warn('setEnabled stop failed:', err));
    }
  }

  // Closing stdin lets the helper restore via its own EOF handler before exiting —
  // we don't need to await stop() from before-quit.
  shutdown(): void {
    this.destroyed = true;
    if (this.proc) {
      try { this.proc.stdin?.end(); } catch { /* ignore */ }
      try { this.proc.kill(); } catch { /* ignore */ }
      this.proc = null;
      this.ready = false;
    }
  }

  private computeExcludePids(): number[] {
    const pids = new Set<number>([process.pid]);
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        const pid = w.webContents.getOSProcessId();
        if (pid > 0) pids.add(pid);
      } catch { /* contents may be destroyed */ }
    }
    return [...pids];
  }

  private resolveHelperPath(): string | null {
    const exe = 'audio-mute-helper.exe';
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, exe)]
      : [
          path.join(app.getAppPath(), 'tools', 'audio-mute-helper', 'bin', 'Release', 'net8.0-windows', 'win-x64', 'publish', exe),
          path.join(app.getAppPath(), 'tools', 'audio-mute-helper', 'bin', 'Debug', 'net8.0-windows', 'win-x64', 'publish', exe),
        ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
    }
    log.info('Helper exe not found at:', candidates.join(' | '));
    return null;
  }

  private spawnAndWaitReady(exePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.spawnAttempts++;
      const child = spawn(exePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.proc = child;
      this.stdoutBuffer = '';

      const readyTimer = setTimeout(() => {
        if (!this.ready) {
          log.warn('Helper did not signal "ready" within %dms', READY_TIMEOUT_MS);
          try { child.kill(); } catch { /* ignore */ }
          reject(new Error('Helper ready timeout'));
        }
      }, READY_TIMEOUT_MS);

      child.on('error', (err) => {
        log.warn('Helper process error:', err.message);
      });

      child.on('exit', (code, signal) => {
        log.info('Helper exited (code=%s, signal=%s)', code, signal);
        const wasReady = this.ready;
        this.proc = null;
        this.ready = false;
        this.stdoutBuffer = '';
        const exitErr = new Error('Helper process exited');
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending.reject(exitErr);
          this.pending = null;
        }
        for (const flush of this.queue) flush();
        this.queue = [];
        if (this.muting) {
          // Snapshot persists in store — next-start restore will handle it.
          log.warn('Helper exited while muting — dirty snapshot left in store');
          this.muting = false;
        }
        if (!this.destroyed && wasReady && this.spawnAttempts < MAX_SPAWN_ATTEMPTS) {
          log.info('Respawning helper in 1s (attempt %d/%d)…', this.spawnAttempts + 1, MAX_SPAWN_ATTEMPTS);
          setTimeout(() => {
            if (!this.destroyed && !this.proc) {
              this.spawnAndWaitReady(exePath).catch((e) => log.warn('Respawn failed:', e));
            }
          }, 1000);
        }
      });

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        this.stdoutBuffer += chunk;
        this.drainStdout((ev) => {
          if (ev.event === 'ready' && !this.ready) {
            this.ready = true;
            this.spawnAttempts = 0;
            clearTimeout(readyTimer);
            log.info('Helper ready');
            resolve();
            return;
          }
          this.dispatchEvent(ev);
        });
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        const msg = chunk.trim();
        if (msg) log.warn('Helper stderr:', msg);
      });
    });
  }

  private drainStdout(onEvent: (ev: HelperEvent) => void): void {
    let idx: number;
    while ((idx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as HelperEvent;
        onEvent(ev);
      } catch (err) {
        log.warn('Bad helper JSON:', line, err instanceof Error ? err.message : '');
      }
    }
  }

  private dispatchEvent(ev: HelperEvent): void {
    if (ev.event === 'sessionAdded' && this.muting) {
      const session = ev.session as SessionSnapshot | undefined;
      if (session) {
        const current = (this.store.get('audio.muteSnapshot') as SessionSnapshot[] | undefined) ?? [];
        current.push(session);
        this.store.set('audio.muteSnapshot', current);
      }
      return;
    }
    if (IGNORED_EVENTS.has(ev.event)) return;
    if (ev.event === 'error') {
      log.warn('Helper error event:', ev.message);
      return;
    }
    if (this.pending && this.pending.expect === ev.event) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.resolve(ev);
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private sendAndAwait(payload: Record<string, unknown>, expect: string, timeoutMs: number): Promise<HelperEvent> {
    return new Promise<HelperEvent>((resolve, reject) => {
      if (!this.proc || !this.proc.stdin || !this.ready) {
        reject(new Error('Helper not ready'));
        return;
      }
      const send = () => {
        if (!this.proc || !this.proc.stdin) {
          reject(new Error('Helper unavailable'));
          return;
        }
        // Pending must be assigned BEFORE the timer fires; ordering is fine here because
        // setTimeout never resolves synchronously, but keep this sequence explicit so a
        // future refactor doesn't accidentally introduce a window where the timer's
        // pending-check sees a stale value.
        const entry: PendingCmd = { expect, resolve, reject, timer: null as unknown as ReturnType<typeof setTimeout> };
        entry.timer = setTimeout(() => {
          if (this.pending === entry) {
            this.pending = null;
            reject(new Error(`Helper "${expect}" timeout`));
          }
        }, timeoutMs);
        this.pending = entry;
        try {
          this.proc.stdin.write(JSON.stringify(payload) + '\n');
        } catch (err) {
          clearTimeout(entry.timer);
          if (this.pending === entry) this.pending = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      if (this.pending) {
        this.queue.push(send);
      } else {
        send();
      }
    });
  }
}
