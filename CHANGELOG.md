# Changelog

Release notes are kept in plain text so they render correctly in the in-app
update window (electron-updater shows the GitHub release body verbatim — no
Markdown or HTML formatting).

## 3.0.0

A hardened and lighter build on a newer engine.

- New: the app runs on Electron 45 (up from 40), with the security fixes
  of the newer Chromium.
- New: the installer is about half the size, 178 MB instead of 360 MB.
- New: a redesigned update window that lists the changes as numbered
  points.
- Security: API keys stay inside the app's background process. The
  settings window only knows whether a key is set and how it starts.
- Security: the app's windows can use only the microphone and the
  clipboard, cannot open other pages, and take commands only from the app
  itself.
- Security: pasted text is cleaned of invisible control characters. In
  classic console windows (cmd, PowerShell console, PuTTY, Git Bash) line
  breaks are pasted as spaces, so a dictation cannot run as several
  commands.
- Privacy: dictated text is no longer written to the log file.
- Fixed: "Dziękuję." added at the end of recordings longer than 30 seconds
  that ended with a pause.
- Fixed: a greeting such as "Dzień dobry." pasted when nothing was said.
- Fixed: short commands such as "commit" were sometimes rejected as
  unclear.
- Fixed: pasting is faster. The fixed quarter-second wait before Ctrl+V is
  gone.
- Fixed: an update no longer turns auto-start back on after you switched
  it off.
- Fixed: Call Mode switched during a recording was not saved.
- Fixed: a long AI reply with many line breaks could freeze the app for
  several seconds.

## 2.0.2

- Fixed: a Bluetooth headset microphone that delivered only silence after
  the recording started (the widget showed no signal even though you were
  speaking) is now reopened automatically within a few seconds, up to two
  times, without interrupting the recording. Previously you had to cancel
  with Escape and start again.
- Fixed: the first launch right after installing an update could stay a
  blank window. The app now restarts itself once when that happens.
- Fixed: the update window showed raw HTML tags in the release notes. Notes
  are now shown as a plain list.

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
