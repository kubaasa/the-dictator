import { app, net, Notification, nativeImage, shell } from 'electron';
import type { UpdateState, UpdateStatus } from '../../shared/types';
import logger from './logger';

const log = logger.scope('Update');

const GITHUB_REPO = 'kubaasa/the-dictator';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class UpdateService {
  private state: UpdateState;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners: Array<(state: UpdateState) => void> = [];
  private iconPath: string;
  private manualCheck = false;

  constructor(iconPath: string) {
    this.iconPath = iconPath;
    this.state = { status: 'idle', currentVersion: app.getVersion() };
  }

  start(): void {
    // Squirrel.Windows autoUpdater is incompatible with WiX MSI installers.
    // Use GitHub API check for both dev and production until electron-updater is integrated.
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
    if (this.state.status === 'downloaded') {
      // WiX MSI doesn't support Squirrel's quitAndInstall — open releases page instead
      shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`);
    }
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

      const data = await response.json() as { tag_name: string; body: string };
      const latestVersion = data.tag_name.replace(/^v/, '');
      const current = app.getVersion();
      log.info('Current=%s, latest=%s', current, latestVersion);

      if (this.isNewer(latestVersion, current)) {
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

  private isNewer(latest: string, current: string): boolean {
    // Strip pre-release suffixes (e.g. "1.1.1-beta" → "1.1.1") before comparing
    const parse = (v: string) => v.split('-')[0].split('.').map(Number);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
    const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);
    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
  }

  private setUpToDate(): void {
    this.setState('up-to-date');
    setTimeout(() => {
      if (this.state.status === 'up-to-date') this.setState('idle');
    }, 5000);
  }

  private setState(status: UpdateStatus): void {
    this.state = { ...this.state, status, error: undefined };
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
