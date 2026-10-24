import { ipcMain, BrowserWindow, shell, clipboard, app, screen, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as Sentry from '@sentry/electron/main';
import logger from './services/logger';
import { IPC } from '../shared/constants';

const log = logger.scope('IPC');
import type { AppSettings, SettingsPatch, RecordingState, WidgetType, RecordingEntry, VocabularyEntry } from '../shared/types';
import { TranscriptionService } from './services/transcription.service';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { HotkeyService } from './services/hotkey.service';
import { HistoryService } from './services/history.service';
import { UpdateService } from './services/update.service';
import { encryptSettingsKeys, decryptSettingsForRenderer, getApiKey } from './services/secure-storage';
import Store from 'electron-store';
import { DEFAULT_SETTINGS } from '../shared/types';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
function sanitizeId(id: string): string {
  if (!id || !SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid recording ID: "${id}"`);
  }
  return id;
}

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

// CLI commands / paths shouldn't carry sentence punctuation that Whisper adds
// from intonation (e.g. "claude --dangerously-skip-permissions." breaks the command).
function looksLikeCliCommand(replacement: string): boolean {
  return (
    replacement.includes('--') ||
    replacement.includes(' -') ||
    replacement.includes('/') ||
    replacement.includes('\\') ||
    replacement.startsWith('$') ||
    replacement.startsWith('>')
  );
}

// Vocabulary input mini-syntax (documented on the Vocabulary page):
//   "a | b | c"   any of the alternatives triggers the replacement
//   "komit*"      trailing * matches any word ending; when the replacement also ends
//                 with *, the spoken ending is kept ("komit*" → "commit*": komita → commita)
//   spaces between words also match hyphens and repeated spaces ("cloud-dsp", "cloud  dsp")
interface VocabularyPattern {
  entry: VocabularyEntry;
  source: string;
  keepSuffix: boolean;
}

const VOCAB_WORD_CHAR = '[\\p{L}\\p{N}_]';

function buildVocabularyPatterns(vocabulary: VocabularyEntry[]): VocabularyPattern[] {
  const patterns: VocabularyPattern[] = [];
  for (const entry of vocabulary) {
    if (entry.replacement == null) continue;
    const cli = looksLikeCliCommand(entry.replacement);
    const replacementKeepsSuffix = entry.replacement.endsWith('*');

    for (const rawAlt of entry.input.split('|')) {
      const alt = rawAlt.trim();
      if (!alt) continue;
      const wildcard = alt.endsWith('*');
      const base = wildcard ? alt.slice(0, -1).trim() : alt;
      if (!base) continue;

      const escapedWords = base
        .split(/\s+/)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s-]+');
      // Lookarounds instead of \b: \b ignores non-ASCII letters (Polish) and never
      // matches next to inputs that start/end with symbols ("c++", "@claude").
      const boundaryStart = `(?<!${VOCAB_WORD_CHAR})`;
      const boundaryEnd = `(?!${VOCAB_WORD_CHAR})`;
      const suffix = wildcard ? '(\\p{L}*)' : '';
      // CLI commands shouldn't carry the sentence-final period Whisper adds from intonation,
      // but punctuation inside a sentence ("cloud dsp, a potem…") must survive.
      const trailing = cli ? '(?:[.!?](?=\\s*$))?' : '';

      patterns.push({
        entry,
        source: `${boundaryStart}${escapedWords}${suffix}${boundaryEnd}${trailing}`,
        keepSuffix: wildcard && replacementKeepsSuffix,
      });
    }
  }
  // Longest input first, so "cloud dsp" wins over "cloud" regardless of list order.
  return patterns.sort((a, b) => b.source.length - a.source.length);
}

// Mirrors Whisper's sentence-initial capital on plain-word replacements ("Komity" → "Commity"),
// never on identifiers that are deliberately lowercase (n8n, emails, CLI flags).
function matchCapitalization(matched: string, replacement: string): string {
  if (!/^\p{Lu}/u.test(matched)) return replacement;
  if (!/^\p{Ll}[\p{L}\s]*$/u.test(replacement)) return replacement;
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

// Single pass over the text with one combined regex: each position is visited once,
// so replacements never chain (A→B, B→C). Returns the applied entries for logging.
function applyVocabularyReplacements(text: string, vocabulary: VocabularyEntry[]): string {
  if (!vocabulary || vocabulary.length === 0) return text;
  const patterns = buildVocabularyPatterns(vocabulary);
  if (patterns.length === 0) return text;

  // Each alternative gets its own named group (m<i>) and, for wildcards, a suffix group (s<i>)
  // — the only way to learn which alternative fired inside a combined alternation.
  const source = patterns
    .map((p, i) => `(?<m${i}>${p.source.replace('(\\p{L}*)', `(?<s${i}>\\p{L}*)`)})`)
    .join('|');
  const combined = new RegExp(source, 'giu');

  const applied = new Map<string, number>();
  const result = text.replace(combined, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    const matched = args[0] as string;
    const index = patterns.findIndex((_, i) => groups[`m${i}`] !== undefined);
    if (index === -1) return matched;

    const { entry, keepSuffix } = patterns[index];
    let replacement = entry.replacement as string;
    if (replacement.endsWith('*')) replacement = replacement.slice(0, -1);
    if (keepSuffix) replacement += groups[`s${index}`] ?? '';

    const key = `"${entry.input}" → "${entry.replacement}"`;
    applied.set(key, (applied.get(key) ?? 0) + 1);
    return matchCapitalization(matched, replacement);
  });

  if (applied.size > 0) {
    const summary = [...applied.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
    log.info('Vocabulary: %d replacement(s) applied: %s', [...applied.values()].reduce((a, b) => a + b, 0), summary);
  }
  return result;
}

export function getOverlaySize(widget: WidgetType): [number, number] {
  if (widget === 'maxi') return [520, 170];
  return [210, 62];
}

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

function expectObject(name: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid value for "${name}": expected object`);
  }
}

function expectArray(name: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid value for "${name}": expected array`);
  }
}

async function wrapHandler<T extends object>(
  name: string,
  fn: () => Promise<T> | T,
  errorFallback: Record<string, unknown> = {},
) {
  try {
    return { success: true as const, ...(await fn()) };
  } catch (err) {
    log.error(`${name} failed:`, err);
    return {
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
      ...errorFallback,
    };
  }
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
  getCurrentState: () => RecordingState,
  updateService: UpdateService,
  onAutoStartChanged: (enabled: boolean) => void,
  onAudioCuesChanged: (enabled: boolean) => void,
): void {
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });

  let transcriptionInProgress = false;

  // How long the widgets show the paste confirmation before the state returns to idle
  const DONE_STATE_MS = 1500;

  // Deduplicated idle-transition timeout — prevents stale setTimeout callbacks
  // from resetting state after a new recording has already started
  let idleTransitionTimeout: ReturnType<typeof setTimeout> | null = null;
  function scheduleIdle(delay: number): void {
    if (idleTransitionTimeout) clearTimeout(idleTransitionTimeout);
    idleTransitionTimeout = setTimeout(() => {
      idleTransitionTimeout = null;
      // Armed only from 'error'/'done'. If the state moved on before firing (e.g. a
      // new recording started inside the delay window), broadcasting 'idle' now would
      // hide the widget mid-session while the mic keeps recording.
      const state = getCurrentState();
      if (state !== 'error' && state !== 'done') {
        log.warn('stale idle timer skipped (state=%s)', state);
        return;
      }
      broadcastState('idle');
    }, delay);
  }

  ipcMain.handle(IPC.SETTINGS_GET, () => {
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

    const shortcuts = (hotkey?.shortcuts ?? {}) as Record<string, unknown>;
    if (hotkey?.shortcuts && !shortcuts.showWindow) {
      store.set('hotkey.shortcuts.showWindow', DEFAULT_SETTINGS.hotkey.shortcuts.showWindow);
    }
    if (hotkey?.shortcuts && !shortcuts.pushToTalk) {
      store.set('hotkey.shortcuts.pushToTalk', DEFAULT_SETTINGS.hotkey.shortcuts.pushToTalk);
    }

    const dictation = store.get('dictation') as Record<string, unknown>;
    if (dictation && ('modePrompts' in dictation || 'currentMode' in dictation)) {
      const migrated = {
        aiPostProcessing: dictation.aiPostProcessing ?? DEFAULT_SETTINGS.dictation.aiPostProcessing,
        customPrompt: dictation.customPrompt ?? DEFAULT_SETTINGS.dictation.customPrompt,
        savedPrompts: dictation.savedPrompts ?? DEFAULT_SETTINGS.dictation.savedPrompts,
        selectedPromptId: dictation.selectedPromptId ?? DEFAULT_SETTINGS.dictation.selectedPromptId,
        autoPaste: dictation.autoPaste ?? DEFAULT_SETTINGS.dictation.autoPaste,
        restoreClipboard: dictation.restoreClipboard ?? DEFAULT_SETTINGS.dictation.restoreClipboard,
      };
      store.set('dictation', migrated);
    }

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

  ipcMain.handle(IPC.SETTINGS_SET, (_event, settings: SettingsPatch) => {
    const ALLOWED_KEYS = new Set<string>([
      'transcription', 'ai', 'hotkey', 'dictation', 'audio', 'vocabulary', 'widget', 'general',
    ]);

    for (const key of Object.keys(settings)) {
      if (!ALLOWED_KEYS.has(key)) {
        throw new Error(`Unknown settings key: "${key}"`);
      }
    }

    if (settings.transcription !== undefined) expectObject('transcription', settings.transcription);
    if (settings.ai !== undefined) expectObject('ai', settings.ai);
    if (settings.hotkey !== undefined) expectObject('hotkey', settings.hotkey);
    if (settings.dictation !== undefined) expectObject('dictation', settings.dictation);
    if (settings.dictation?.savedPrompts !== undefined) {
      expectArray('savedPrompts', settings.dictation.savedPrompts);
      if (settings.dictation.savedPrompts.length > 5) {
        throw new Error('Saved prompts limit exceeded: maximum 5 prompts');
      }
      for (const prompt of settings.dictation.savedPrompts) {
        if (typeof prompt !== 'object' || prompt === null) {
          throw new Error('Invalid saved prompt: expected object');
        }
        if (typeof prompt.id !== 'string' || typeof prompt.name !== 'string' || typeof prompt.content !== 'string') {
          throw new Error('Invalid saved prompt: "id", "name", and "content" must be strings');
        }
        if (!prompt.name.trim()) {
          throw new Error('Invalid saved prompt: "name" cannot be empty');
        }
        if (prompt.content.length > 4000) {
          throw new Error('Invalid saved prompt: "content" exceeds 4000 characters');
        }
      }
    }
    if (settings.dictation?.customPrompt !== undefined) {
      if (typeof settings.dictation.customPrompt !== 'string') {
        throw new Error('Invalid value for "customPrompt": expected string');
      }
      if (settings.dictation.customPrompt.length > 4000) {
        throw new Error('Custom prompt exceeds 4000 characters');
      }
    }
    if (settings.vocabulary !== undefined) {
      expectArray('vocabulary', settings.vocabulary);
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
    if (settings.widget !== undefined) expectObject('widget', settings.widget);
    if (settings.general !== undefined) expectObject('general', settings.general);
    if (settings.audio !== undefined) expectObject('audio', settings.audio);

    encryptSettingsKeys(settings);
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        store.set(key, { ...(store.get(key) as object), ...value });
      } else {
        store.set(key, value);
      }
    }
    const decrypted = decryptSettingsForRenderer(store.store);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.SETTINGS_ON_CHANGE, decrypted);
    }

    if (settings.hotkey) {
      const hotkey = store.get('hotkey');
      hotkeyService.updateShortcuts(hotkey.shortcuts);
      hotkeyService.setMode(hotkey.mode);
    }

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

    if (settings.general?.autoStart !== undefined) {
      onAutoStartChanged(store.get('general.autoStart') as boolean);
    }

    if (settings.audio?.soundEnabled !== undefined) {
      onAudioCuesChanged(store.get('audio.soundEnabled') as boolean);
    }

    return decrypted;
  });

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

  ipcMain.handle(IPC.TRANSCRIPTION_START_BUFFER, async (event, audioBuffer: ArrayBuffer, sampleRate: number, recordingId?: string, compressedAudio?: ArrayBuffer) => {
    if (transcriptionInProgress) {
      event.sender.send(IPC.TRANSCRIPTION_ERROR, 'Transcription already in progress');
      return;
    }
    transcriptionInProgress = true;

    const engine = (store.get('transcription.engine') as string) ?? 'local';
    const language = (store.get('transcription.language') as string) ?? 'auto';
    const aiEnabled = (store.get('dictation.aiPostProcessing') as boolean) ?? true;
    const aiProvider = (store.get('ai.provider') as string) ?? 'openai';
    Sentry.setTag('transcription.engine', engine);
    Sentry.setTag('transcription.language', language);
    Sentry.setTag('ai.enabled', String(aiEnabled));
    Sentry.setTag('ai.provider', aiEnabled ? aiProvider : 'none');

    try {
    // Silence detection: skip transcription if audio is below speech threshold.
    // Prevents Whisper hallucinations like [muzyka], [music], [cisza] on silence.
    const samples = new Float32Array(audioBuffer);
    if (samples.length === 0) {
      log.warn('Empty audio buffer received — skipping transcription');
      const emptyMsg = 'Recording was empty. No audio captured, try again.';
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
      const quietMsg = 'Audio too quiet, nothing to transcribe. Check your microphone.';
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

      // Safety net: filter known Whisper hallucinations that appear on near-silence audio.
      // Single-word tags and the subtitle-credit phrases Whisper emits on noise-only recordings
      // (seen as the entire transcript in history, e.g. "Wszelkie prawa zastrzeżone.").
      const HALLUCINATION_RE = /^\s*[[(]?(muzyka|music|cisza|silence|szum|noise|applause|oklaski|śmiech|laughter)[\])]?\s*$/i;
      const CREDITS_RE = /^\s*(wsz(elkie|ystkie) prawa zastrzeżone|napisy stworzone przez społeczność amara\.org|dzięku(ję|jemy) za (oglądanie|uwagę)|zdjęcia i montaż|thanks? (you )?for watching|subtitles by the amara\.org community)[.!]?\s*$/i;
      if (!rawText || HALLUCINATION_RE.test(rawText) || CREDITS_RE.test(rawText)) {
        log.info('Whisper returned empty or hallucinated text: "%s" — skipping', rawText ?? '');
        const noSpeechMsg = 'No speech detected. The recording contained only silence or background noise.';
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
      // Vocabulary runs before AI so the model sees the intended spellings instead of
      // "correcting" the trigger phrase; a second pass only if the model rewrote the text.
      const vocabEntries = (store.get('vocabulary') as VocabularyEntry[]) ?? [];
      const vocabText = applyVocabularyReplacements(rawText, vocabEntries);
      let text: string;
      try {
        let aiTimeoutId: ReturnType<typeof setTimeout>;
        text = await Promise.race([
          aiService.process(vocabText).then((result) => {
            clearTimeout(aiTimeoutId);
            return result;
          }),
          new Promise<never>((_, reject) => {
            aiTimeoutId = setTimeout(() => reject(new Error('AI processing timed out')), AI_TIMEOUT_MS);
          }),
        ]);
      } catch (aiErr) {
        log.warn('AI processing failed, using raw text:', aiErr);
        text = vocabText;
        const aiMsg = formatApiError(aiErr);
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.NOTIFICATION_ERROR, `AI processing failed: ${aiMsg} Using raw transcription.`);
        }
      }
      if (text !== vocabText) {
        text = applyVocabularyReplacements(text, vocabEntries);
      }

      // Capture the focused window FIRST — before any Electron UI operations
      // (broadcastState, clipboard, scheduleIdle) that may shift OS focus.
      const autoPaste = (store.get('dictation.autoPaste') as boolean) ?? true;
      if (autoPaste) {
        await pasteService.captureTarget();
      }
      const appName = pasteService.getAppName() ?? undefined;

      broadcastState('done');
      scheduleIdle(DONE_STATE_MS);
      // words/s of the raw transcript vs audio length: normal dictation lands around 1.6–2.0,
      // a value well below ~1.3 on a long recording means Whisper dropped part of the speech.
      const rawWords = rawText.trim().split(/\s+/).filter(Boolean).length;
      log.info(
        'Transcription done. autoPaste=%s, chars=%d, audio=%ss, rawWords=%d, wps=%s',
        autoPaste, text.length, audioDurationSec.toFixed(1), rawWords, (rawWords / audioDurationSec).toFixed(2),
      );

      clipboard.writeText(text);

      if (autoPaste && pasteService.hasTarget()) {
        try {
          await pasteService.simulatePaste();
        } catch (pasteErr) {
          log.warn('Paste failed:', pasteErr);
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.NOTIFICATION_ERROR, 'Auto-paste failed. Text is in your clipboard, use Ctrl+V.');
          }
        }
      } else if (autoPaste) {
        log.info('No paste target captured — text is in clipboard');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.NOTIFICATION_ERROR, 'Could not detect the target window. Text copied to clipboard, use Ctrl+V.');
        }
      }

      const entryId = sanitizeId(recordingId ?? Date.now().toString());
      const durationSeconds = samples.length / sampleRate;
      const countWordsInline = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
      const wordCount = countWordsInline(text);
      const rawWordCount = countWordsInline(rawText);
      const entry: RecordingEntry = {
        id: entryId,
        date: new Date().toISOString(),
        text,
        rawText,
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

  ipcMain.handle(IPC.AUDIO_SAVE, async (_event, id: string, audioBuffer: ArrayBuffer) => {
    const safeId = sanitizeId(id);
    const filePath = path.join(recordingsDir, `${safeId}.webm`);
    await fs.promises.writeFile(filePath, Buffer.from(audioBuffer));
    historyService.updateAudioPath(safeId, filePath);
    return filePath;
  });

  ipcMain.handle(IPC.HISTORY_GET_STATS, () =>
    wrapHandler('HISTORY_GET_STATS', () => ({ data: historyService.getStats() }), { data: null }),
  );

  ipcMain.handle(IPC.HISTORY_GET_COUNT, () =>
    wrapHandler('HISTORY_GET_COUNT', () => ({ count: historyService.getCount() }), { count: 0 }),
  );

  ipcMain.handle(IPC.HISTORY_GET_ALL, (_event, limit?: number, offset?: number) =>
    wrapHandler('HISTORY_GET_ALL', () => ({ data: historyService.getAll(limit ?? 50, offset ?? 0) }), { data: [] }),
  );

  ipcMain.handle(IPC.HISTORY_DELETE, (_event, id: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: 'Invalid recording ID' };
    }
    return wrapHandler('HISTORY_DELETE', () => historyService.delete(id));
  });

  ipcMain.handle(IPC.HISTORY_SEARCH, (_event, query: string) =>
    wrapHandler(
      'HISTORY_SEARCH',
      () => ({ data: typeof query === 'string' ? historyService.search(query) : historyService.getAll() }),
      { data: [] },
    ),
  );

  ipcMain.handle(IPC.HISTORY_CLEAR_ALL, () =>
    wrapHandler('HISTORY_CLEAR_ALL', () => historyService.clearAll()),
  );

  ipcMain.handle(IPC.HISTORY_MIGRATE, (_event, entries: unknown) => {
    if (!Array.isArray(entries)) {
      return { success: false, error: 'Expected an array of entries' };
    }
    return wrapHandler('HISTORY_MIGRATE', () => {
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
      return { added, skipped };
    });
  });

  ipcMain.handle(IPC.AI_GET_OPENAI_MODELS, () =>
    wrapHandler('AI_GET_OPENAI_MODELS', async () => ({ models: await aiService.getOpenAIModels() }), { models: [] }),
  );

  ipcMain.handle(IPC.AI_ENHANCE_PROMPT, (_event, rawPrompt: string) =>
    wrapHandler('AI_ENHANCE_PROMPT', async () => ({ result: await aiService.enhancePrompt(rawPrompt) })),
  );

  ipcMain.handle(IPC.AI_GENERATE_PROMPT_NAME, (_event, promptContent: string) =>
    wrapHandler('AI_GENERATE_PROMPT_NAME', async () => ({ name: await aiService.generatePromptName(promptContent) })),
  );

  ipcMain.on(IPC.APP_OPEN_MODELS_FOLDER, () => {
    shell.openPath(transcriptionService.getModelsCacheDir());
  });

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

  ipcMain.handle(IPC.UPDATE_CHECK, () => updateService.checkForUpdates(true));
  ipcMain.handle(IPC.UPDATE_GET_INFO, () => updateService.getUpdateInfo());
  ipcMain.handle(IPC.UPDATE_INSTALL, () => updateService.quitAndInstall());

  ipcMain.handle(IPC.GROQ_VALIDATE_KEY, async (_event, apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string') return { valid: false, error: 'No API key provided' };
    return TranscriptionService.validateGroqApiKey(apiKey);
  });

  ipcMain.handle(IPC.AI_VALIDATE_KEY, async (_event, provider: string, apiKey: string) => {
    if (!apiKey || typeof apiKey !== 'string') return { valid: false, error: 'No API key provided' };
    if (provider === 'openai') return AIService.validateOpenAIKey(apiKey);
    if (provider === 'anthropic') return AIService.validateAnthropicKey(apiKey);
    return { valid: false, error: `Unknown provider: ${provider}` };
  });

  ipcMain.on(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('ms-settings:')) {
      shell.openExternal(url);
      return;
    }
    const allowed = ['console.groq.com', 'groq.com', 'github.com'];
    try {
      const hostname = new URL(url).hostname;
      if (allowed.some((d) => hostname === d || hostname.endsWith('.' + d))) {
        shell.openExternal(url);
      }
    } catch (err) { logger.warn('SHELL_OPEN_EXTERNAL: invalid URL "%s":', url, err); }
  });
}
