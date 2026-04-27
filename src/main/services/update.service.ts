import { app, Notification, nativeImage } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import type { UpdateState, UpdateStatus } from '../../shared/types';
import logger from './logger';

const log = logger.scope('Update');

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

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    // Forward electron-updater logs to our scoped logger so they show up next to other main-process logs
    autoUpdater.logger = log;

    this.bindEvents();
  }

  start(): void {
    if (!app.isPackaged) {
      log.info('Skipping update check — running in dev mode (electron-updater requires packaged app)');
      return;
    }
    log.info('Update service started (electron-updater)');
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
    if (!app.isPackaged) {
      this.setUpToDate();
      return this.state;
    }
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('checkForUpdates unhandled error:', err);
    });
    return this.state;
  }

  getUpdateInfo(): UpdateState {
    return this.state;
  }

  quitAndInstall(): void {
    if (this.state.status !== 'downloaded') return;
    log.info('quitAndInstall() — restarting with update');
    // (isSilent=true, isForceRunAfter=true): minimizes installer UI exposure during the update
    // and ensures the app re-launches after the new version is installed.
    autoUpdater.quitAndInstall(true, true);
  }

  onStatusChange(callback: (state: UpdateState) => void): void {
    this.statusListeners.push(callback);
  }

  private bindEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.setState('checking');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info('Update available:', info.version);
      this.state = {
        ...this.state,
        status: 'downloading',
        latestVersion: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        progress: 0,
        error: undefined,
        manual: this.manualCheck,
      };
      this.notify();
    });

    autoUpdater.on('update-not-available', () => {
      log.info('Already up to date');
      this.setUpToDate();
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.state = { ...this.state, status: 'downloading', progress: progress.percent };
      this.notify();
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info('Update downloaded:', info.version);
      this.state = {
        ...this.state,
        status: 'downloaded',
        latestVersion: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        progress: 100,
      };
      this.notify();
      this.showNativeNotification();
    });

    autoUpdater.on('error', (err) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.warn('Update error:', message);
      if (this.manualCheck) {
        this.showErrorNotification(message);
        this.manualCheck = false;
      }
      this.state = { ...this.state, status: 'error', error: message };
      this.notify();
    });
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
