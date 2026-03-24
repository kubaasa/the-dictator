import { app, autoUpdater, net, Notification, nativeImage } from 'electron';
import type { UpdateState, UpdateStatus } from '../../shared/types';

const GITHUB_REPO = 'kubaasa/the-dictator';
const UPDATE_SERVER = 'https://update.electronjs.org';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class UpdateService {
  private state: UpdateState;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners: Array<(state: UpdateState) => void> = [];
  private iconPath: string;

  constructor(iconPath: string) {
    this.iconPath = iconPath;
    this.state = { status: 'idle', currentVersion: app.getVersion() };
  }

  start(): void {
    if (!app.isPackaged) {
      console.log('[Dictator] Auto-updater disabled in dev mode');
      return;
    }

    const feedURL = `${UPDATE_SERVER}/${GITHUB_REPO}/${process.platform}-${process.arch}/${app.getVersion()}`;
    autoUpdater.setFeedURL({ url: feedURL });

    autoUpdater.on('checking-for-update', () => {
      this.setState('checking');
    });

    autoUpdater.on('update-available', () => {
      this.setState('downloading');
    });

    autoUpdater.on('update-not-available', () => {
      this.setState('idle');
    });

    autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
      this.state = {
        ...this.state,
        status: 'downloaded',
        latestVersion: releaseName?.replace(/^v/, '') || undefined,
        releaseNotes: releaseNotes || undefined,
      };
      this.notify();
      this.showNativeNotification();
    });

    autoUpdater.on('error', (err) => {
      console.warn('[Dictator] Auto-update error:', err.message);
      this.state = { ...this.state, status: 'error', error: err.message };
      this.notify();
    });

    // First check after 30s, then every 4 hours
    setTimeout(() => this.checkForUpdates(), 30_000);
    this.checkTimer = setInterval(() => this.checkForUpdates(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  checkForUpdates(): UpdateState {
    console.log('[Dictator] checkForUpdates() called, isPackaged:', app.isPackaged);
    if (!app.isPackaged) {
      this.devCheckForUpdates().catch((err) => {
        console.error('[Dictator] devCheckForUpdates unhandled error:', err);
      });
      return this.state;
    }
    autoUpdater.checkForUpdates();
    return this.state;
  }

  getUpdateInfo(): UpdateState {
    return this.state;
  }

  quitAndInstall(): void {
    if (this.state.status === 'downloaded') {
      autoUpdater.quitAndInstall();
    }
  }

  onStatusChange(callback: (state: UpdateState) => void): void {
    this.statusListeners.push(callback);
  }

  /** DEV ONLY: check GitHub API directly (autoUpdater needs packaged app) */
  private async devCheckForUpdates(): Promise<void> {
    console.log('[Dictator] Dev: checking GitHub API for updates...');
    this.setState('checking');
    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
      console.log('[Dictator] Dev: fetching', url);
      const response = await net.fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': `TheDictator/${app.getVersion()}`,
        },
      });

      console.log('[Dictator] Dev: GitHub API response status:', response.status);

      if (response.status === 404) {
        console.log('[Dictator] Dev: no releases found on GitHub');
        this.showUpToDateNotification();
        this.setState('idle');
        return;
      }

      if (!response.ok) {
        console.warn('[Dictator] Dev: GitHub API error:', response.status);
        this.setState('idle');
        return;
      }

      const data = await response.json() as { tag_name: string; body: string };
      const latestVersion = data.tag_name.replace(/^v/, '');
      const current = app.getVersion();
      console.log('[Dictator] Dev: current=%s, latest=%s', current, latestVersion);

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
        console.log('[Dictator] Dev: already up to date');
        this.showUpToDateNotification();
        this.setState('idle');
      }
    } catch (err) {
      console.warn('[Dictator] Dev update check failed:', err instanceof Error ? err.message : err);
      this.state = { ...this.state, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
      this.notify();
    }
  }

  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
    const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);
    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
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

  private showUpToDateNotification(): void {
    const notification = new Notification({
      title: 'The Dictator',
      body: `You're up to date! (v${app.getVersion()})`,
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
