# UI redesign — design spec

Date: 2026-10-24 (status updated end of day)
Branch: `feat/ui-redesign`
Scope: presentation layer (`src/renderer/`, `src/index.css`). Main-process changes only when a visual
requirement cannot be met otherwise, and only with approval (one so far: `DONE_STATE_MS`).

## Intent

The Dictator is used by a developer who dictates prompts and comments into several terminals
(Claude Code, Cursor, Warp) and switches windows dozens of times an hour. The widget sits over a
dark, monospace terminal most of the time; the main window is opened rarely.

- **Widgets:** an invisible tool. A dark capsule that stays out of the way and says clearly what is
  happening (recording, processing, pasted, error).
- **Main window:** the existing camera/VHS personality stays (scanlines, noise, vignette, red brand,
  cards with a red top line, glowing record button). The redesign makes it cleaner and more legible
  rather than replacing it. An earlier "Linear-like" neutral direction was rejected by the user.

## Process (revised during the day)

The first plan (three full visual directions at once, then a token system, then all components) did
not work: abstract directions on a fake app were hard to judge. The working process is:

1. One small piece at a time (a widget, a page, a component).
2. Two to five variants of that piece on the design canvas, in real sizes, with real content.
3. The user picks or combines; I implement in the real component.
4. The user checks it in `npm run dev` and sends screenshots with remarks; I fix immediately.
5. Lint + type-check after every change; a manual checklist instead of automated tests.
6. Commit per finished piece.

Design canvas (all mockups and decisions): https://claude.ai/artifact/LYcvHznbEdVJPaoaAbqKZV

Tokens grow with the work instead of being designed up front.

## Decisions

From the brief and kickoff:

- Fonts stay: Inter (UI, content) + JetBrains Mono (headings, labels, data, shortcuts, keys).
- No new dependencies without approval (none added so far; icons are inline SVG).
- Sidebar with six pages is fixed. Onboarding is in scope.
- Widget idle visibility: Mini barely visible, Maxi hidden until active.

Made during implementation:

- **Theme:** the main window is dark only. The camera look does not translate to a light surface.
  The widgets are always dark, independent of the app theme.
- **Widgets (direction "Kapsuła", inspired by Wispr Flow):** Mini and Maxi are two sizes of one dark
  capsule. Mini idle collapses to a 64×8 sliver; hover shows mic icon + shortcut; recording shows
  9 bars (no dot, no timer); processing shows pulsing dots; done shows "Pasted" with a green border;
  error shows "Error" with a red border. Maxi: 480×64 capsule + shortcut pill below, no state labels
  and no right-hand block (variant M3 "Licznik"). Recording: a blinking red dot with a pulse ring and
  the timer on the left, 50 bars filling the rest. Processing: grey dot + frozen dim timer, pulsing
  dots. Done: green check + pasted text. Error: red dot + error text.
  The done state lasts 1.5 s (`DONE_STATE_MS` in `src/main/ipc-handlers.ts`).
- **HomePage:** layout unchanged; camera effects kept; record button 96 px with a 64 px red dot.
- **Sidebar (S1):** active page framed by red viewfinder corners, duotone inline icons, labels in Inter.
- **Processing page (P3):** three numbered steps on a rail: Transcribe, Enhance with AI, Paste.
  Field labels in mono uppercase, values in Inter. No helper descriptions or badges unless they
  carry state.
- **Selection (Z3):** the selected option is inverted (light fill, dark text) with a sliding
  indicator (200 ms). Toggles are light when on. Shared components in `src/renderer/components/ui/`:
  `Segmented`, `Switch`, `StepCard`, `FieldRow`.
- **API keys (K1):** a saved key shows "✓ Verified" inside the masked field; an invalid key gets a red
  field border and the error text below. Delete is a red square trash button with a two-step confirm.
- **History (H1 "Dziennik"):** search field with the recording count inside; one card per day with
  count and total duration in the heading; one-line rows (time, text, target app, duration, copy on
  hover). An expanded row gets a light left bar; the full text sits below the row so it stays
  selectable, then "Whisper raw" with changed words highlighted, Copy / Copy raw, words and wpm, and
  the K1 trash button. Legacy mode badges are gone.
- **Shortcuts (S1 "Wiersze"):** a "Recording" card with Mode (`Segmented`) and Call mode (`Switch` + one
  line), then one card with only the shortcuts of the active mode plus Show / hide window. Fixed-width
  shortcut field with flat keycaps; listening state has a light border, caret and "Esc cancels"; blur
  cancels listening; reset icon only for a non-default shortcut; errors show inside the field.

Rules that apply everywhere:

- Red means brand, recording, the active page in the sidebar, errors and destructive actions. Red is
  never used for "selected".
- Section headings and field labels: mono, uppercase, tracked. Content and values: Inter.
- Text contrast meets WCAG AA (no `neutral-600/700` as text).
- No em-dashes in UI copy or code comments.
- Every colour comes from a token in `@theme` (`src/index.css`): window tokens (`bg`, `surface`,
  `surface-hover`, `surface-sunken`, `border`, `border-strong`, `text`, `text-muted`, `text-dim`,
  `accent`, `accent-strong`, `accent-soft`, `ok`, `ok-text`, `warn`, `warn-text`, `shadow-glow-accent`)
  and widget tokens (`widget-*`, `shadow-widget`).

## Status

Done:

- Mini widget (`VoiceBar.tsx`), Maxi widget (`MaxiWidget.tsx`), shared key formatter (`overlay/keys.ts`).
- Window tokens, `Sidebar`, `HomePage`, `MicrophoneSelector`, app header in `App.tsx`.
- Processing page (`ModesPage.tsx`) with the `ui/` components, `ApiKeyInput`, auto-paste switch,
  prompt-name sanitizing (max 40 chars / 6 words, otherwise "Prompt N").
- History page (`HistoryPage.tsx`) and `CopyButton` (tokens, `label`, `variant`; also restyles the
  copy button on Home).
- Shortcuts page (`ShortcutsPage.tsx`).

Remaining, in order:

1. `VocabularyPage`: tokens, `ui/` components, Z3 selection. Vocabulary is the third user of the K1
   trash button and of the mono section heading, time to propose shared components.
2. `WidgetPage`: comparison table is outdated ("6 (flat)", "✕ icon"); thumbnails should render the
   real widgets (`VoiceBar` already has `preview`/`forceHover` props; `MaxiWidget` has none); Mini/Maxi
   cards use Z3 selection.
3. `OnboardingWizard`: restyle; drop its own "valid" message now that `ApiKeyInput` shows "Verified".
4. Small components: `Toast`, `UpToDatePopup` (should become a toast), `ForceUpdateModal`,
   `CopyButton`, `RecIndicator` / `RecEffects`, `ErrorBoundary` inline styles in `App.tsx`.
5. `index.css`: old keyframes and helpers with hard-coded colours (`rec-glitch`, `first-run-glow`,
   `entry-glow`, `temperature-slider`, scrollbars).
6. Close: `npm run lint`, `npx -y -p typescript@5.9.3 tsc --noEmit`, sweep for loose colours.

Open ideas (not decided):

- Ask the model to answer "Untitled" for meaningless prompts in `generatePromptName` (main process).
- A hint that local Whisper is English only (the engine description was removed).
- Show the Whisper download progress in place of the model description so the card never grows.
- Remove the remaining em-dashes in logs, prompts and untouched files (separate cleanup commit).

## Constraints

- Renderer is sandboxed; everything goes through `window.dictator.*`.
- Overlay shares the renderer entry with the main window (hash routing in `App.tsx`); global styles
  affect both windows. `html/body/#app` background must stay transparent.
- Overlay window sizes come from `getOverlaySize()` in `src/main/ipc-handlers.ts`: Mini 210×62,
  Maxi 520×170.
- Electron transparent windows need a non-transparent hit area (`rgba(0,0,0,0.01)` wrapper).

## Audit summary (stage 1, 2026-10-24)

- No token system; 38 distinct colour values in classes; hard-coded hex/rgba in `index.css`, inline
  styles and `ErrorBoundary`.
- One header style (mono, uppercase, wide tracking) for everything, so no hierarchy; transcripts in mono.
- Contrast: `text-neutral-500/600/700` used 136× as text, all below AA.
- Red meant everything: brand, selection, primary, destructive, error, recording, focus ring, slider.
- GPU cost: three full-screen effect layers, RAF clock in the sidebar, `backdrop-filter` on the widgets
  (removed from the widgets).
- Mini had no recording signal, no paste confirmation and a silent error; Maxi used three font
  families and switched from bars to text when processing. Both are fixed.
- `WidgetPage` thumbnails are hand-drawn SVGs that diverge from the real widgets (still open).
- `UpToDatePopup` is a blocking modal for a 4-second confirmation (still open).

Keep: RAF-driven bar updates, LERP, sticky exit state, hit-zone hack, drag, enter/exit timings;
a11y semantics (`aria-current`, `aria-live`, `role=switch/listbox/dialog`, focus trap, focus-visible);
comparison table, date grouping, inline confirms, two-step key delete, "Whisper raw" section.
