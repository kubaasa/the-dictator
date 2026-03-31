import { app, net, Notification, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { UpdateState, UpdateStatus } from '../../shared/types';
import logger from './logger';

const log = logger.scope('Update');

const GITHUB_REPO = 'kubaasa/the-dictator';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface GithubRelease {
  tag_name: string;
  body: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export class UpdateService {
  private state: UpdateState;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners: Array<(state: UpdateState) => void> = [];
  private iconPath: string;
  private manualCheck = false;
  private installerPath: string | null = null;

  constructor(iconPath: string) {
    this.iconPath = iconPath;
    this.state = { status: 'idle', currentVersion: app.getVersion() };
  }

  start(): void {
    log.info('Update service started (GitHub API mode)');
    this.checkForUpdates();
    this.checkTimer = setInterval(() => this.checkForUpdates(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  checkForUpdates(manual = false): UpdateState {
    log.info('checkForUpdates() called, manual:', manual);
    this.manualCheck = manual;
    this.githubCheckForUpdates().catch((err) => {
      log.error('GitHub update check unhandled error:', err);
    });
    return this.state;
  }

  getUpdateInfo(): UpdateState {
    return this.state;
  }

  quitAndInstall(): void {
    if (this.state.status !== 'downloaded' || !this.installerPath) return;

    log.info('Launching installer:', this.installerPath);
    // /S = silent NSIS flag — runs the installer without user interaction.
    // detached + unref = the installer process survives after our app exits.
    spawn(this.installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }

  onStatusChange(callback: (state: UpdateState) => void): void {
    this.statusListeners.push(callback);
  }

  private async githubCheckForUpdates(): Promise<void> {
    log.info('Checking GitHub API for updates...');
    this.setState('checking');
    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
      log.info('Fetching', url);
      const response = await net.fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': `TheDictator/${app.getVersion()}`,
        },
      });

      log.info('GitHub API response status:', response.status);

      if (response.status === 404) {
        log.info('No releases found on GitHub');
        this.setUpToDate();
        return;
      }

      if (!response.ok) {
        log.warn('GitHub API error:', response.status);
        this.setState('idle');
        return;
      }

      const data = await response.json() as GithubRelease;
      const latestVersion = data.tag_name.replace(/^v/, '');
      const current = app.getVersion();
      log.info('Current=%s, latest=%s', current, latestVersion);

      if (this.isNewer(latestVersion, current)) {
        const installerAsset = data.assets.find((a) => a.name.endsWith('.exe'));
        if (!installerAsset) {
          log.warn('No .exe installer found in release assets');
          this.state = { ...this.state, status: 'error', error: 'No installer found in release' };
          this.notify();
          return;
        }

        this.setState('downloading');
        const downloaded = await this.downloadInstaller(installerAsset.browser_download_url, installerAsset.name);
        if (!downloaded) return;

        this.state = {
          ...this.state,
          status: 'downloaded',
          latestVersion,
          releaseNotes: data.body ?? undefined,
        };
        this.notify();
        this.showNativeNotification();
      } else {
        log.info('Already up to date');
        this.setUpToDate();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.warn('Update check failed:', message);
      if (this.manualCheck) {
        this.showErrorNotification(message);
        this.manualCheck = false;
      }
      this.state = { ...this.state, status: 'error', error: message };
      this.notify();
    }
  }

  private async downloadInstaller(url: string, filename: string): Promise<boolean> {
    const dest = path.join(app.getPath('temp'), filename);
    log.info('Downloading installer to', dest);

    try {
      const response = await net.fetch(url);
      if (!response.ok || !response.body) {
        log.error('Installer download failed:', response.status);
        this.state = { ...this.state, status: 'error', error: 'Installer download failed' };
        this.notify();
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(dest, buffer);
      this.installerPath = dest;
      log.info('Installer downloaded: %d bytes', buffer.length);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed';
      log.error('Installer download error:', message);
      this.state = { ...this.state, status: 'error', error: message };
      this.notify();
      return false;
    }
  }

  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => {
      const [core, ...preParts] = v.split('-');
      const nums = core.split('.').map(Number);
      return { nums, preRelease: preParts.join('-') };
    };
    const l = parse(latest);
    const c = parse(current);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = l.nums;
    const [cMajor = 0, cMinor = 0, cPatch = 0] = c.nums;
    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    if (lPatch !== cPatch) return lPatch > cPatch;
    // Same core version: release (no suffix) is newer than pre-release (e.g. 1.2.0 > 1.2.0-beta)
    if (c.preRelease && !l.preRelease) return true;
    return false;
  }

  private setUpToDate(): void {
    this.setState('up-to-date');
    setTimeout(() => {
      if (this.state.status === 'up-to-date') this.setState('idle');
    }, 5000);
  }

  private setState(status: UpdateStatus): void {
    this.state = { ...this.state, status, error: undefined, manual: this.manualCheck };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.statusListeners) {
      listener(this.state);
    }
  }

  private showErrorNotification(errorMessage: string): void {
    const notification = new Notification({
      title: 'The Dictator',
      body: `Update check failed: ${errorMessage}`,
      icon: nativeImage.createFromPath(this.iconPath),
    });
    notification.show();
  }

  private showNativeNotification(): void {
    const version = this.state.latestVersion;
    const notification = new Notification({
      title: 'The Dictator — Update Ready',
      body: `Version ${version ?? 'new'} is ready to install. Right-click the tray icon to restart.`,
      icon: nativeImage.createFromPath(this.iconPath),
    });
    notification.show();
  }
}
