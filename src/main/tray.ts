import { app, Menu, Tray, nativeImage, BrowserWindow } from 'electron';
import path from 'node:path';
import type { RecordingState } from '../shared/types';

/** Resolve asset path — dev: project root, prod: extraResource in resources/ */
function getAssetPath(filename: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(app.getAppPath(), 'assets', filename);
}

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private state: RecordingState = 'idle';

  create(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    const iconPath = getAssetPath('icon.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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

  updateState(state: RecordingState): void {
    this.state = state;
    if (this.tray) {
      this.tray.setToolTip(`The Dictator — ${state}`);
      this.updateMenu();
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Status: ${this.state}`,
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
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}
