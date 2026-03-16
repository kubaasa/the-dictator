import { ipcMain, BrowserWindow, shell, clipboard, app, screen } from 'electron';
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

export function getOverlaySize(widget: WidgetType): [number, number] {
  if (widget === 'maxi') return [420, 165];
  return [198, 54];
}

/**
 * Clamp widget position so it stays fully within the nearest display's work area.
 * Handles monitor disconnect — getDisplayNearestPoint always returns a valid display.
 */
export function clampToVisibleArea(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const { x: wx, y: wy, width: ww, height: wh } = display.workArea;

  return {
    x: Math.max(wx, Math.min(x, wx + ww - w)),
    y: Math.max(wy, Math.min(y, wy + wh - h)),
  };
}

const TRANSCRIPTION_TIMEOUT_MS = 30_000;

export function registerIpcHandlers(
  store: Store<AppSettings>,
  transcriptionService: TranscriptionService,
  broadcastState: (state: RecordingState) => void,
  pasteService: PasteService,
  aiService: AIService,
  hotkeyService: HotkeyService,
  getOverlayWindow: () => BrowserWindow | null,
  historyService: HistoryService,
  getCurrentState: () => RecordingState,
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

    // Resize overlay and handle visibility when widget settings change
    if (settings.widget) {
      const overlayWindow = getOverlayWindow();
      if (overlayWindow) {
        const widget = store.get('widget');
        const [w, h] = getOverlaySize(widget.activeWidget);

        const { x, y } = overlayWindow.getBounds();
        const clamped = clampToVisibleArea(x, y, w, h);
        const wasHidden = !overlayWindow.isVisible();
        overlayWindow.setBounds({ x: clamped.x, y: clamped.y, width: w, height: h });

        if (widget.activeWidget === 'maxi') {
          if (getCurrentState() === 'idle') overlayWindow.hide();
        } else if (wasHidden) {
          // Show invisible first so the renderer can re-render, then fade in
          overlayWindow.setOpacity(0);
          overlayWindow.show();
          setTimeout(() => { if (!overlayWindow.isDestroyed()) overlayWindow.setOpacity(1); }, 120);
        }
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
      let timeoutId: ReturnType<typeof setTimeout>;
      const rawText = await Promise.race([
        transcriptionService.transcribeFromBuffer(audioBuffer, sampleRate).then((result) => {
          clearTimeout(timeoutId);
          return result;
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Transcription timed out after 30 seconds')), TRANSCRIPTION_TIMEOUT_MS);
        }),
      ]);

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
      const countWordsInline = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
      const wordCount = countWordsInline(text);
      const rawWordCount = countWordsInline(rawText);
      const entry: RecordingEntry = {
        id: entryId,
        date: new Date().toISOString(),
        text,
        wordCount,
        rawWordCount,
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
  ipcMain.handle(IPC.HISTORY_GET_STATS, () => {
    try {
      const data = historyService.getStats();
      return { success: true, data };
    } catch (err) {
      console.error('[IPC] HISTORY_GET_STATS failed:', err);
      return { success: false, data: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_GET_ALL, () => {
    try {
      const data = historyService.getAll();
      return { success: true, data };
    } catch (err) {
      console.error('[IPC] HISTORY_GET_ALL failed:', err);
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_DELETE, (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string') {
        return { success: false, error: 'Invalid recording ID' };
      }
      const result = historyService.delete(id);
      return { success: true, ...result };
    } catch (err) {
      console.error('[IPC] HISTORY_DELETE failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_SEARCH, (_event, query: string) => {
    try {
      if (typeof query !== 'string') {
        return { success: true, data: historyService.getAll() };
      }
      const data = historyService.search(query);
      return { success: true, data };
    } catch (err) {
      console.error('[IPC] HISTORY_SEARCH failed:', err);
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_CLEAR_ALL, () => {
    try {
      const result = historyService.clearAll();
      return { success: true, ...result };
    } catch (err) {
      console.error('[IPC] HISTORY_CLEAR_ALL failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_MIGRATE, (_event, entries: unknown) => {
    try {
      if (!Array.isArray(entries)) {
        return { success: false, error: 'Expected an array of entries' };
      }
      let added = 0;
      let skipped = 0;
      for (const entry of entries) {
        try {
          const e = entry as Record<string, unknown>;
          // Backfill rawWordCount for legacy entries that predate this field
          if (typeof e.rawWordCount !== 'number') {
            e.rawWordCount = typeof e.wordCount === 'number' ? e.wordCount : 0;
          }
          historyService.add(e as RecordingEntry);
          added++;
        } catch (entryErr) {
          console.warn('[IPC] HISTORY_MIGRATE skipped invalid entry:', entryErr);
          skipped++;
        }
      }
      return { success: true, added, skipped };
    } catch (err) {
      console.error('[IPC] HISTORY_MIGRATE failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // AI: fetch available OpenAI models using the stored API key
  ipcMain.handle(IPC.AI_GET_OPENAI_MODELS, async () => {
    try {
      const models = await aiService.getOpenAIModels();
      return { success: true, models };
    } catch (err) {
      return { success: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
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

  // Widget drag — main process tracks cursor globally so fast mouse movement can't escape the window
  let dragInterval: ReturnType<typeof setInterval> | null = null;
  let dragOffset = { x: 0, y: 0 };
  let cancelGlobalMouseUp: (() => void) | null = null;

  function stopDrag() {
    if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
    if (cancelGlobalMouseUp) { cancelGlobalMouseUp(); cancelGlobalMouseUp = null; }
    const overlay = getOverlayWindow();
    if (overlay) {
      const { x, y, width, height } = overlay.getBounds();
      const clamped = clampToVisibleArea(x, y, width, height);
      overlay.setPosition(clamped.x, clamped.y);
      store.set('widget.x', clamped.x);
      store.set('widget.y', clamped.y);
    }
  }

  ipcMain.on(IPC.WIDGET_DRAG_START, (_event, offsetX: number, offsetY: number) => {
    stopDrag(); // clear any previous drag that didn't end cleanly

    dragOffset = { x: offsetX, y: offsetY };
    dragInterval = setInterval(() => {
      const overlay = getOverlayWindow();
      if (!overlay) return;
      const cursor = screen.getCursorScreenPoint();
      overlay.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y);
    }, 16);

    // Fallback: if mouseup fires outside the overlay window (renderer never sees it),
    // uiohook catches it globally and stops the drag.
    cancelGlobalMouseUp = hotkeyService.onGlobalMouseUp(stopDrag);
  });

  ipcMain.on(IPC.WIDGET_DRAG_END, stopDrag);
}
