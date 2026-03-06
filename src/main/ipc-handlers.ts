import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings } from '../shared/types';
import { AudioRecorderService } from './services/audio-recorder.service';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

export function registerIpcHandlers(
  store: Store<AppSettings>,
  audioRecorder: AudioRecorderService,
): void {
  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return store.store;
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_event, settings: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value);
    }
    // Notify all renderer windows about settings change
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SETTINGS_ON_CHANGE, store.store);
    }
    return store.store;
  });

  // Audio
  ipcMain.handle(
    IPC.AUDIO_SAVE_WAV,
    async (_event, audioBuffer: ArrayBuffer, sampleRate: number) => {
      return audioRecorder.saveWav(audioBuffer, sampleRate);
    },
  );
}
