# Audit Fixes 2026-11-13 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the "Dziękuję." tail on recordings just over 30 s, cut ~250 ms of fixed latency per paste, stop rejecting real short commands, make the MediaRecorder fallback fire only on real stalls, make the transcription timeout actually abort the request, validate enum settings, and clear the 13 real type errors.

**Architecture:** Decision logic stays in the pure modules (`transcript-filter.ts`, `vocabulary.ts`); `ipc-handlers.ts`, `transcription.service.ts`, `paste.service.ts` and `useAudioRecorder.ts` get minimal call-site edits. One new shared list module for enum values (`src/shared/constants.ts`) so renderer and main validate against the same source. No IPC channel or schema changes.

**Tech Stack:** Electron 40, TypeScript 4.5 (type-check with `npx -y -p typescript@5.9.3 tsc --noEmit`), openai SDK (request options `{ signal }`), electron-log, PowerShell interop in `paste.service.ts`.

**Spec:** Audit report delivered in chat on 2026-11-13 (three agents: logs + DB, pipeline, code quality); numbers recorded in `C:\Users\Kuba\.claude\projects\C--Users-Kuba-The-Dictator\memory\hallucination_investigation.md` and `code_audit_2026_11_13.md`.

## Global Constraints

- Branch `fix/audit-2026-11-13` created from `develop` (clean tree at `b71c091`); no worktree needed.
- No comments in new or changed code (owner's rule); explain decisions in chat.
- No automated tests, POMs or mocks (owner's rule). Verification = type-check, lint, `npm run build`, scratchpad probe scripts for the pure functions, and a manual QA checklist handed to the owner.
- No commits by the agent; the owner picks commit messages (A/B/C options) at the end.
- Renderer never uses `require`; IPC channel names only from `src/shared/constants.ts`.
- electron-log placeholders: only `%s %d %i %f %o %O %j`.
- Type-check baseline on `b71c091`: 13 real errors (Task 6 removes them; ignore `does not exist on type 'ElectronStore'`). ESLint baseline: 0 problems.
- Owner's live config to keep working: engine cloud/Groq, language `pl`, AI off, toggle hotkey, QC35 II via HFP, `callMode` on, autoPaste on.
- Thresholds from the data: Whisper window 30 s; tail appears when trailing silence ≥ 1.0 s after > 30 s of audio; real short commands have avgLogprob down to -0.744 ("commit") and -0.700 ("Cloud Skip"); justified rejections were all ≤ -0.78; worklet starts 0.4–1.1 s after `recordingStartTime`.

## Review Focus

1. A 31 s recording where speech ends at 15 s must reach Groq as a trimmed WAV (~15.4 s), not WebM → Task 1 probe asserts `hasEmptyTailWindow` is true for `durationSeconds: 31, trailingSilenceSeconds: 16`.
2. A 45 s recording with speech until 44.5 s must keep the fast WebM path → Task 1 probe asserts false for `trailingSilenceSeconds: 0.5`.
3. "commit" with avgLogprob -0.744 and "Cloud Skip" with -0.700 must pass; "Dzień dobry." with speech 0.2 s must still be rejected by the greeting gate; a 6-word garbage transcript at -0.852 must still be rejected → Task 3 probe.
4. Paste into a window that is already foreground must send Ctrl+V without the 250 ms sleep; paste into a background window must still bring it forward and verify → Task 2 manual QA (foreground app, then Alt-Tab during transcription).
5. A Groq request that exceeds the adaptive timeout must be aborted (no late paste, no second request from `withRetry`) → Task 5 manual QA with network cut mid-upload.

---

### Task 1: Trimmed WAV instead of WebM when the second Whisper window would be silent

**Files:**
- Modify: `src/main/services/transcript-filter.ts:1-7, 21-27, 62-94`
- Modify: `src/main/ipc-handlers.ts:519-535, 620-631`
- Modify: `src/main/services/transcription.service.ts:289-312` (type only, see Task 6)

**Interfaces:**
- Produces: `SpeechMetrics.trailingSilenceSeconds: number` (seconds from the last speech frame to the end of the buffer; equals `durationSeconds` when no speech frame exists).
- Produces: `export const WHISPER_WINDOW_SECONDS = 30`, `export const EMPTY_TAIL_WINDOW_SILENCE_SECONDS = 1.0`.
- Produces: `export function hasEmptyTailWindow(metrics: Pick<SpeechMetrics, 'durationSeconds' | 'trailingSilenceSeconds'>): boolean` → `durationSeconds > WHISPER_WINDOW_SECONDS && trailingSilenceSeconds >= EMPTY_TAIL_WINDOW_SILENCE_SECONDS`.

- [ ] **Step 1: Extend `measureSpeech`** — track the end index of the last speech frame (`lastSpeechEnd = end` whenever a frame counts as speech); return `trailingSilenceSeconds: (samples.length - lastSpeechEnd) / sampleRate`.
- [ ] **Step 2: Add the two constants and `hasEmptyTailWindow`** next to `isLowConfidence`.
- [ ] **Step 3: In `transcribeBuffer`** compute `const emptyTailWindow = hasEmptyTailWindow(metrics)` after `metrics`; when `emptyTailWindow && compressedAudio` log once at info: `'Trailing silence %ss after %ss of audio (id=%s) — sending trimmed WAV instead of WebM'`; call `transcribeFromBuffer(audioBuffer, sampleRate, emptyTailWindow ? undefined : compressedAudio)`.
- [ ] **Step 4: Add `trailingSilence=%ss` to the "Transcription done" log line** (after `longestRun`).
- [ ] **Step 5: Probe** — scratchpad script imports the built filter via `node --experimental-strip-types` or a tiny `tsc` transpile; asserts Review Focus 1 and 2 plus `measureSpeech` on a synthetic buffer (1 s tone + 2 s zeros at 16 kHz → `trailingSilenceSeconds` ≈ 2.0 ± 0.05).
- [ ] **Step 6: Type-check + lint**, expected: no new errors.

### Task 2: Conditional focus wait in the paste command

**Files:**
- Modify: `src/main/services/paste.service.ts:45-53` (`buildPasteCmd`)

- [ ] **Step 1: Rewrite `focus`** so the attach/show/SetForegroundWindow block and the wait run only when `[PW]::GetForegroundWindow().ToInt64() -ne $t.ToInt64()`; replace `Start-Sleep -Milliseconds 250` with a poll: `$i=0; while($i -lt 25 -and [PW]::GetForegroundWindow().ToInt64() -ne $t.ToInt64()){ Start-Sleep -Milliseconds 10; $i++ }`.
- [ ] **Step 2: Keep `verify` and `[PW]::Paste(); Write-Output PASTE_OK` unchanged.**
- [ ] **Step 3: Update the comment block above `buildPasteCmd`** only if it now states something false (it describes the re-check; the sleep is not mentioned, so likely no change).
- [ ] **Step 4: Lint + type-check.** Manual QA: Review Focus 4; also paste into a minimized Notepad (must restore + paste).

### Task 3: Retune the confidence gate, bypass it on vocabulary hits, drop `isShortLowConfidence`

**Files:**
- Modify: `src/main/services/transcript-filter.ts:24-27, 52-60`
- Modify: `src/main/ipc-handlers.ts:17-21, 537-557, 586-591`

**Interfaces:**
- Produces: `export const LOW_CONFIDENCE_LOGPROB = -0.8`, `export const SHORT_COMMAND_MAX_WORDS = 2`, `export const SHORT_COMMAND_LOGPROB = -0.9`.
- Produces: `export function countWords(text: string): number`.
- Changes: `isLowConfidence(text: string, avgLogprob: number | null): boolean` → threshold is `SHORT_COMMAND_LOGPROB` when `countWords(text) <= SHORT_COMMAND_MAX_WORDS`, else `LOW_CONFIDENCE_LOGPROB`.
- Removes: `isShortLowConfidence`, `SHORT_TRANSCRIPT_MAX_WORDS`, `SHORT_TRANSCRIPT_MIN_SPEECH_RUN_SECONDS`, `SHORT_TRANSCRIPT_LOGPROB`. `longestSpeechRunSeconds` stays in metrics and logs.

- [ ] **Step 1: Edit constants and `isLowConfidence`; add `countWords`; delete `isShortLowConfidence`.** Use `countWords` in `stripTrailingCredits` (replaces the inline split).
- [ ] **Step 2: In `transcribeBuffer`** move `const vocabEntries = ...` above the gate; compute `const vocabularyHit = selectTriggeredEntries(rawText, vocabEntries).length > 0`; gate becomes `const lowConfidence = !!rawText && !vocabularyHit && isLowConfidence(rawText, avgLogprob)`; log message `'Low-confidence transcript rejected (...)'` unchanged apart from dropping the reason prefix variable. When `vocabularyHit && isLowConfidence(...)` log at info: `'Low-confidence transcript kept — vocabulary hit (id=%s avgLogprob=%s): "%s"'`.
- [ ] **Step 3: Replace the two inline word counts** (`rawWords`, `countWordsInline`) with `countWords`.
- [ ] **Step 4: Probe** — Review Focus 3 plus: `isLowConfidence('Kontynuuj.', -0.504)` false; `isLowConfidence('Już się zbłączony, Pałpa.', -0.782)` true (5 words → -0.8 threshold); `isCreditsOnly('Dzień dobry.')` true.
- [ ] **Step 5: Type-check + lint.**

### Task 4: PCM coverage measured from the moment the worklet is wired

**Files:**
- Modify: `src/renderer/hooks/useAudioRecorder.ts:216-232, 694-698, 760-765, 828-831`

**Interfaces:**
- Produces: `const wiredAtRef = useRef<number | null>(null)` (wall-clock ms when `pipeline wired` was logged; reset to `null` in `teardownRecording` and after use in `stopRecording`).

- [ ] **Step 1: Set `wiredAtRef.current = Date.now()`** right after `recLog.info('pipeline wired', ...)`.
- [ ] **Step 2: In `stopRecording`** compute `const expectedMs = wiredAtRef.current !== null ? Date.now() - wiredAtRef.current : elapsedMs` before the 300 ms tail (i.e. at the same place `elapsedMs` is computed), then `wiredAtRef.current = null`; `pcmTooShort` uses `expectedMs` instead of `elapsedMs`; the fallback warn line reports both: `` `worklet pcm=${pcmSeconds.toFixed(1)}s covers <80% of ${(expectedMs / 1000).toFixed(1)}s since wiring` `` and keeps `elapsed=`.
- [ ] **Step 3: Reset `wiredAtRef` in `teardownRecording`.**
- [ ] **Step 4: Lint + type-check.** Manual QA: 2 s command on QC35 → no `using MediaRecorder capture` warn in `main.log`; `pcmTooShort` still true when the context is stalled (cannot be forced manually; the `pipeline stalled` watchdog remains the evidence path).

### Task 5: Abortable transcription timeout and enum validation in `SETTINGS_SET`

**Files:**
- Modify: `src/main/services/transcription.service.ts:36-53, 289-368`
- Modify: `src/main/ipc-handlers.ts:519-535, 115-125, 269-377`
- Modify: `src/shared/constants.ts` (append)

**Interfaces:**
- Changes: `transcribeFromBuffer(audioBuffer, sampleRate, compressedAudio?, signal?: AbortSignal)`; both Groq methods accept `signal` and pass `{ signal }` as the second argument of `client.audio.transcriptions.create(params, { signal })`. `withRetry` in this file gets `if (signal?.aborted) throw err;` before the status check (signature `withRetry(fn, signal?, maxAttempts = 2, delayMs = 1000)`).
- Produces in `src/shared/constants.ts`: `export const TRANSCRIPTION_ENGINES = ['local', 'cloud'] as const;`, `export const AI_PROVIDERS = ['openai', 'anthropic'] as const;`, `export const WIDGET_TYPES = ['voicebar', 'maxi'] as const;`, `export const OVERLAY_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const;`, `export const HOTKEY_MODES = ['toggle', 'push-to-talk'] as const;`.
- Produces in `ipc-handlers.ts`: `function expectOneOf(name: string, value: unknown, allowed: readonly string[]): void`, `function expectBoolean(name: string, value: unknown): void`, `function expectString(name: string, value: unknown, maxLength: number): void`.

- [ ] **Step 1: Timeout** — in `transcribeBuffer` replace the `Promise.race` with `const abort = new AbortController(); const timeoutId = setTimeout(() => abort.abort(), adaptiveTimeout);` then `try { result = await transcriptionService.transcribeFromBuffer(audioBuffer, sampleRate, compressed, abort.signal); } finally { clearTimeout(timeoutId); }`; when `abort.signal.aborted` and the call threw, rethrow as `new Error(\`Transcription timed out after ${Math.round(adaptiveTimeout / 1000)}s\`)` so the user-facing message is unchanged.
- [ ] **Step 2: Service** — thread `signal` through `transcribeFromBuffer`, `transcribeGroqFromBuffer`, `transcribeGroqFromCompressed`; local path ignores it.
- [ ] **Step 3: Validation** — add the three helpers next to `expectObject`; in `SETTINGS_SET` validate: `transcription.engine` ∈ `TRANSCRIPTION_ENGINES`; `transcription.localModelSize`, `transcription.language`, `transcription.preferredCloudLanguage`, `ai.openaiModel`, `ai.anthropicModel`, `dictation.selectedPromptId`, `audio.deviceLabel` → `expectString(…, 100)`; `ai.provider` ∈ `AI_PROVIDERS`; `widget.activeWidget` ∈ `WIDGET_TYPES`; `general.overlayPosition` ∈ `OVERLAY_POSITIONS`; `hotkey.mode` ∈ `HOTKEY_MODES` (replaces the inline check); booleans `dictation.aiPostProcessing`, `dictation.autoPaste`, `audio.soundEnabled`, `audio.callMode`, `audio.muteOthersWhileRecording`, `general.autoStart`, `general.minimizeToTray`, `general.firstRunComplete`, `general.widgetTooltipShown` → `expectBoolean`. API key fields are strings already handled by `encryptSettingsKeys`; add `expectString(…, 500)` for `transcription.groqApiKey`, `ai.openaiApiKey`, `ai.anthropicApiKey`.
- [ ] **Step 4: Use the shared lists in the renderer** where the literal unions are duplicated as option arrays only if such arrays exist (grep `'voicebar'`, `'anthropic'`, `'top-right'` in `src/renderer`); otherwise leave the renderer alone.
- [ ] **Step 5: Type-check + lint + `npm run build`.** Manual QA: Review Focus 5; DevTools `window.dictator.setSettings({ transcription: { engine: 'foo' } })` rejects and persists nothing.

### Task 6: Type errors, `rcedit`, one Whisper model table

**Files:**
- Modify: `src/renderer/components/HomePage.tsx:89-90`
- Modify: `src/main/services/transcription.service.ts:72-79, 289-312, 513-516`
- Modify: `src/main/ipc-handlers.ts:745-752`
- Create: `src/renderer/assets.d.ts`; Modify: `src/renderer/global.d.ts:9-12`
- Modify: `src/renderer/components/OnboardingWizard.tsx:103-109, 313`
- Modify: `src/renderer/components/ModesPage.tsx:14-20`
- Modify: `src/shared/constants.ts:74-83`
- Modify (decision pending): `package.json`, `scripts/patch-electron-icon.js`, `CLAUDE.md`

**Interfaces:**
- Produces: `export const WHISPER_MODELS: readonly { value: string; label: string; size: string; description: string }[]` in `src/shared/constants.ts`, replacing `WHISPER_MODEL_DESCRIPTIONS` for the five UI models (`tiny 150 MB`, `base 280 MB`, `small ~1 GB`, `medium 1.5 GB`, `large-v3 3.1 GB`; tiny/base measured on disk in `%APPDATA%\The Dictator\models`, others from parameter count × fp32/fp16). Keep `WHISPER_MODEL_DESCRIPTIONS` only if something else reads it (grep); otherwise delete.
- Produces: `type AudioBytes = ArrayBuffer | Buffer` (module-local in `transcription.service.ts`) used by `transcribeFromBuffer`, both Groq methods, `transcribeLocalFromBuffer`, `ipcBufferToFloat32`.

- [ ] **Step 1: HomePage** — `useState<string | null>(null)`, `useRef<string | null>(null)`.
- [ ] **Step 2: dtype** — `const QUANTIZED_DTYPE = { encoder_model: 'fp16', decoder_model_merged: 'fp16' } as const;` and `getDtypeForModel(...): typeof QUANTIZED_DTYPE | undefined`.
- [ ] **Step 3: AudioBytes** — apply the alias; narrow with `if (engine === 'cloud' && compressedAudio && compressedSize > 0)`.
- [ ] **Step 4: HISTORY_MIGRATE** — build the entry explicitly: require `typeof e.id === 'string' && typeof e.date === 'string' && typeof e.text === 'string'`, else throw (counted as `skipped`); numbers default as today; `rawText` defaults to `text`.
- [ ] **Step 5: PNG module** — move `declare module '*.png'` into new `src/renderer/assets.d.ts` (no imports in that file); `global.d.ts` keeps only the `Window` augmentation.
- [ ] **Step 6: Uint8Array** — `new Uint8Array(new ArrayBuffer(analyser.fftSize))`.
- [ ] **Step 7: Model table** — `WHISPER_MODELS` in constants; `ModesPage` and `OnboardingWizard` map it (`OnboardingWizard` uses `description` as its `text`); `OnboardingWizard` initial `engine` = `DEFAULT_SETTINGS.transcription.engine`.
- [ ] **Step 8: rcedit** — owner's choice: (A) `npm install -D rcedit` then `npm run rebuild`, keep the script, log the skip in the `catch`; (B) delete `scripts/patch-electron-icon.js`, the `postinstall` entry and the CLAUDE.md sentence about it.
- [ ] **Step 9: Type-check** expected: 0 real errors; **lint** 0; **`npm run build`** succeeds.

### Manual QA checklist (owner)

1. Dictate ~32 s with speech ending around 15 s → `main.log` shows the "sending trimmed WAV" line, text has no trailing "Dziękuję.".
2. Dictate 40 s continuous → no WAV line (WebM path), text complete.
3. Say "commit" alone, "Cloud Skip", "Kontynuuj" → all pasted; log shows no rejection.
4. Hotkey in Notepad, keep it foreground → paste lands; Alt-Tab to another window during transcription → paste lands in the new foreground window (behaviour unchanged) and the log shows `Pasted successfully`.
5. Minimize Notepad after pressing the hotkey → window restores and paste lands.
6. Short 2 s command on QC35 → no `using MediaRecorder capture` warn.
7. Cut Wi-Fi after releasing the hotkey on a 60 s recording → error toast within the adaptive timeout, no late paste, next recording works immediately.
8. DevTools: `window.dictator.setSettings({ transcription: { engine: 'foo' } })` → rejected, config unchanged; `{ widget: { activeWidget: 'maxi' } }` → accepted.
9. Modes page and onboarding show the same model sizes.
10. (If rcedit A) after `npm install`, `npm run dev` taskbar shows the app icon.
