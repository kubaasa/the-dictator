import { app, Menu, Tray, nativeImage, BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { RecordingState } from '../shared/types';

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private state: RecordingState = 'idle';

  create(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    // Use a simple 16x16 icon - create programmatically for now
    const icon = this.createTrayIcon();
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

  private createTrayIcon(): nativeImage {
    // 16x16 red microphone-like icon (simple colored square for now)
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        // Simple circle shape
        const cx = size / 2;
        const cy = size / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

        if (dist < size / 2 - 1) {
          canvas[idx] = 220;     // R
          canvas[idx + 1] = 50;  // G
          canvas[idx + 2] = 50;  // B
          canvas[idx + 3] = 255; // A
        } else {
          canvas[idx + 3] = 0; // transparent
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }
}
