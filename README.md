# The Dictator

Voice dictation desktop app for Windows — transcribe speech to text with a global hotkey, then auto-paste the result into any application.

## Features

- **Global hotkey** — `Ctrl+Shift+Space` starts/stops recording from anywhere (toggle or push-to-talk mode)
- **Dual transcription engines**
  - **Local** — offline Whisper via `@xenova/transformers` (tiny / base / small / medium / large-v3)
  - **API** — OpenAI Whisper API (requires API key)
- **Auto-paste** — after transcription, result is written to clipboard and pasted into the previously focused window via Win32 API (PowerShell + `SendKeys`)
- **Overlay** — always-on-top frameless window showing recording state with a sprite animation
- **Microphone selector** — pick any input device
- **System tray** — app lives in tray, never clutters the taskbar
- **Language support** — auto-detect or pick from 16 languages (Polish, English, German, French, Spanish, and more)
- **Settings persistence** — all settings stored locally via `electron-store`

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 40 + Electron Forge |
| Build | Vite 6 |
| UI | React 19 + Tailwind CSS v4 |
| Hotkeys | uiohook-napi |
| Local transcription | @xenova/transformers (ONNX Whisper) |
| API transcription | openai SDK (whisper-1) |
| Settings | electron-store |
| Language | TypeScript |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Windows 10/11

### Install & run

```bash
npm install
npm start
```

On first launch with the local engine selected, the Whisper model is downloaded from HuggingFace (~150 MB for `base`) and cached for future use.

### Build

```bash
npm run make
```

## Project Structure

```
src/
├── main/
│   ├── main.ts                    # Electron entry — windows, tray, IPC
│   ├── tray.ts                    # System tray manager
│   ├── ipc-handlers.ts            # IPC bridge between main ↔ renderer
│   └── services/
│       ├── audio-recorder.service.ts
│       ├── hotkey.service.ts      # Global hotkey via uiohook-napi
│       ├── paste.service.ts       # Win32 auto-paste via PowerShell
│       └── transcription.service.ts # Local + API Whisper engines
├── preload/
│   └── index.ts                   # contextBridge — exposes window.dictator API
├── renderer/
│   ├── App.tsx                    # Root — main window or overlay (hash routing)
│   ├── components/
│   │   ├── HomePage.tsx           # Recording button + transcription result
│   │   ├── ModesPage.tsx          # Engine/model/language/API key settings
│   │   ├── SettingsPage.tsx       # General app settings
│   │   ├── Sidebar.tsx            # Navigation
│   │   ├── MicrophoneSelector.tsx # Device picker
│   │   ├── OverlayWindow.tsx      # Always-on-top recording indicator
│   │   └── overlay/               # Sprite animation (HitmanHead)
│   └── hooks/                     # useAudioRecorder, useRecordingState, etc.
└── shared/
    ├── types.ts                   # Shared types + AppSettings + DEFAULT_SETTINGS
    └── constants.ts               # IPC channel names
```

## Settings

| Setting | Description |
|---|---|
| Transcription engine | `local` (offline) or `api` (OpenAI) |
| Local model | tiny / base / small / medium / large-v3 |
| Language | Auto-detect or specific language |
| OpenAI API key | Used only for API engine; stored locally |
| Hotkey shortcut | Default: `Ctrl+Shift+Space` |
| Hotkey mode | Toggle (press once) or Push-to-talk (hold) |
| Auto-paste | Automatically paste result after transcription |
| Restore clipboard | Restore original clipboard content after paste |
| Minimize to tray | Close button hides to tray instead of quitting |

## Roadmap

- [ ] AI post-processing — reformat/clean transcription via OpenAI / Anthropic / Ollama
- [ ] Dictation modes — Voice, Message, Email, Chat, Custom (with AI prompt)
- [ ] Vocabulary/custom words
- [ ] Transcription history
- [ ] Full settings UI (hotkey recorder, overlay position)
- [ ] NSIS installer / auto-update

## License

MIT
