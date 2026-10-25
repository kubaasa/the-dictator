# Changelog

Release notes are kept in plain text so they render correctly in the in-app
update window (electron-updater shows the GitHub release body verbatim — no
Markdown or HTML formatting).

## 2.0.1

- Fixed: the widget jumped up or to the side when you dropped it after
  dragging on displays with scaling above 100% (for example 125% or 150%
  on laptops). The widget window also no longer grows a little with every
  move, which made the clickable area drift away from the visible widget.
- Fixed: garbled Groq transcriptions of distorted audio, such as a date and
  a place name that were never said, are rejected with a notification
  instead of being pasted.

## 2.0.0

A new look for the whole app and a more reliable dictation pipeline.

- New: redesigned interface. A calmer dark look with one set of colours,
  red reserved for recording and errors, and lighter, clearer pages:
  Processing as three pipeline steps, History as a day-by-day log with the
  raw Whisper text, Shortcuts, Vocabulary as an editable table, and a
  Widget page with live previews. The setup guide is now a full-window flow.
- New: redesigned widgets. The Mini widget collapses to a thin sliver when
  idle and shows a paste confirmation; the Maxi widget is a capsule with a
  blinking timer, a wider waveform, the pasted text and the shortcuts.
- New: vocabulary entries understand "a | b" alternatives and "word*"
  endings, so replacements survive Polish inflection. The History page
  shows what Whisper actually heard.
- New: automatic microphone selection follows your Bluetooth headset.
- Fixed: pasted text no longer contains <input> or <output> tags, text the
  AI altered beyond the dictation, or subtitle-credit hallucinations at the
  end of a recording.
- Fixed: recordings that ended with empty audio after a Bluetooth mic
  toggle, recordings clipped at the end, and a recording started during
  the previous transcription being lost.
- Fixed: other apps could stay muted after a cancelled recording.
- Fixed: hotkeys could stay "pressed" after locking or waking Windows.
- Fixed: Ctrl+V paste is verified against the target window and the
  clipboard, and failures are reported instead of a false success.

## 1.3.4

- Fixed: auto-paste stopped working in VS Code and Cursor terminals running
  Claude Code (2.1.269 or newer). The app used to send Shift+Insert to
  VS Code-based editors, but their terminals now hand that key to the running
  program instead of pasting once it enables the kitty keyboard protocol. The
  app now sends a regular Ctrl+V everywhere, which VS Code handles itself for
  both the editor and the terminal.

## 1.3.3

- Fixed: sometimes the recording widget did not appear on screen even though
  the start chime played - at random, and often right after a Windows restart.
  The overlay could lose its GPU surface, drift off-screen, fall behind another
  window, or get hidden by a stale timer while recording was still active. The
  widget now reliably re-shows itself when recording starts - including after
  sleep/wake, screen unlock, display changes or a renderer crash. A new "Reset
  Widget Position" option in the tray menu recenters it if it ever ends up
  somewhere you cannot see it.

## 1.3.2

- Fixed: the start and stop recording chimes were silent for some users. While
  muting other apps during recording, The Dictator could end up muting its own
  audio session and leaving it at zero in the Windows Volume Mixer, so the cues
  never played — and it stayed silent even with the mute-others option turned
  off. The app now reliably recognizes its own audio and never mutes itself, so
  the start/stop chimes are audible again.
