import { ipcMain, BrowserWindow, shell, clipboard, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState, WidgetType, RecordingEntry } from '../shared/types';
import { TranscriptionService } from './services/transcription.service';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { HotkeyService } from './services/hotkey.service';
import { HistoryService } from './services/history.service';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

// size is 0–1; returns [width, height] in pixels
export function getOverlaySize(_widget: WidgetType, size: number): [number, number] {
  const t = Math.max(0, Math.min(1, size));
  const w = Math.round(160 + t * 340); // 160–500px
  const h = Math.round(50  + t * 80);  // 50–130px
  return [w, h];
}

export function registerIpcHandlers(
  store: Store<AppSettings>,
  transcriptionService: TranscriptionService,
  broadcastState: (state: RecordingState) => void,
  pasteService: PasteService,
  aiService: AIService,
  hotkeyService: HotkeyService,
  getOverlayWindow: () => BrowserWindow | null,
  historyService: HistoryService,
): void {
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });

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
          showWindow: DEFAULT_SETTINGS.hotkey.shortcuts.showWindow,
        },
        mode: hotkey.mode ?? DEFAULT_SETTINGS.hotkey.mode,
      };
      store.set('hotkey', migrated);
    }

    // Migrate missing shortcuts added in later versions
    const shortcuts = (hotkey?.shortcuts ?? {}) as Record<string, unknown>;
    if (hotkey?.shortcuts && !shortcuts.showWindow) {
      store.set('hotkey.shortcuts.showWindow', DEFAULT_SETTINGS.hotkey.shortcuts.showWindow);
    }
    if (hotkey?.shortcuts && !shortcuts.pushToTalk) {
      store.set('hotkey.shortcuts.pushToTalk', DEFAULT_SETTINGS.hotkey.shortcuts.pushToTalk);
    }

    // Migrate old dictation.customPrompt → dictation.modePrompts format
    const dictation = store.get('dictation') as Record<string, unknown>;
    if (dictation && !dictation.modePrompts) {
      const migrated = {
        currentMode: dictation.currentMode ?? DEFAULT_SETTINGS.dictation.currentMode,
        modePrompts: {
          ...DEFAULT_SETTINGS.dictation.modePrompts,
          ...(typeof dictation.customPrompt === 'string' && dictation.customPrompt
            ? { custom: dictation.customPrompt }
            : {}),
        },
        autoPaste: dictation.autoPaste ?? DEFAULT_SETTINGS.dictation.autoPaste,
        restoreClipboard: dictation.restoreClipboard ?? DEFAULT_SETTINGS.dictation.restoreClipboard,
      };
      store.set('dictation', migrated);
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

    // Resize overlay when widget settings change
    if (settings.widget) {
      const overlayWindow = getOverlayWindow();
      if (overlayWindow) {
        const widget = store.get('widget');
        const [w, h] = getOverlaySize(widget.activeWidget, widget.size);

        // Keep top-left corner anchored — setBounds is atomic (no flicker between calls)
        const { x, y } = overlayWindow.getBounds();
        overlayWindow.setBounds({ x, y, width: w, height: h });
      }
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

  // Transcription — receives raw audio buffer + sampleRate + recordingId from renderer
  ipcMain.handle(IPC.TRANSCRIPTION_START_BUFFER, async (event, audioBuffer: ArrayBuffer, sampleRate: number, recordingId?: string) => {
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

      // Save to history
      const entryId = recordingId ?? Date.now().toString();
      const durationSeconds = samples.length / sampleRate;
      const mode = (store.get('dictation.currentMode') as string) ?? 'voice';
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      const entry: RecordingEntry = {
        id: entryId,
        date: new Date().toISOString(),
        text,
        wordCount,
        durationSeconds,
        appName,
        mode,
      };
      try {
        historyService.add(entry);
      } catch (dbErr) {
        console.error('[Dictator] Failed to save recording to history DB:', dbErr);
      }

      event.sender.send(IPC.TRANSCRIPTION_RESULT, { id: entryId, text, appName, durationSeconds });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      broadcastState('error');
      setTimeout(() => broadcastState('idle'), 3000);
      event.sender.send(IPC.TRANSCRIPTION_ERROR, msg);
    }
  });

  // Save audio file sent from renderer (WebM blob)
  ipcMain.handle(IPC.AUDIO_SAVE, async (_event, id: string, audioBuffer: ArrayBuffer) => {
    const filePath = path.join(recordingsDir, `${id}.webm`);
    await fs.promises.writeFile(filePath, Buffer.from(audioBuffer));
    historyService.updateAudioPath(id, filePath);
    return filePath;
  });

  // History handlers
  ipcMain.handle(IPC.HISTORY_GET_ALL, () => historyService.getAll());
  ipcMain.handle(IPC.HISTORY_DELETE, (_event, id: string) => historyService.delete(id));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_event, query: string) => historyService.search(query));
  ipcMain.handle(IPC.HISTORY_CLEAR_ALL, () => historyService.clearAll());
  ipcMain.handle(IPC.HISTORY_MIGRATE, (_event, entries: RecordingEntry[]) => {
    for (const entry of entries) historyService.add(entry);
  });

  // AI test prompt
  ipcMain.handle(IPC.AI_TEST_PROMPT, async (_event, text: string, systemPrompt: string) => {
    try {
      const result = await aiService.testPrompt(text, systemPrompt);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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
