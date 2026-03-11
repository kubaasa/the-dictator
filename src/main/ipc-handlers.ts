import { ipcMain, BrowserWindow, shell, clipboard } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState } from '../shared/types';
import { TranscriptionService } from './services/transcription.service';
import { PasteService } from './services/paste.service';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

export function registerIpcHandlers(
  store: Store<AppSettings>,
  transcriptionService: TranscriptionService,
  broadcastState: (state: RecordingState) => void,
  pasteService: PasteService,
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

  // Transcription readiness check (before recording starts)
  ipcMain.handle(IPC.TRANSCRIPTION_CHECK_READY, () => {
    const engine = (store.get('transcription.engine') as string) ?? 'local';
    if (engine === 'api') {
      const apiKey = (store.get('transcription.openaiApiKey') as string) ?? '';
      if (!apiKey) return { ready: false, error: 'OpenAI API key is not set. Go to Modes and enter your key.' };
    } else {
      if (!transcriptionService.isModelDownloaded()) {
        return { ready: false, error: 'Model not downloaded. Go to Modes to download it.' };
      }
    }
    return { ready: true };
  });

  // Transcription — receives raw audio buffer directly, no disk I/O
  ipcMain.handle(IPC.TRANSCRIPTION_START_BUFFER, async (event, audioBuffer: ArrayBuffer, sampleRate: number) => {
    broadcastState('transcribing');
    try {
      const text = await transcriptionService.transcribeFromBuffer(audioBuffer, sampleRate);
      broadcastState('done');
      const autoPaste = (store.get('dictation.autoPaste') as boolean) ?? true;
      console.log('[Dictator] Transcription done. autoPaste=%s, text="%s"', autoPaste, text);

      // Always write to clipboard so the user can always Ctrl+V manually
      clipboard.writeText(text);
      console.log('[Dictator] Text copied to clipboard');

      const appName = pasteService.getAppName() ?? undefined;
      if (autoPaste && pasteService.hasTarget()) {
        await pasteService.simulatePaste();
        // Re-write after paste so transcribed text stays in clipboard for manual use
        clipboard.writeText(text);
      }
      event.sender.send(IPC.TRANSCRIPTION_RESULT, { text, appName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcastState('error');
      setTimeout(() => broadcastState('idle'), 3000);
      event.sender.send(IPC.TRANSCRIPTION_ERROR, msg);
    }
  });

  // Open models cache folder in system file explorer
  ipcMain.on(IPC.APP_OPEN_MODELS_FOLDER, () => {
    shell.openPath(transcriptionService.getModelsCacheDir());
  });

  // Model
  ipcMain.handle(IPC.MODEL_STATUS, () => {
    return { downloaded: transcriptionService.isModelDownloaded() };
  });

  ipcMain.handle(IPC.MODEL_ALL_DOWNLOADED, () => {
    return transcriptionService.getDownloadedModels();
  });

  ipcMain.handle(IPC.MODEL_DOWNLOAD, async (event) => {
    try {
      await transcriptionService.downloadModel((pct) => {
        event.sender.send(IPC.MODEL_DOWNLOAD_PROGRESS, pct);
      });
      event.sender.send(IPC.MODEL_DOWNLOAD_DONE);
    } catch (err) {
      // AbortError = user cancelled — not an error worth showing
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (!isAbort) {
        event.sender.send(IPC.MODEL_DOWNLOAD_ERROR, err instanceof Error ? err.message : String(err));
      }
    }
  });

  ipcMain.on(IPC.MODEL_DOWNLOAD_CANCEL, () => {
    transcriptionService.cancelDownload();
  });
}
