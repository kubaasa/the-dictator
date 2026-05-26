# Changelog

Release notes are kept in plain text so they render correctly in the in-app
update window (electron-updater shows the GitHub release body verbatim — no
Markdown or HTML formatting).

## 1.3.2

- Fixed: the start and stop recording chimes were silent for some users. While
  muting other apps during recording, The Dictator could end up muting its own
  audio session and leaving it at zero in the Windows Volume Mixer, so the cues
  never played — and it stayed silent even with the mute-others option turned
  off. The app now reliably recognizes its own audio and never mutes itself, so
  the start/stop chimes are audible again.
