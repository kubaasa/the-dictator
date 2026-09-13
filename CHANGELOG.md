# Changelog

Release notes are kept in plain text so they render correctly in the in-app
update window (electron-updater shows the GitHub release body verbatim — no
Markdown or HTML formatting).

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
