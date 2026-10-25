# Transcription Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pasted text match what was dictated: no invented sentences on noise, no credits tail, no LLM answers or tag wrappers, no corrupted CLI replacements, no silently lost speech tail or lost paste.

**Architecture:** Two new pure modules hold the decision logic (`transcript-filter.ts` for audio-aware hallucination gating, `ai-output.ts` for model-output validation) so they can be probed from Node without Electron. `ipc-handlers.ts`, `ai.service.ts`, `useAudioRecorder.ts`, `paste.service.ts` and `transcription.service.ts` get minimal edits that call them. No IPC channel or schema changes; `RecordingEntry.mode` (existing column) starts carrying the prompt label.

**Tech Stack:** Electron 40, TypeScript 4.5 (type-check with `npx -y -p typescript@5.9.3 tsc --noEmit`), electron-log, openai 6.27 / @anthropic-ai/sdk 0.78, better-sqlite3. Probe scripts run with `node --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-10-25-transcription-accuracy-findings.md`

## Global Constraints

- Work only in the worktree `C:\Users\Kuba\The_Dictator\.claude\worktrees\fix-review-findings` on branch `fix/transcription-accuracy`; never touch the main checkout (`feat/ui-redesign`, uncommitted redesign work).
- No comments in new or changed code (owner's rule, 2026-10-25); explain decisions in the chat reply.
- No automated test files, POMs or mocks (owner's rule). Verification = probe scripts in the scratchpad, type-check, lint, build, and a manual QA checklist handed to the owner.
- No commits by the agent; the owner picks commit messages (A/B/C options) at the end.
- Renderer code never uses `require`; IPC channel names only from `src/shared/constants.ts`.
- electron-log placeholders: only `%s %d %i %f %o %O %j`; never `%.4f`.
- Type-check baseline on f347282: 16 real errors (`scratchpad/tsc-baseline.txt`), ignoring `does not exist on type 'ElectronStore'`. Any new error is a regression. ESLint baseline: 0 problems, run as `npx eslint --ext .ts,.tsx --no-eslintrc -c .eslintrc.json .`.
- Thresholds come from the energy analysis (spec F1): speech frame = 50 ms with RMS > 0.02; `MIN_SPEECH_SECONDS = 0.1`; `CREDITS_MAX_SPEECH_SECONDS = 1.0`; `STOP_TAIL_MS = 300`; PCM coverage floor 0.8.
- Owner's live config to keep working: engine cloud/Groq, language `pl`, AI on (Anthropic haiku 4.5), default prompt, toggle hotkey, Bluetooth headset, voicebar widget, autoPaste.

## Review Focus

1. A very quiet but real one-word dictation ("Commity.", 0.2 s of speech frames) must still be transcribed → Task 1 probe uses the measured minimum 0.2 s and asserts `speechSeconds >= MIN_SPEECH_SECONDS`.
2. A dictation that legitimately ends with "Dyskusja o budżecie." must not lose its last sentence → Task 1 probe asserts `stripTrailingCredits` leaves it untouched (only the `Dyskusja o wyborach` family is stripped).
3. The Russian/Thai translator prompts must keep producing translations → Task 3 probe runs `validateModelOutput` with `strict=false` on a Polish→Russian pair and asserts the output is kept.
4. `cloud dsp` dictated as a whole sentence (`Cloud DSP.`) must paste `claude --dangerously-skip-permissions` in lowercase, and pass 2 after an AI edit must not touch it → Task 2 probe.
5. Pressing the hotkey again within 300 ms of stopping must start a new recording, not be dropped → Task 4 manual QA item.

---

### Task 1: Audio-aware hallucination gate (`transcript-filter.ts`)

**Files:**
- Create: `src/main/services/transcript-filter.ts`
- Modify: `src/main/ipc-handlers.ts:530-596` (gate + blocklist), `:637-643` (done log)
- Probe: `scratchpad/probes/transcript-filter.probe.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SpeechMetrics { durationSeconds: number; speechSeconds: number; rms: number; peak: number }
  export const SPEECH_FRAME_RMS = 0.02;
  export const MIN_SPEECH_SECONDS = 0.1;
  export const CREDITS_MAX_SPEECH_SECONDS = 1.0;
  export function measureSpeech(samples: Float32Array, sampleRate: number): SpeechMetrics;
  export function isNoiseTag(text: string): boolean;          // [muzyka], [music], (cisza) … whole text
  export function isCreditsOnly(text: string): boolean;       // whole text is one blocklisted phrase
  export function stripTrailingCredits(text: string): { text: string; stripped: string | null };
  ```
- Consumed by Task 5 (`SpeechMetrics` reused for the done log).

- [ ] **Step 1: Write the probe**

```ts
// scratchpad/probes/transcript-filter.probe.ts
import { measureSpeech, isCreditsOnly, isNoiseTag, stripTrailingCredits, MIN_SPEECH_SECONDS, CREDITS_MAX_SPEECH_SECONDS } from '<worktree>/src/main/services/transcript-filter.ts';
const sr = 16000;
const silence = new Float32Array(sr * 3);
const noisy = silence.map(() => (Math.random() - 0.5) * 0.01);            // rms ≈ 0.003, no frame > 0.02
const speech = new Float32Array(sr * 2); for (let i = sr * 0.5; i < sr * 0.7; i++) speech[i] = Math.sin(i / 20) * 0.1; // 0.2 s burst
assert(measureSpeech(silence, sr).speechSeconds === 0);
assert(measureSpeech(noisy, sr).speechSeconds < MIN_SPEECH_SECONDS);
assert(measureSpeech(speech, sr).speechSeconds >= 0.2 && measureSpeech(speech, sr).speechSeconds >= MIN_SPEECH_SECONDS);
for (const t of ['Wszelkie prawa zastrzeżone.', 'Dyskusja o wyborach w Wrocławiu.', 'Dyskusja o wyborach i rozwoju', 'KONIEC!', 'www.google.pl', 'Napisy stworzone przez społeczność Amara.org', 'Dziękuję za uwagę.', 'Zdjęcia i montaż', 'Thank you for watching!']) assert(isCreditsOnly(t), t);
for (const t of ['Dyskusja o budżecie jutro.', 'Zrób commit i wypchnij.', 'Wszelkie prawa zastrzeżone są w stopce, dopisz to.']) assert(!isCreditsOnly(t), t);
assert(isNoiseTag('[muzyka]') && isNoiseTag('(cisza)') && !isNoiseTag('muzyka jest głośna'));
assert(stripTrailingCredits('Zrób to teraz, proszę. Wszelkie prawa zastrzeżone.').text === 'Zrób to teraz, proszę.');
assert(stripTrailingCredits('Zrób to teraz, proszę. Dyskusja o wyborach w Wersie.').stripped !== null);
assert(stripTrailingCredits('Dyskusja o wyborach w Wersie.').stripped === null);   // whole text: leave to isCreditsOnly
assert(stripTrailingCredits('Dodaj sekcję. Dyskusja o budżecie.').stripped === null);
assert(CREDITS_MAX_SPEECH_SECONDS === 1.0);
```

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node --experimental-strip-types scratchpad/probes/transcript-filter.probe.ts`
Expected: fails with "Cannot find module … transcript-filter.ts"

- [ ] **Step 3: Implement `transcript-filter.ts`**

`measureSpeech`: frame = `Math.round(sampleRate * 0.05)`; per-frame RMS; `speechSeconds` = frames with RMS > `SPEECH_FRAME_RMS` × 0.05; also return global `rms` and `peak` (one pass). `isCreditsOnly`: anchored `^\s*(…)[.!…]?\s*$`, case-insensitive, alternatives: `wsz(elkie|ystkie) prawa zastrzeżone`, `napisy stworzone przez społeczność amara\.org`, `dzięku(ję|jemy) za (oglądanie|uwagę)`, `zdjęcia i montaż[\p{L}\s]{0,30}`, `dyskusja o (wyborach|odpowiedzi)[\p{L}\s-]{0,40}`, `www\.[\w.-]+(\s+www\.[\w.-]+)*`, `thanks? (you )?for watching`, `subtitles by the amara\.org community`; flags `iu`. No one-word families (`koniec`): a genuine one-word dictation has 0.2–0.5 s of speech and would never pass the 1.0 s gate, while the hallucinated `KONIEC!` had 0 s and is stopped by the speech gate. `stripTrailingCredits`: regex `(\s*(?<![\p{L}\p{N}])(?:wsz(?:elkie|ystkie) prawa zastrzeżone|dyskusja o wyborach[\p{L}\s-]{0,30}|napisy stworzone przez społeczność amara\.org|dzięku(?:ję|jemy) za oglądanie)[.!…]?\s*)$` with `iu` (the lookbehind keeps "podziękuję za oglądanie" whole); apply only when the remaining text has ≥ 3 words, else return unchanged with `stripped: null`.

- [ ] **Step 4: Run the probe to verify it passes**

Run: `node --experimental-strip-types scratchpad/probes/transcript-filter.probe.ts`
Expected: prints `ok`, exit 0

- [ ] **Step 5: Wire it into `transcribeBuffer`**

Replace lines 545-557 and 580-596 of `ipc-handlers.ts`: `const metrics = measureSpeech(samples, sampleRate);` and test `metrics.speechSeconds < MIN_SPEECH_SECONDS` (the global `rms < 0.003` term is dropped: it caught none of the 17 hallucinated files and can only reject one quiet word after a long pause); message text unchanged; log `Audio below speech threshold (rms=%s speech=%ss of %ss) — skipping transcription` with `toFixed`. After Groq: `if (!rawText || isNoiseTag(rawText) || (isCreditsOnly(rawText) && metrics.speechSeconds < CREDITS_MAX_SPEECH_SECONDS))` → existing reject path, log includes `id=%s speech=%ss`. Then `const { text: filteredRaw, stripped } = stripTrailingCredits(rawText); if (stripped) log.warn('Dropped trailing credits hallucination: "%s"', stripped);` and use `filteredRaw` as the input to vocabulary/AI while history keeps the original `rawText`. Extend the done log with `speech=%ss`.

- [ ] **Step 6: Type-check + lint**

Run: `npx -y -p typescript@5.9.3 tsc --noEmit 2>&1 | grep "error TS" | grep -v "ElectronStore" | wc -l` → 16; `npx eslint --ext .ts,.tsx --no-eslintrc -c .eslintrc.json .` → 0 problems.

---

### Task 2: Vocabulary pass safety (`applyVocabularyReplacements`)

**Files:**
- Modify: `src/main/ipc-handlers.ts:118-174`
- Probe: `scratchpad/probes/vocabulary.probe.ts` (copy of lines 48-174 as a module is not possible without exporting; export `applyVocabularyReplacements` and `matchCapitalization` from `ipc-handlers.ts` is undesirable — instead move lines 48-174 into a new pure module `src/main/services/vocabulary.ts` exporting `applyVocabularyReplacements(text, vocabulary, pass = 1)`, and import it in `ipc-handlers.ts`.)

**Interfaces:**
- Produces: `export function applyVocabularyReplacements(text: string, vocabulary: VocabularyEntry[], pass?: number): string` in `src/main/services/vocabulary.ts` (logs `Vocabulary pass %d: %d replacement(s) applied: %s`).

- [ ] **Step 1: Write the probe** with the owner's entries (`cloud dsp → claude --dangerously-skip-permissions`, `claude → Claude Code`, `komit* → commit*`, `tugel | tugl* → toogle*`, `jakub email → jakubruniecki@gmail.com`, `11 labs → ElevenLabs`):

```ts
const p1 = apply('Odpal cloud dsp.', V);            assert(p1 === 'Odpal claude --dangerously-skip-permissions');
const p2 = apply(p1 + ' i czekaj.', V, 2);          assert(p2 === 'Odpal claude --dangerously-skip-permissions i czekaj.');
assert(apply('Cloud DSP.', V) === 'claude --dangerously-skip-permissions');
assert(apply('Zapytaj Claude Code o to.', V, 2) === 'Zapytaj Claude Code o to.');
assert(apply('Komity są gotowe, tugla to.', V) === 'Commity są gotowe, toogla to.');
assert(apply('Napisz do claude.', V) === 'Napisz do Claude Code.');
assert(apply('cloud dsp, a potem komit', V) === 'claude --dangerously-skip-permissions, a potem commit');
```

- [ ] **Step 2: Run the probe to verify it fails** (`node --experimental-strip-types …`): the `p2` and `Cloud DSP.` assertions fail on the current code.

- [ ] **Step 3: Implement** in `vocabulary.ts`: `matchCapitalization` returns `replacement` unchanged when `looksLikeCliCommand(replacement)`. Before `text.replace`, build `protected: Array<[number, number, string]>` by scanning `text.toLowerCase()` with `indexOf` for every configured replacement (trailing `*` removed, length ≥ 2). In the callback, skip (`return matched`) when a protected span `[a, b)` satisfies `a <= offset && offset + matched.length <= b` and (`b - a > matched.length` or `text.slice(a, b) === replacementOriginalCase`). Remove the old `alreadyReplaced` block. Add the `pass` argument to the log line.

- [ ] **Step 4: Run the probe** → `ok`.

- [ ] **Step 5: Call sites** in `ipc-handlers.ts`: `applyVocabularyReplacements(filteredRaw, vocabEntries)` and `applyVocabularyReplacements(text, vocabEntries, 2)`.

- [ ] **Step 6: Type-check + lint** (16 / 0).

---

### Task 3: AI output validation, prompt fix, retry classification, logging

**Files:**
- Create: `src/main/services/ai-output.ts`
- Modify: `src/main/services/ai.service.ts` (whole `process`, `isRetryable`, both `processX`), `src/shared/types.ts:196`, `src/main/ipc-handlers.ts:286-296` (migration), `:667-676` (history `mode`)
- Probe: `scratchpad/probes/ai-output.probe.ts`

**Interfaces:**
- Produces in `ai-output.ts`:
  ```ts
  export function unwrapModelOutput(output: string): string;
  export function wordContainment(output: string, input: string): number;   // 0..1
  export function validateModelOutput(output: string, input: string, strict: boolean): { text: string | null; reason: string | null };
  ```
- `AIService.process(rawText)` keeps its signature; new `AIService.getPromptLabel(): string` returns `'default'` or the saved prompt's name (fallback: its id) — used by Task 3 step 7 for `RecordingEntry.mode`.
- New constant in `types.ts`: `export const LEGACY_PROMPT_TAIL = 'Respond with ONLY the reformatted message wrapped in the required tags.'` and the default prompt now ends with `Respond with ONLY the reformatted message, as plain text without any tags.`

- [ ] **Step 1: Write the probe**

```ts
assert(unwrapModelOutput('<output>\nAla ma kota.\n</output>') === 'Ala ma kota.');
assert(unwrapModelOutput('<message>Ala ma kota.</message>') === 'Ala ma kota.');
assert(unwrapModelOutput('Ala ma kota.</output>') === 'Ala ma kota.');
assert(unwrapModelOutput('Ala ma <b>kota</b>.') === 'Ala ma <b>kota</b>.');
const dictation = 'Chciałbym, żebyś dodał trzy przyciski do karty Processing i zmienił kolor.';
assert(validateModelOutput('<input>' + dictation + '</input>', dictation, true).text === null);
assert(validateModelOutput('I appreciate your message, but I need to clarify my role: I am a text transformation pipeline.', dictation, true).text === null);
assert(validateModelOutput('Chciałbym, żebyś dodał trzy przyciski do karty Processing i zmienił kolor.', dictation, true).text === dictation);
assert(validateModelOutput('Jasne! Oto trzy propozycje layoutu: 1. … 2. … 3. …', dictation, true).text === null);
assert(validateModelOutput('Я хотел бы, чтобы ты добавил три кнопки.', dictation, false).text !== null);   // translator prompt, strict=false
assert(validateModelOutput('Commit.', 'Komit.', true).text === 'Commit.');   // short inputs: no containment check
```

- [ ] **Step 2: Run the probe → fails (module missing).**

- [ ] **Step 3: Implement `ai-output.ts`.** `unwrapModelOutput`: `^\s*<(output|message|result|response|text)>\s*([\s\S]*?)\s*<\/\1>\s*$` → group 2; then remove a trailing orphan `</(output|message|result|response|text)>`. `wordContainment`: tokens = `toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)`; share of output tokens present in the input token set (1 when output has no tokens). `validateModelOutput`: unwrap; if `/<\/?input>/i` → `{ text: null, reason: 'input echo' }`; if `strict` and input has ≥ 6 tokens and `wordContainment < 0.6` → `{ text: null, reason: 'containment 0.xx' }`; if `strict` and `out.length > 3 * input.length + 80` → `{ text: null, reason: 'length' }`; else `{ text: out, reason: null }`.

- [ ] **Step 4: Run the probe → `ok`.**

- [ ] **Step 5: `ai.service.ts`.**
  - `isRetryable`: `if (err instanceof OpenAI.APIUserAbortError || err instanceof Anthropic.APIUserAbortError) return false; if (err instanceof OpenAI.APIConnectionError || err instanceof Anthropic.APIConnectionError) return true; const status = …; return status === 429 || (typeof status === 'number' && status >= 500);`
  - `processOpenAI` / `processAnthropic`: resolve `client`, `model`, `temperature` before `withRetry`; inside the stream loop capture the stop reason (`chunk.choices[0]?.finish_reason`; Anthropic `event.type === 'message_delta'` → `event.delta.stop_reason`); after the loop `if (abortController.signal.aborted) throw new Error('AI request timed out')`; `if (stop === 'length' || stop === 'max_tokens') throw new Error('AI output was cut off by the token limit')`; return `{ text, stop }`.
  - `process`: `const strict = (selectedPromptId ?? 'default') === 'default'`; after the provider call `const verdict = validateModelOutput(answer.text, rawText, strict)`; on `verdict.text === null` → `log.warn('AI output rejected (%s), using dictated text. prompt=%s out=%d chars', …)` and return `rawText`; on success `log.info('AI: prompt=%s provider=%s model=%s in=%d out=%d ms=%d stop=%s', …)`; empty answer still falls back to `rawText`.
  - `vocabSection` wording: `User vocabulary (these spellings are already correct where they appear — keep them exactly as written, never insert them elsewhere, never change other words to match them):`.
  - `getPromptLabel()` reads `dictation.selectedPromptId` and `dictation.savedPrompts`.

- [ ] **Step 6: `types.ts` + migration.** Replace the last sentence of `DEFAULT_SETTINGS.dictation.customPrompt`; export `LEGACY_PROMPT_TAIL`. In `SETTINGS_GET` after the existing dictation migration: if `typeof dictation.customPrompt === 'string' && dictation.customPrompt.trimEnd().endsWith(LEGACY_PROMPT_TAIL)` → `store.set('dictation.customPrompt', customPrompt.replace(LEGACY_PROMPT_TAIL, NEW_TAIL))` where `NEW_TAIL` is the new last sentence (export it too as `PROMPT_PLAIN_TEXT_TAIL`). Also patch `savedPrompts[i].content` the same way.

- [ ] **Step 7: history `mode`.** In `transcribeBuffer`: store `aiService.getPromptLabel()` as `mode` only when AI ran with a non-default prompt (the current History page renders `mode` as an uppercase badge, so `default` must not be stored).

- [ ] **Step 8: Type-check + lint (16 / 0).** Also `grep -rn "required tags" src` → only `LEGACY_PROMPT_TAIL`.

---

### Task 4: Recorder stop tail, queued start, PCM coverage (`useAudioRecorder.ts`)

**Files:**
- Modify: `src/renderer/hooks/useAudioRecorder.ts:343-348` (start guard), `:619-657` (stop head), `:699-720` (fallback condition), `:744-746` (finally)

**Interfaces:**
- New refs: `pendingStartRef = useRef(false)`, `startRecordingRef = useRef<() => Promise<void>>()` kept current via `useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording])`.
- New constants: `STOP_TAIL_MS = 300`, `PCM_COVERAGE_FLOOR = 0.8`.

- [ ] **Step 1: Stop tail.** In `stopRecording`, after `setRecordingStartTime(null)` and before the MediaRecorder block: `await new Promise((r) => setTimeout(r, STOP_TAIL_MS));`. `elapsedMs` stays measured before the wait.

- [ ] **Step 2: Queued start.** In `startRecording`: when `isStoppingRef.current` → `pendingStartRef.current = true; recLog.info('start queued: previous recording is still flushing'); return;`. In `stopRecording`'s `finally`: after `isStoppingRef.current = false`, `if (pendingStartRef.current) { pendingStartRef.current = false; void startRecordingRef.current?.(); }`. In `teardownRecording` and at the top of `cancelRecording`: `pendingStartRef.current = false`. In the hotkey toggle handler, a second toggle while `isStoppingRef.current && pendingStartRef.current` un-queues the start and returns (PTT release, or toggle press-press inside the tail). In the stop path send `stopRecording(false)` only when no start is pending, so main keeps the `initializing` state owned by the new press and hotkey polarity stays active.

- [ ] **Step 3: PCM coverage.** After `totalLength` is known: `const pcmSeconds = totalLength / (audioContext?.sampleRate ?? WHISPER_SAMPLE_RATE); const pcmTooShort = elapsedMs > 1000 && pcmSeconds < (elapsedMs / 1000) * PCM_COVERAGE_FLOOR;` and change the fallback condition to `if ((!hasAudio || pcmTooShort) && compressedBlobPromise)`; the warn message distinguishes `no samples` from `pcm=${pcmSeconds.toFixed(1)}s of ${elapsed}s`.

- [ ] **Step 4: Type-check + lint (16 / 0).** `npm run build` in the worktree must succeed.

- [ ] **Step 5: Manual QA items (hand to owner):** (a) dictate a sentence and press Ctrl+Space on the last syllable → last word present; (b) stop and press Ctrl+Space again immediately → second recording starts (log `start queued`), widget shows recording; (c) normal dictation latency acceptable with the extra 300 ms.

---

### Task 5: Live recording is not disturbed by the previous transcription (`transcribeBuffer`)

**Files:**
- Modify: `src/main/ipc-handlers.ts` inside `transcribeBuffer` (all `broadcastState`, `scheduleIdle`, overlay `TRANSCRIPTION_ERROR` sends)

- [ ] **Step 1:** Add `const micLive = () => { const s = getCurrentState(); return s === 'initializing' || s === 'recording'; };` inside `registerIpcHandlers`. Add `function setTranscriptionState(state: RecordingState, idleAfterMs?: number)` that returns early with `log.info('state %s skipped — newer recording is live', state)` when `micLive()`, else broadcasts and (if `idleAfterMs`) calls `scheduleIdle`. Replace every `broadcastState(...)` / `scheduleIdle(...)` pair in `transcribeBuffer` with it; guard the overlay `TRANSCRIPTION_ERROR` sends with `!micLive()` (main-window `NOTIFICATION_ERROR` toasts stay).

- [ ] **Step 2: Type-check + lint (16 / 0).**

- [ ] **Step 3: Manual QA item:** start recording #2 while #1 is transcribing → music stays muted, widget stays in recording, stop chime plays at the end of #2, both texts pasted in order.

---

### Task 6: Paste reports failure honestly (`paste.service.ts`, clipboard verify)

**Files:**
- Modify: `src/main/services/paste.service.ts:26` (`PW.Paste()`), `src/main/ipc-handlers.ts:645-661`

- [ ] **Step 1:** In `PW_TYPEDEF`, `Paste()` ends with `uint n=SendInput(4,inp,z);if(n!=4){throw new Exception("SendInput injected "+n+" of 4 events");}`.

- [ ] **Step 2:** In `transcribeBuffer`, replace `clipboard.writeText(text);` with a loop (max 3 attempts, 30 ms apart): write, then compare `clipboard.readText().replace(/\r\n/g, '\n')` with `text.replace(/\r\n/g, '\n')`; on persistent mismatch `log.warn('Clipboard write not confirmed after %d attempts', 3)` and send the existing `NOTIFICATION_ERROR` with `'Could not place the text in the clipboard — copy it from History.'`, skipping `simulatePaste`.

- [ ] **Step 3: Type-check + lint (16 / 0).** Manual QA: paste into an elevated PowerShell → toast "Auto-paste failed — text is in your clipboard"; paste into Cursor terminal → works as before.

---

### Task 7: Local engine and Groq client hygiene (`transcription.service.ts`, `ModesPage.tsx`)

**Files:**
- Modify: `src/main/services/transcription.service.ts:30-46, 307-315, 361-409, 444-479`, `src/renderer/components/ModesPage.tsx:167-169, 769`

- [ ] **Step 1 (Groq client):** `new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 60_000 })`; `withRetry`: `if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) throw err;` (keeps the 401/403 behaviour).

- [ ] **Step 2 (local options):** `const englishOnly = modelId.endsWith('.en');` → set `task`/`language` only when `!englishOnly`; `max_new_tokens = Math.min(448, Math.max(64, Math.ceil(durationSeconds * 14)))`; inside the `> 30` branch add `options.return_timestamps = true`.

- [ ] **Step 3 (preprocessing order):** in `transcribeFromBuffer` call `normalizeAudio` first, then `trimSilence`; fix the stale comment text at `:461` only if the comment is edited anyway (otherwise leave comments alone).

- [ ] **Step 4 (UI language):** `ModesPage.tsx`: drop `patch.language = 'en'` (keep `preferredCloudLanguage` bookkeeping: on switch to local keep the current language), and drop the `engine !== 'local' || opt.value === 'en'` filter so `pl` stays selectable.

- [ ] **Step 5: Type-check + lint (16 / 0).** Note for the owner: `ModesPage.tsx` is being redesigned on `feat/ui-redesign`; this is a 2-line conflict to resolve on rebase.

---

### Task 8: Empty recording tells the user (`main.ts`)

**Files:**
- Modify: `src/main/main.ts:494-503`

- [ ] **Step 1:** In `RECORDING_STOP`, when `goIdle` is true and `currentState` was `recording` or `initializing`, send `IPC.NOTIFICATION_ERROR` with `'Recording was empty — no audio captured. Try again.'` to all windows and `IPC.TRANSCRIPTION_ERROR` to the overlay before `broadcastState('idle')`. Remove the now-redundant dead branch in `transcribeBuffer` only if it is provably unreachable (renderer returns on `!hasAudio`): keep it, it costs nothing and guards a future caller.

- [ ] **Step 1b:** Log the cancel path: in `main.ts` where the cancel hotkey / `RECORDING_CANCEL` reaches the renderer (`sendCancelToRenderer` or equivalent), `log.info('recording cancelled by user (state=%s)', currentState)`, so `recording -> idle` can be split into cancels and empty recordings in `main.log`.

- [ ] **Step 2: Type-check + lint (16 / 0).**

---

### Task 9: Whole-branch verification

- [ ] `npx -y -p typescript@5.9.3 tsc --noEmit 2>&1 | grep "error TS" | grep -v "ElectronStore"` → identical to `scratchpad/tsc-baseline.txt` (16 lines, same files).
- [ ] `npx eslint --ext .ts,.tsx --no-eslintrc -c .eslintrc.json .` → 0 problems.
- [ ] `npm run build` → succeeds; `grep -c "required tags" .vite/build/main.js` → 1 (the legacy constant) or 0.
- [ ] Re-run all three probes → `ok`.
- [ ] `git diff --stat develop` lists only the files named in this plan plus the two docs.
- [ ] Hand the owner: per-task summary, the manual QA checklist (Tasks 4, 5, 6 + "dictate 'Dziękuję za uwagę' loudly → pasted", "stay silent 3 s → 'Audio too quiet' toast, no paste"), and A/B/C commit-message options.
