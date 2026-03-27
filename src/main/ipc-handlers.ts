import { ipcMain, BrowserWindow, shell, clipboard, app, screen, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import logger from './services/logger';
import { IPC } from '../shared/constants';

const log = logger.scope('IPC');
import type { AppSettings, RecordingState, WidgetType, RecordingEntry, VocabularyEntry } from '../shared/types';
import { TranscriptionService } from './services/transcription.service';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { HotkeyService } from './services/hotkey.service';
import { HistoryService } from './services/history.service';
import { UpdateService } from './services/update.service';
import { encryptSettingsKeys, decryptSettingsForRenderer, getApiKey } from './services/secure-storage';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

/** Only allow safe characters in recording IDs to prevent path traversal. */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
function sanitizeId(id: string): string {
  if (!id || !SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid recording ID: "${id}"`);
  }
  return id;
}

/**
 * Extract a clean, user-friendly message from API errors (OpenAI, Anthropic, Groq SDKs).
 * SDK error objects often dump raw JSON into .message — this pulls out just the human-readable part.
 */
function formatApiError(err: unknown): string {
  const status = (err as { status?: number }).status;

  // Anthropic SDK: err.error.error.message — clean inner message
  const innerMsg =
    (err as { error?: { error?: { message?: string } } })?.error?.error?.message
    // OpenAI SDK: err.error.message
    ?? (err as { error?: { message?: string } })?.error?.message;

  if (status === 401 || status === 403) {
    const detail = innerMsg ?? 'Invalid credentials';
    return `${detail}. Delete the API key and add a new one.`;
  }

  if (innerMsg) return innerMsg;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Apply vocabulary find-and-replace (case-insensitive, whole-word). Last step in pipeline. */
function applyVocabularyReplacements(text: string, vocabulary: VocabularyEntry[]): string {
  if (!vocabulary || vocabulary.length === 0) return text;

  let result = text;
  for (const entry of vocabulary) {
    if (!entry.replacement) continue;

    const escaped = entry.input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b doesn't work with non-ASCII (Polish etc.) — use whitespace/punctuation boundaries instead
    // eslint-disable-next-line no-control-regex
    const hasNonAscii = /[^\x00-\x7F]/.test(entry.input);
    const pattern = hasNonAscii
      ? `(?<=^|[\\s.,;:!?"""''()\\[\\]])${escaped}(?=$|[\\s.,;:!?"""''()\\[\\]])`
      : `\\b${escaped}\\b`;
    const regex = new RegExp(pattern, 'gi');
    const safeReplacement = entry.replacement.replace(/\$/g, '$$$$');
    result = result.replace(regex, safeReplacement);
  }
  return result;
}

export function getOverlaySize(widget: WidgetType): [number, number] {
  if (widget === 'maxi') return [520, 170];
  return [210, 62];
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

const TRANSCRIPTION_TIMEOUT_MIN_MS = 30_000;
const TRANSCRIPTION_TIMEOUT_MAX_MS = 120_000;
const AI_TIMEOUT_MS = 30_000;

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
  updateService: UpdateService,
  onAutoStartChanged: (enabled: boolean) => void,
  onAudioCuesChanged: (enabled: boolean) => void,
): void {
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });

  // Guard: prevent concurrent transcriptions from spamming the expensive pipeline
  let transcriptionInProgress = false;

  // Deduplicated idle-transition timeout — prevents stale setTimeout callbacks
  // from resetting state after a new recording has already started
  let idleTransitionTimeout: ReturnType<typeof setTimeout> | null = null;
  function scheduleIdle(delay: number): void {
    if (idleTransitionTimeout) clearTimeout(idleTransitionTimeout);
    idleTransitionTimeout = setTimeout(() => {
      broadcastState('idle');
      idleTransitionTimeout = null;
    }, delay);
  }

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    // Migrate old hotkey.shortcut → hotkey.shortcuts format
    const hotkey = store.get('hotkey') as Record<string, unknown>;
    if (hotkey && !hotkey.shortcuts && typeof hotkey.shortcut === 'string') {
      const migrated = {
        shortcuts: {
          toggleRecording: hotkey.shortcut as string,
          cancelRecording: DEFAULT_SETTINGS.hotkey.shortcuts.cancelRecording,
          pushToTalk: DEFAULT_SETTINGS.hotkey.shortcuts.pushToTalk,
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

    // Migrate old dictation format (modePrompts/currentMode) → new format (aiPostProcessing/customPrompt)
    const dictation = store.get('dictation') as Record<string, unknown>;
    if (dictation && ('modePrompts' in dictation || 'currentMode' in dictation)) {
      const migrated = {
        aiPostProcessing: dictation.aiPostProcessing ?? DEFAULT_SETTINGS.dictation.aiPostProcessing,
        customPrompt: dictation.customPrompt ?? DEFAULT_SETTINGS.dictation.customPrompt,
        autoPaste: dictation.autoPaste ?? DEFAULT_SETTINGS.dictation.autoPaste,
        restoreClipboard: dictation.restoreClipboard ?? DEFAULT_SETTINGS.dictation.restoreClipboard,
      };
      store.set('dictation', migrated);
    }

    // Migrate vocabulary: string[] → VocabularyEntry[]
    const vocab = store.get('vocabulary') as unknown[];
    if (Array.isArray(vocab) && vocab.length > 0 && typeof vocab[0] === 'string') {
      const migrated = (vocab as string[]).map((word, i) => ({
        id: `migrated-${i}-${Date.now()}`,
        input: word,
      }));
      store.set('vocabulary', migrated);
    }

    return decryptSettingsForRenderer(store.store);
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_event, settings: Partial<AppSettings>) => {
    // Runtime validation: only allow known top-level keys from AppSettings
    const ALLOWED_KEYS = new Set<string>([
      'transcription', 'ai', 'hotkey', 'dictation', 'audio', 'vocabulary', 'widget', 'general',
    ]);

    for (const key of Object.keys(settings)) {
      if (!ALLOWED_KEYS.has(key)) {
        throw new Error(`Unknown settings key: "${key}"`);
      }
    }

    // Basic type validation for each known section
    if (settings.transcription !== undefined && (typeof settings.transcription !== 'object' || settings.transcription === null)) {
      throw new Error('Invalid value for "transcription": expected object');
    }
    if (settings.ai !== undefined && (typeof settings.ai !== 'object' || settings.ai === null)) {
      throw new Error('Invalid value for "ai": expected object');
    }
    if (settings.hotkey !== undefined && (typeof settings.hotkey !== 'object' || settings.hotkey === null)) {
      throw new Error('Invalid value for "hotkey": expected object');
    }
    if (settings.dictation !== undefined && (typeof settings.dictation !== 'object' || settings.dictation === null)) {
      throw new Error('Invalid value for "dictation": expected object');
    }
    if (settings.vocabulary !== undefined) {
      if (!Array.isArray(settings.vocabulary)) {
        throw new Error('Invalid value for "vocabulary": expected array');
      }
      if (settings.vocabulary.length > 500) {
        throw new Error('Vocabulary limit exceeded: maximum 500 entries');
      }
      for (const entry of settings.vocabulary) {
        if (typeof entry !== 'object' || entry === null || typeof entry.input !== 'string') {
          throw new Error('Invalid vocabulary entry: each must have "input" string');
        }
        if (typeof entry.id !== 'string') {
          throw new Error('Invalid vocabulary entry: "id" must be a string');
        }
        if (!entry.input.trim()) {
          throw new Error('Invalid vocabulary entry: "input" cannot be empty');
        }
        if (entry.input.length > 200) {
          throw new Error('Invalid vocabulary entry: "input" exceeds 200 characters');
        }
        if (entry.replacement !== undefined && typeof entry.replacement !== 'string') {
          throw new Error('Invalid vocabulary entry: "replacement" must be a string');
        }
        if (typeof entry.replacement === 'string' && entry.replacement.length > 200) {
          throw new Error('Invalid vocabulary entry: "replacement" exceeds 200 characters');
        }
      }
    }
    if (settings.widget !== undefined && (typeof settings.widget !== 'object' || settings.widget === null)) {
      throw new Error('Invalid value for "widget": expected object');
    }
    if (settings.general !== undefined && (typeof settings.general !== 'object' || settings.general === null)) {
      throw new Error('Invalid value for "general": expected object');
    }
    if (settings.audio !== undefined && (typeof settings.audio !== 'object' || settings.audio === null)) {
      throw new Error('Invalid value for "audio": expected object');
    }

    // Encrypt API keys before persisting to disk
    encryptSettingsKeys(settings);
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value);
    }
    // Notify all renderer windows about settings change (with decrypted keys for display)
    const decrypted = decryptSettingsForRenderer(store.store);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SETTINGS_ON_CHANGE, decrypted);
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
          setTimeout(() => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(1); }, 120);
        }
      }
    }

    // Sync Windows login item when autoStart is toggled from renderer UI
    if (settings.general?.autoStart !== undefined) {
      onAutoStartChanged(store.get('general.autoStart') as boolean);
    }

    // Sync tray checkbox when audio cues are toggled from renderer UI
    if (settings.audio?.soundEnabled !== undefined) {
      onAudioCuesChanged(store.get('audio.soundEnabled') as boolean);
    }

    return decrypted;
  });

  // Transcription readiness check (before recording starts)
  ipcMain.handle(IPC.TRANSCRIPTION_CHECK_READY, () => {
    const engine = (store.get('transcription.engine') as string) ?? 'local';
    let readyError: string | undefined;
    let errorType: 'missing-api-key' | 'model-not-downloaded' | 'no-internet' | undefined;
    if (engine === 'cloud') {
      if (!net.isOnline()) {
        readyError = 'No internet connection. Switch to local engine or check your connection.';
        errorType = 'no-internet';
      } else {
        const groqKey = getApiKey(store, 'transcription.groqApiKey');
        if (!groqKey) {
          readyError = 'Groq API key is not configured.';
          errorType = 'missing-api-key';
        }
      }
    } else {
      if (!transcriptionService.isModelDownloaded()) {
        readyError = 'Transcription model is not downloaded.';
        errorType = 'model-not-downloaded';
      }
    }
    if (readyError) {
      broadcastState('error');
      hotkeyService.notifyRecordingStopped();
      // Send error message to overlay so MaxiWidget can display it
      const overlay = getOverlayWindow();
      if (overlay) overlay.webContents.send(IPC.TRANSCRIPTION_ERROR, readyError);
      scheduleIdle(2500);
      return { ready: false, error: readyError, errorType };
    }
    return { ready: true };
  });

  // Transcription — receives raw audio buffer + sampleRate + recordingId from renderer.
  // compressedAudio: optional WebM/Opus blob from MediaRecorder (used for API upload — 8x smaller than WAV).
  ipcMain.handle(IPC.TRANSCRIPTION_START_BUFFER, async (event, audioBuffer: ArrayBuffer, sampleRate: number, recordingId?: string, compressedAudio?: ArrayBuffer) => {
    if (transcriptionInProgress) {
      event.sender.send(IPC.TRANSCRIPTION_ERROR, 'Transcription already in progress');
      return;
    }
    transcriptionInProgress = true;
    try {
    // Silence detection: skip transcription if audio is below speech threshold.
    // Prevents Whisper hallucinations like [muzyka], [music], [cisza] on silence.
    const samples = new Float32Array(audioBuffer);
    if (samples.length === 0) {
      log.warn('Empty audio buffer received — skipping transcription');
      const emptyMsg = 'Recording was empty — no audio captured. Try again.';
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.NOTIFICATION_ERROR, emptyMsg);
      }
      broadcastState('error');
      const overlay = getOverlayWindow();
      if (overlay) overlay.webContents.send(IPC.TRANSCRIPTION_ERROR, emptyMsg);
      scheduleIdle(2500);
      return;
    }
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    if (rms < 0.003) {
      log.info('Audio below speech threshold (RMS=%.4f) — skipping transcription', rms);
      const quietMsg = 'Audio too quiet — nothing to transcribe. Check your microphone.';
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.NOTIFICATION_ERROR, quietMsg);
      }
      broadcastState('error');
      const overlay = getOverlayWindow();
      if (overlay) overlay.webContents.send(IPC.TRANSCRIPTION_ERROR, quietMsg);
      scheduleIdle(2500);
      return;
    }

    broadcastState('transcribing');
    // Warmup AI connection in parallel with transcription (best-effort, fire-and-forget)
    aiService.warmup().catch((err) => { log.warn('AI warmup failed:', err); });
    try {
      // Adaptive timeout: max(30s, audioDuration * 3), capped at 120s
      const audioDurationSec = samples.length / sampleRate;
      const adaptiveTimeout = Math.min(
        TRANSCRIPTION_TIMEOUT_MAX_MS,
        Math.max(TRANSCRIPTION_TIMEOUT_MIN_MS, audioDurationSec * 3000),
      );

      let timeoutId: ReturnType<typeof setTimeout>;
      const rawText = await Promise.race([
        transcriptionService.transcribeFromBuffer(audioBuffer, sampleRate, compressedAudio).then((result) => {
          clearTimeout(timeoutId);
          return result;
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Transcription timed out after ${Math.round(adaptiveTimeout / 1000)}s`)), adaptiveTimeout);
        }),
      ]);

      // Safety net: filter known Whisper hallucinations that appear on near-silence audio
      const HALLUCINATION_RE = /^\s*[[(]?(muzyka|music|cisza|silence|szum|noise|applause|oklaski|śmiech|laughter)[\])]?\s*$/i;
      if (!rawText || HALLUCINATION_RE.test(rawText)) {
        log.info('Whisper returned empty or hallucinated text: "%s" — skipping', rawText ?? '');
        const noSpeechMsg = 'No speech detected — recording contained only silence or background noise.';
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.NOTIFICATION_ERROR, noSpeechMsg);
        }
        broadcastState('error');
        const overlay = getOverlayWindow();
        if (overlay) overlay.webContents.send(IPC.TRANSCRIPTION_ERROR, noSpeechMsg);
        scheduleIdle(2500);
        return;
      }

      broadcastState('processing');
      let text: string;
      try {
        let aiTimeoutId: ReturnType<typeof setTimeout>;
        text = await Promise.race([
          aiService.process(rawText).then((result) => {
            clearTimeout(aiTimeoutId);
            return result;
          }),
          new Promise<never>((_, reject) => {
            aiTimeoutId = setTimeout(() => reject(new Error('AI processing timed out')), AI_TIMEOUT_MS);
          }),
        ]);
      } catch (aiErr) {
        log.warn('AI processing failed, using raw text:', aiErr);
        text = rawText;
        const aiMsg = formatApiError(aiErr);
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.NOTIFICATION_ERROR, `AI processing failed: ${aiMsg} Using raw transcription.`);
        }
      }

      // Vocabulary find-and-replace — last step before output
      const vocabEntries = (store.get('vocabulary') as VocabularyEntry[]) ?? [];
      text = applyVocabularyReplacements(text, vocabEntries);

      // Capture the focused window FIRST — before any Electron UI operations
      // (broadcastState, clipboard, scheduleIdle) that may shift OS focus.
      const autoPaste = (store.get('dictation.autoPaste') as boolean) ?? true;
      if (autoPaste) {
        await pasteService.captureTarget();
      }
      const appName = pasteService.getAppName() ?? undefined;

      broadcastState('done');
      scheduleIdle(400);
      log.info('Transcription done. autoPaste=%s, chars=%d', autoPaste, text.length);

      // Always write to clipboard so the user can always Ctrl+V manually
      clipboard.writeText(text);
      log.info('Text copied to clipboard');

      if (autoPaste && pasteService.hasTarget()) {
        try {
          await pasteService.simulatePaste();
          // Re-write after paste so transcribed text stays in clipboard for manual use
          clipboard.writeText(text);
        } catch (pasteErr) {
          log.warn('Paste failed:', pasteErr);
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.NOTIFICATION_ERROR, 'Auto-paste failed — text is in your clipboard, use Ctrl+V.');
          }
        }
      } else if (autoPaste) {
        log.info('No paste target captured — text is in clipboard');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.NOTIFICATION_ERROR, 'Could not detect target window — text copied to clipboard, use Ctrl+V.');
        }
      }

      // Save to history — sanitize ID to prevent path traversal in downstream audio save
      const entryId = sanitizeId(recordingId ?? Date.now().toString());
      const durationSeconds = samples.length / sampleRate;
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
      };
      try {
        historyService.add(entry);
      } catch (dbErr) {
        log.error('Failed to save recording to history DB:', dbErr);
      }

      event.sender.send(IPC.TRANSCRIPTION_RESULT, { id: entryId, text, appName, durationSeconds });
    } catch (err) {
      const msg = formatApiError(err);
      broadcastState('error');
      scheduleIdle(1500);
      event.sender.send(IPC.TRANSCRIPTION_ERROR, msg);
    }
    } finally {
      transcriptionInProgress = false;
    }
  });

  // Save audio file sent from renderer (WebM blob)
  ipcMain.handle(IPC.AUDIO_SAVE, async (_event, id: string, audioBuffer: ArrayBuffer) => {
    const safeId = sanitizeId(id);
    const filePath = path.join(recordingsDir, `${safeId}.webm`);
    await fs.promises.writeFile(filePath, Buffer.from(audioBuffer));
    historyService.updateAudioPath(safeId, filePath);
    return filePath;
  });

  // History handlers
  ipcMain.handle(IPC.HISTORY_GET_STATS, () => {
    try {
      const data = historyService.getStats();
      return { success: true, data };
    } catch (err) {
      log.error('HISTORY_GET_STATS failed:', err);
      return { success: false, data: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_GET_COUNT, () => {
    try {
      const count = historyService.getCount();
      return { success: true, count };
    } catch (err) {
      log.error('HISTORY_GET_COUNT failed:', err);
      return { success: false, count: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_GET_ALL, (_event, limit?: number, offset?: number) => {
    try {
      const data = historyService.getAll(limit ?? 50, offset ?? 0);
      return { success: true, data };
    } catch (err) {
      log.error('HISTORY_GET_ALL failed:', err);
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
      log.error('HISTORY_DELETE failed:', err);
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
      log.error('HISTORY_SEARCH failed:', err);
      return { success: false, data: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.HISTORY_CLEAR_ALL, () => {
    try {
      const result = historyService.clearAll();
      return { success: true, ...result };
    } catch (err) {
      log.error('HISTORY_CLEAR_ALL failed:', err);
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
          log.warn('HISTORY_MIGRATE skipped invalid entry:', entryErr);
          skipped++;
        }
      }
      return { success: true, added, skipped };
    } catch (err) {
      log.error('HISTORY_MIGRATE failed:', err);
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

  // Update check
  ipcMain.handle(IPC.UPDATE_CHECK, () => updateService.checkForUpdates());
  ipcMain.handle(IPC.UPDATE_GET_INFO, () => updateService.getUpdateInfo());
  ipcMain.handle(IPC.UPDATE_INSTALL, () => updateService.quitAndInstall());

  // Groq key validation
  ipcMain.handle(IPC.GROQ_VALIDATE_KEY, async (_event, apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string') return { valid: false, error: 'No API key provided' };
    return TranscriptionService.validateGroqApiKey(apiKey);
  });

  // AI provider key validation (OpenAI / Anthropic)
  ipcMain.handle(IPC.AI_VALIDATE_KEY, async (_event, provider: string, apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string') return { valid: false, error: 'No API key provided' };
    if (provider === 'openai') return AIService.validateOpenAIKey(apiKey);
    if (provider === 'anthropic') return AIService.validateAnthropicKey(apiKey);
    return { valid: false, error: `Unknown provider: ${provider}` };
  });

  // Open external URL (whitelisted domains only)
  ipcMain.on(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    const allowed = ['console.groq.com', 'groq.com', 'github.com'];
    try {
      const hostname = new URL(url).hostname;
      if (allowed.some((d) => hostname === d || hostname.endsWith('.' + d))) {
        shell.openExternal(url);
      }
    } catch { /* ignore invalid URLs */ }
  });
}
