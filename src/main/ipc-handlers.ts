import { ipcMain, BrowserWindow, shell, clipboard } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState } from '../shared/types';
import { TranscriptionService } from './services/transcription.service';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { HotkeyService } from './services/hotkey.service';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

export function registerIpcHandlers(
  store: Store<AppSettings>,
  transcriptionService: TranscriptionService,
  broadcastState: (state: RecordingState) => void,
  pasteService: PasteService,
  aiService: AIService,
  hotkeyService: HotkeyService,
): void {
  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    // Migrate old hotkey.shortcut → hotkey.shortcuts format
    const hotkey = store.get('hotkey') as Record<string, unknown>;
    if (hotkey && !hotkey.shortcuts && typeof hotkey.shortcut === 'string') {
      const migrated = {
        shortcuts: {
          toggleRecording: hotkey.shortcut as string,
          cancelRecording: DEFAULT_SETTINGS.hotkey.shortcuts.cancelRecording,
          modeSelect: DEFAULT_SETTINGS.hotkey.shortcuts.modeSelect,
        },
        mode: hotkey.mode ?? DEFAULT_SETTINGS.hotkey.mode,
      };
      store.set('hotkey', migrated);
    }
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

    // Update hotkey service if shortcuts or mode changed
    if (settings.hotkey) {
      const hotkey = store.get('hotkey');
      hotkeyService.updateShortcuts(hotkey.shortcuts);
      hotkeyService.setMode(hotkey.mode);
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
    // Silence detection: skip transcription if audio is below speech threshold.
    // Prevents Whisper hallucinations like [muzyka], [music], [cisza] on silence.
    const samples = new Float32Array(audioBuffer);
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    if (rms < 0.01) {
      broadcastState('idle');
      return;
    }

    broadcastState('transcribing');
    try {
      const rawText = await transcriptionService.transcribeFromBuffer(audioBuffer, sampleRate);

      // Safety net: filter known Whisper hallucinations that appear on near-silence audio
      const HALLUCINATION_RE = /^\s*[\[(]?(muzyka|music|cisza|silence|szum|noise|applause|oklaski|śmiech|laughter)[\])]?\s*$/i;
      if (!rawText || HALLUCINATION_RE.test(rawText)) {
        broadcastState('idle');
        return;
      }

      broadcastState('processing');
      let text: string;
      try {
        text = await aiService.process(rawText);
      } catch (aiErr) {
        console.warn('[Dictator] AI processing failed, using raw text:', aiErr);
        text = rawText;
      }

      broadcastState('done');
      setTimeout(() => broadcastState('idle'), 1500);
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
