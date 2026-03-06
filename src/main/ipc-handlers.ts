import { ipcMain, BrowserWindow, shell } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState } from '../shared/types';
import { AudioRecorderService } from './services/audio-recorder.service';
import { TranscriptionService } from './services/transcription.service';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

export function registerIpcHandlers(
  store: Store<AppSettings>,
  audioRecorder: AudioRecorderService,
  transcriptionService: TranscriptionService,
  broadcastState: (state: RecordingState) => void,
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

  // Transcription
  ipcMain.handle(IPC.TRANSCRIPTION_START, async (event, wavPath: string) => {
    broadcastState('transcribing');
    try {
      const engine = (store.get('transcription.engine') as string) ?? 'local';
      const text = engine === 'api'
        ? await transcriptionService.transcribeApi(wavPath)
        : await transcriptionService.transcribeLocal(wavPath);
      broadcastState('done');
      event.sender.send(IPC.TRANSCRIPTION_RESULT, { text, wavPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcastState('error');
      event.sender.send(IPC.TRANSCRIPTION_ERROR, msg);
    }
  });

  // Open recordings folder in system file explorer
  ipcMain.on(IPC.APP_OPEN_RECORDINGS_FOLDER, () => {
    shell.openPath(audioRecorder.getRecordingsDir());
  });

  // Open models cache folder in system file explorer
  ipcMain.on(IPC.APP_OPEN_MODELS_FOLDER, () => {
    shell.openPath(transcriptionService.getModelsCacheDir());
  });

  // Model
  ipcMain.handle(IPC.MODEL_STATUS, () => ({
    downloaded: transcriptionService.isModelDownloaded(),
  }));

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
