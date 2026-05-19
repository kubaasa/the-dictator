import { app, Menu, Tray, nativeImage, BrowserWindow } from 'electron';
import type { RecordingState, UpdateState } from '../shared/types';
import { getAssetPath } from './paths';

interface TrayCallbacks {
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onAutoStartToggle: (enabled: boolean) => void;
  onAudioCuesToggle: (enabled: boolean) => void;
  onMuteOthersToggle: (enabled: boolean) => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private state: RecordingState = 'idle';
  private updateState: UpdateState | null = null;
  private callbacks: TrayCallbacks | null = null;
  private autoStartEnabled = false;
  private audioCuesEnabled = true;
  private muteOthersEnabled = true;

  create(mainWindow: BrowserWindow, callbacks: TrayCallbacks): void {
    this.mainWindow = mainWindow;
    this.callbacks = callbacks;

    const iconPath = getAssetPath('icon.png');
    const rawIcon = nativeImage.createFromPath(iconPath);
    const { width, height } = rawIcon.getSize();
    // Crop center to remove transparent rounded-corner padding
    const margin = Math.floor(width * 0.1);
    const icon = rawIcon
      .crop({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 })
      .resize({ width: 32, height: 32 });
    this.tray = new Tray(icon);
    this.tray.setToolTip('The Dictator');
    this.updateMenu();

    this.tray.on('click', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isVisible()) {
          this.mainWindow.hide();
        } else {
          this.mainWindow.show();
          this.mainWindow.focus();
        }
      }
    });
  }

  updateRecordingState(state: RecordingState): void {
    this.state = state;
    if (this.tray) {
      this.tray.setToolTip(`The Dictator — ${state}`);
      this.updateMenu();
    }
  }

  setAutoStart(enabled: boolean): void {
    this.autoStartEnabled = enabled;
    this.updateMenu();
  }

  setAudioCues(enabled: boolean): void {
    this.audioCuesEnabled = enabled;
    this.updateMenu();
  }

  setMuteOthers(enabled: boolean): void {
    this.muteOthersEnabled = enabled;
    this.updateMenu();
  }

  setUpdateState(state: UpdateState): void {
    this.updateState = state;
    this.updateMenu();
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  private getUpdateMenuItem(): Electron.MenuItemConstructorOptions {
    const status = this.updateState?.status ?? 'idle';

    switch (status) {
      case 'checking':
        return { label: 'Checking for updates...', enabled: false };
      case 'downloading':
        return { label: 'Downloading update...', enabled: false };
      case 'downloaded': {
        const version = this.updateState?.latestVersion;
        return {
          label: `Restart to Update${version ? ` (v${version})` : ''}`,
          click: () => this.callbacks?.onInstallUpdate(),
        };
      }
      case 'up-to-date':
        return { label: `Up to date (v${this.updateState?.currentVersion ?? ''})`, enabled: false };
      case 'error':
      case 'idle':
      default:
        return {
          label: 'Check for Updates',
          click: () => this.callbacks?.onCheckForUpdates(),
        };
    }
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Version ${app.getVersion()}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Settings',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        },
      },
      {
        label: `${this.autoStartEnabled ? '■' : '   '} Run with Windows`,
        click: () => {
          this.autoStartEnabled = !this.autoStartEnabled;
          this.callbacks?.onAutoStartToggle(this.autoStartEnabled);
          this.updateMenu();
        },
      },
      {
        label: `${this.audioCuesEnabled ? '■' : '   '} Sound Effects`,
        click: () => {
          this.audioCuesEnabled = !this.audioCuesEnabled;
          this.callbacks?.onAudioCuesToggle(this.audioCuesEnabled);
          this.updateMenu();
        },
      },
      {
        label: `${this.muteOthersEnabled ? '■' : '   '} Mute other apps while recording`,
        click: () => {
          this.muteOthersEnabled = !this.muteOthersEnabled;
          this.callbacks?.onMuteOthersToggle(this.muteOthersEnabled);
          this.updateMenu();
        },
      },
      this.getUpdateMenuItem(),
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}
