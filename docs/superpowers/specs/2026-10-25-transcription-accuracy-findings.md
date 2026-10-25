# Transcription accuracy — findings and required behaviour

Date: 2026-10-25
Branch: `fix/transcription-accuracy` (worktree `.claude/worktrees/fix-review-findings`, based on `develop` f347282)
Question answered: where does the pasted text still diverge from what was said, now that the Whisper
prompt is gone (1ba1b34), and what must change so that it does not.

Evidence base: `history.db` (8066 rows, 2026-03-12 → 2026-10-25, `raw_text` on 150 rows since 2026-10-24),
`main.log` + `main.old.log` (2026-03-24 → 2026-10-25), energy analysis of 157 saved WebM recordings
(17 hallucinations, 140 real dictations), code review of the `develop` state by four independent readers,
probe scripts run against the real `applyVocabularyReplacements` and the real SDK error classes.

## Pipeline under review

renderer `useAudioRecorder` → IPC `TRANSCRIPTION_START_BUFFER` (16 kHz PCM from the AudioWorklet +
MediaRecorder WebM/Opus blob) → `transcribeBuffer` in `ipc-handlers.ts`: silence gate → Groq
`whisper-large-v3` (blob) → whole-transcript blocklist → vocabulary pass 1 → AI (`customPrompt`) →
vocabulary pass 2 → clipboard + Ctrl+V → history row.

## F1. Noise-only recordings still paste invented sentences

- 20 history rows are a hallucination and nothing else. 10× `Dyskusja o wyborach …` (2.3–19.3 s),
  7× `Wszelkie prawa zastrzeżone.` (1.9–6.1 s), `KONIEC!` (9.2 s), `www.google.pl` (3×, 3 s). The current
  `CREDITS_RE` matches only the second family.
- Energy analysis (50 ms frames, frame RMS > 0.02 counts as speech): 16 of the 17 hallucinated files have
  0–0.7 s of speech frames, 7 of them exactly 0 s. Every one of the 140 real dictations has ≥ 0.2 s, 1-word
  dictations 0.2–0.5 s, sentences ≥ 0.95 s. Peak level does not separate the groups (clicks reach 0.98 in
  hallucinated files); the global RMS gate (`rms < 0.003`) let all 17 through.
- Required: a gate on speech-frame seconds, not on global RMS. `speechSeconds < 0.1` → do not transcribe
  (zero false positives in the sample, 2× margin to the quietest real recording). A whole-transcript match
  against the extended blocklist is rejected only when `speechSeconds < 1.0`; a clearly spoken
  "Dziękuję za uwagę." (≥ 1 s of speech) is pasted. Single-word tags (`[muzyka]`, `[cisza]`) stay rejected
  unconditionally. One-word families (`KONIEC!`) are left to the speech gate: the hallucinated file had 0 s of
  speech frames, while a genuine one-word "Koniec." has 0.2–0.5 s and must survive. Log the metrics
  (`speech=`, `wps`) so the thresholds can be re-tuned from `main.log`.

## F2. Credits appended after real speech are not filtered

- Before 1ba1b34 this happened 6× on ≥ 30 s recordings. Without a prompt it did not reproduce on 13 files,
  but the trigger (pause near a 30 s window end) is unchanged, so a text-only safety net is required:
  strip a trailing `Wszelkie prawa zastrzeżone.` / `Dyskusja o wyborach …` / `Napisy stworzone przez
  społeczność Amara.org` / `Dziękuję za oglądanie` when at least 3 words precede it; log it; keep
  `rawText` untouched in history.

## F3. The AI step can paste an answer, a refusal or a tag wrapper

- History: 6 rows with `<output>…</output>`, 1 with `<message>`, 1 pasted refusal
  (`I appreciate your message, but I need to clarify my role…`, 2026-05-14). Zero since 2026-06-01 with
  current models, but no code defence exists and the default prompt still ends with
  `Respond with ONLY the reformatted message wrapped in the required tags.` (tags never defined; the same
  text sits in every existing install's stored `customPrompt`).
- Required: strip one outer `<output|message|result|response|text>` wrapper; a result containing `<input>`
  falls back to the dictated text; for the default prompt only (`selectedPromptId === 'default'`) a
  containment check (share of output words ≥ 3 chars that occur in the input; < 0.6 on inputs ≥ 6 words,
  or output longer than 3× input + 80 chars) falls back to the dictated text with a warn log. Saved prompts
  (translators, generators) skip the containment check. Replace the dangling sentence in
  `DEFAULT_SETTINGS` and migrate stored prompts that still end with it.

## F4. A saved translator prompt stays active invisibly

- 2026-10-24 21:16–21:21: four consecutive UI-work dictations came out as Polish + Russian because the
  Russian translator prompt was still selected. `AIService.process` reads only `customPrompt`; nothing
  logs which prompt ran and `RecordingEntry.mode` is never set.
- Required: log prompt label, provider, model, input/output length, latency and stop reason on every AI
  run; store the prompt label in `RecordingEntry.mode`. A visible indicator belongs to the UI redesign.

## F5. Vocabulary pass 2 corrupts CLI replacements; CLI replacements get capitalised

- Probe with the owner's entries: `Odpal cloud dsp.` → pass 1 `Odpal claude --dangerously-skip-permissions`
  → pass 2 `Odpal Claude Code --dangerously-skip-permissions`. Pass 2 runs whenever the AI changed a single
  character. The idempotency check knows only the current entry's replacement.
- `matchCapitalization` mirrors a sentence-initial capital onto `claude --dangerously-skip-permissions`
  (letters, spaces, hyphens pass its regex) → `Claude --dangerously-skip-permissions`, wrong in Git Bash/WSL.
- Required: any text span that already equals a configured replacement (longer than the match, or equal
  and case-identical) is protected from further replacement; CLI replacements never change case; the
  vocabulary log says which pass fired.

## F6. AI retry and timeout handling

- `isRetryable` treats every status-less error as a network error; neither SDK sets `name` on
  `APIUserAbortError`, so the 25 s abort is retried (second attempt outlives the 30 s race) and a missing
  API key is retried after 1 s (seen 2026-10-24 23:33 and 23:36).
- OpenAI streaming ends silently on abort: a prefix of the answer is returned and pasted.
- `max_tokens` exhaustion is not detected on either provider.
- Required: resolve the client before the retry loop; retry only `APIConnectionError`, 429 and 5xx; throw
  when the request was aborted or the stop reason is a token limit (the handler already falls back to the
  vocabulary text and shows a toast).

## F7. Last 100–300 ms of speech can be lost at stop

- `mr.stop()` and the worklet flush run in the same tick as the hotkey. A Bluetooth HFP mic delivers
  samples 100–250 ms late; two recent recordings end mid-word with speech present to the last 100 ms.
- A start pressed while the previous stop is flushing is dropped with only a log line, although the main
  process already announced `initializing`.
- Worklet PCM shorter than the MediaRecorder blob (partial stall) is not detected: the gate, duration and
  words-per-second then describe the wrong audio.
- Required: wait `STOP_TAIL_MS = 300` before stopping the recorder and the worklet; queue a start that
  arrives during the flush and run it when the flush ends; when the PCM covers < 80 % of the elapsed time
  and a blob exists, decode the blob and use it as the PCM (the fallback decoder already exists).

## F8. A recording started during the previous transcription is disturbed

- `transcribeBuffer` broadcasts `transcribing` / `processing` / `done` / `idle` for recording #1 while
  recording #2 is live: other apps are unmuted mid-recording, the widget shows idle, the stop chime of #2
  is skipped. The audio is not lost.
- Required: `transcribeBuffer` skips state broadcasts and the idle timer while the current state is
  `initializing` or `recording`; paste, history and `TRANSCRIPTION_RESULT` still run.

## F9. Paste reports success without pasting

- `PW.Paste()` ignores the `SendInput` return value: an elevated target (admin terminal, regedit) blocks
  injection, 0 events are sent, `PASTE_OK` is still printed, no toast.
- `clipboard.writeText` is not verified; a clipboard manager holding the clipboard open makes Chromium
  skip the write silently and Ctrl+V pastes the previous content.
- Required: throw inside `Paste()` when fewer than 4 events were injected; read the clipboard back (up to
  3 attempts) and fall back to the "text is in your clipboard" toast when it still differs.

## F10. Local engine (not the owner's path, must not regress)

- Switching to the local engine forces `language = 'en'` and hides the Polish option; Polish speech is
  decoded with `<|en|>`.
- `task: 'transcribe'` / `language` passed to an English-only model throws in transformers.js.
- `max_new_tokens = 8 × seconds` is sized for English; Polish BPE needs ~10 tokens/s on fast speech.
- Chunked (> 30 s) decoding merges by token LCS without timestamps.
- `trimSilence` uses an absolute threshold before `normalizeAudio`.
- Groq client: SDK `maxRetries` 2 inside our 2-attempt retry = up to 6 HTTP attempts racing the timeout.

## F11. Logging defects

- `log.info('… (RMS=%.4f) …', rms)` prints the placeholder literally (electron-log knows only `%s %d %i %f %o %O %j %c`).
- Empty recordings (`RECORDING_STOP` with `goIdle`) show nothing to the user; the message in
  `transcribeBuffer` is unreachable.

## Data addendum (history + log mining, 2026-10-25)

- The `<output>` wrapper is live, not historical: row `1792920916455` (2026-10-25 09:35 UTC, 35 s,
  claude-haiku-4-5) pasted `<output>…</output>`. Of 141 non-translator rows since 2026-10-24 the model
  changed 2, both for the worse (that wrapper, and a lower-cased sentence start in `1792920043965`).
- Vocabulary pass 2 already misfired in production: `1792921052508` raw `z Cloud Sonnet na Cloud Haiku` →
  AI corrected to `Claude` → pass 2 → `Claude Code Sonnet` / `Claude Code Haiku` (spec F5).
- "Too quiet" skips after the 2026-10-24 build: 11 of 190 stops, RMS 0.0006–0.0025, one of 27 s followed
  one second later by a 2 s retry with the identical RMS (0.00113) → a constant noise floor from a Bluetooth
  mic that was not streaming, not attenuated speech. The absolute gate is right to reject these; the
  user-facing problem is that nothing warns during the 27 s. Follow-up (not in this plan): a live
  "no signal" hint on the widget after ~3 s without a speech frame.
- `recording -> idle` is 21.5 % after the fixes but only 1 of 52 was an empty recording; the other 51 are
  Escape cancels, which no log line records. Add a cancel log line so the metric means something.
- Appended credits before the prompt removal: 15 rows, all ≥ 30.0 s = 3.4 % of 435 recordings ≥ 30 s;
  0 of 3 since. ~90 recordings ≥ 30 s are needed before "0 after fix" is evidence.
- Truncation signal: median 1.77 words/s (5–25 s, n=4709); ≥ 20 s with < 1.3 words/s = 13.9 % before,
  0 of 11 after; only 19 of those 156 end mid-sentence → mostly slow speech, not dropped windows.
- Other log defects: `Failed to start recording: undefined` ×75 (error object lost in the renderer log
  call); `Transcription done` has no recording id (joins to history are heuristic); update failures logged
  three times per offline check.

## Out of scope (recorded, not changed)

- `captureTarget()` after AI instead of at stop (design choice).
- Neutralising Shift/Alt held during Ctrl+V (would desync the OS modifier state).
- Start chime before the worklet is wired (affects the local engine only).
- Rejected transcripts as flagged history rows (needs History UI work, redesign in progress).
- Vocabulary configuration hazards reported to the owner: `toogle*` (typo for `toggle`), `claude` matches
  `Claude Haiku` / `claude.ai`, `11 labs` misses `Eleven Labs`, `emera` misses inflections.
