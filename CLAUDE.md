# The Dictator — Claude Code Instructions

## Project Overview

Windows desktop voice dictation app. Records audio via global hotkey, transcribes with Whisper (local ONNX, or cloud via OpenAI / Groq API), optionally post-processes with AI (OpenAI / Anthropic), then auto-pastes the result into the focused application.

**Stack:** Electron 45 + Vite 6 + React 19 + TypeScript 4.5 + Tailwind CSS v4, plus a C# (.NET 8) helper that mutes other apps while recording
**Package manager:** npm

## Dev Commands

```bash
npm run dev           # Start in dev mode (custom Vite dev script + HMR)
npm run build         # Build all contexts (renderer → main → preload)
npm run build:helper  # Publish the audio-mute helper (requires .NET 8 SDK)
npm run dist          # build:helper + build + create NSIS installer
npm run publish       # build:helper + build + create installer + publish to GitHub
npm run lint          # ESLint (TypeScript + import rules)
```

There is no native rebuild step: every native module ships N-API prebuilds that work across Node and Electron versions, and `npmRebuild: false` in `electron-builder.yml` keeps packaging from compiling them.

There is no automated test suite.

### Type checking

`npx tsc --noEmit` with the project's TypeScript 4.5 does **not** type-check `src/`: it fails to parse newer `@types/node`, and tsc skips semantic checks entirely when there are syntax errors. `npm run build` doesn't type-check either (esbuild only strips types). Until TypeScript is upgraded, type-check with a newer compiler from the npx cache:

```bash
npx -y -p typescript@5.9.3 tsc --noEmit
```

`Property 'get'/'set'/'store' does not exist on type 'ElectronStore<AppSettings>'` errors are noise (`moduleResolution: "node"` can't resolve electron-store 11's ESM types). Treat every other error as real.

## Build System

**electron-builder** with NSIS target (replaced Electron Forge in v1.2.0).

- Config: `electron-builder.yml`. Its `files` list is an allowlist (`dist/main`, `dist/renderer`, `package.json`) plus exclusions for source maps, the transformers model cache, `onnxruntime-web` and native binaries for other platforms. A new dependency that ships per-platform binaries needs its own exclusion there.
- Dev script: `scripts/dev.mjs` (Vite dev server + Electron watch/restart)
- Security fuses: `scripts/after-pack.js` (flipped after packaging). `strictlyRequireAllFuses` is on, so a new Electron fuse must be listed there or packaging fails. `@electron/fuses` 2.x is ESM-only, hence the dynamic `import()`.
- Custom NSIS pages: `assets/installer.nsh` (desktop shortcut + auto-start options)
- Installer images: `assets/nsis-header.bmp`, `assets/nsis-sidebar.bmp` (generate via `node scripts/generate-installer-images.js`)
- `postinstall` runs `scripts/patch-electron-icon.js`, which swaps the icon of the dev Electron binary so the taskbar shows the app icon in `npm run dev`. It resolves the binary through `require('electron')`, which also downloads it: since Electron 42 the `electron` package no longer downloads the binary on install.
- Audio-mute helper: `tools/audio-mute-helper/` (C# .NET 8, NAudio.Wasapi, self-contained). `build:helper` publishes it to `bin/Release/net8.0-windows/win-x64/publish/`, which `extraResources` copies to `resources/audio-mute-helper/`. `PublishSingleFile` is intentionally `false`: AV software (AVG CyberCapture) flags self-extracting single-file bundles and blocks the spawn long enough for it to time out.

## Architecture

The app runs in **three isolated Electron contexts** — each has different capabilities:

| Context | Entry point | Can use Node.js? | Role |
|---|---|---|---|
| `main` | `src/main/main.ts` | Yes (full) | Services, IPC, windows, tray |
| `preload` | `src/preload/preload.ts` | Limited | Bridge between main ↔ renderer |
| `renderer` | `src/renderer/` | **No** (sandboxed) | React UI only |

### Renderer is sandboxed — critical implications
- **Never use `require()` in renderer code.** It will throw at runtime.
- All communication with main process goes through `window.dictator.*` (exposed via `contextBridge` in preload).
- `window.dictator` API is typed in `src/renderer/global.d.ts`.
- Session permissions are an allowlist in `src/main/main.ts` (`ALLOWED_PERMISSIONS`: `media` without video, `clipboard-sanitized-write`), granted only to the app's own windows. A feature that needs another Chromium permission must be added there; a denial is logged once per session as `Permission denied: <name>`.
- CSP is a `<meta>` tag injected at build time by `cspMeta` in `vite.renderer.config.ts`; the dev server runs without it. A violation is logged to `main.log` as `CSP violation: <directive> blocked <uri>`.
- Navigation, `window.open` and `<webview>` are blocked for every `webContents` (`web-contents-created` in `main.ts`). The dev server URL is honoured only when `!app.isPackaged`.

### IPC — single source of truth
- All IPC channel names are defined **only** in `src/shared/constants.ts` (the `IPC` object).
- Never hardcode channel strings inline — always import from constants.
- `src/shared/types.ts` and `src/shared/constants.ts` are imported by both main and renderer.

### Overlay window
- A second `BrowserWindow` (frameless, transparent, always-on-top) loads the same renderer entry point on the `#overlay` hash route.
- Routing is handled in `src/renderer/App.tsx` based on `window.location.hash`.

### Service pattern
Adding new functionality to main process:
1. Create service in `src/main/services/`
2. Register IPC handlers in `src/main/ipc-handlers.ts`
3. Expose method through `contextBridge` in `src/preload/preload.ts`
4. Add type signature to `DictatorAPI` in `src/renderer/global.d.ts`

### Settings
- Persisted via `electron-store`. Schema defined by `AppSettings` in `src/shared/types.ts`.
- Defaults in `DEFAULT_SETTINGS` (same file).
- Access in renderer: `window.dictator.getSettings()` / `setSettings()`.
- Legacy settings shapes are migrated in the `SETTINGS_GET` handler (`src/main/ipc-handlers.ts`). When renaming or removing a field, update `AppSettings`, `DEFAULT_SETTINGS` **and** the migration.
- API keys are encrypted with `safeStorage` (`src/main/services/secure-storage.ts`); the rest of the store is plain JSON. The synchronous `safeStorage` calls used there are deprecated in Electron 45 and removed in 46: move to `encryptStringAsync` / `decryptStringAsync` before the next major upgrade.
- Key material never leaves the main process. The renderer gets `RendererSettings`: no key fields, only `apiKeys` with `set` / `hint` / `length` per provider. `SETTINGS_SET` drops key fields from the patch; keys are written only through `API_KEY_SAVE` (validates, then stores) and `API_KEY_DELETE`.

### History
- SQLite via `better-sqlite3`, managed by `src/main/services/history.service.ts`.
- Schema: `RecordingEntry` in `src/shared/types.ts`.

### Paste flow
- `src/main/services/paste.service.ts` keeps a persistent PowerShell process with precompiled Win32 interop (`SendInput`). PowerShell is started by absolute path (`POWERSHELL_EXE` under `%SystemRoot%\System32`) with `cwd` set to System32, never by bare name.
- Call `captureTarget()` **before** any Electron UI work (state broadcast, clipboard, window show) — those can shift OS focus away from the target app.
- Before history, overlay and clipboard, the final text passes `stripUnsafeChars` (`src/main/services/paste-text.ts`): control characters other than tab and line breaks, and bidi overrides, are removed (an ESC sequence can end a terminal's bracketed paste). For classic console windows (conhost, PuTTY, mintty, ConEmu) the clipboard copy also gets line breaks collapsed to spaces, because each pasted line would run as a command; Windows Terminal and VS Code terminals keep line breaks.
- Electron's `clipboard` module is async since v44: `writeText` / `readText` return Promises and must be awaited (`writeClipboardVerified` in `ipc-handlers.ts`).
- Paste = write text to clipboard + send Ctrl+V. Always Ctrl+V, no per-app shortcuts: Shift+Insert broke VS Code / Cursor terminals that enable the kitty keyboard protocol (v1.3.4). The previous clipboard content is not restored.

### Audio mute helper
- `src/main/services/audio-mute.service.ts` spawns `audio-mute-helper.exe` and talks to it via JSON lines over stdin/stdout. If the helper doesn't report `ready` within 5 s, the feature disables itself.
- The app's own audio sessions are excluded by **executable path** (`QueryFullProcessImageName`), not by PID tree — PID matching raced with lazily spawned Electron audio processes and muted the app's own chimes (v1.3.2).
- The pre-mute volume snapshot is persisted in `audio.muteSnapshot` and restored on next start after a crash.

### Logging & Sentry
- `src/main/services/logger.ts` (`electron-log`) writes to `%APPDATA%\The Dictator\logs\main.log`. Renderer logs (`electron-log/renderer`) end up in the same file. Use scoped loggers: `logger.scope('Name')`.
- A log hook masks API keys (`sk-proj-`, `sk-ant-`, `gsk_`). Add the prefix there when integrating a new provider.
- `log.error` is forwarded to Sentry (`src/main/services/sentry.ts`), enabled only in packaged builds. Only `warn` and `error` lines become Sentry breadcrumbs.
- Dictated text, vocabulary rules and history search queries are logged through `dictatedText()` (`logger.ts`), which prints `<N chars>` unless `general.diagnosticLogging` is `true`. The setting has no UI: set it in `%APPDATA%\The Dictator\config.json` when investigating transcription problems.
- Nothing loads `.env` into `process.env` (no dotenv, and Vite doesn't do it for its config). `SENTRY_DSN` is read at runtime and `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` at build time (sourcemap upload, plugin disabled without a token), so all of them must come from the shell environment. As a result, packaged builds currently run without a DSN.

## Native Modules — Critical Rules

The following packages are **native modules** or large non-bundleable packages. They must stay outside Vite's bundle:

| Package | Reason |
|---|---|
| `uiohook-napi` | Native C++ addon (global hotkeys) |
| `better-sqlite3` | Native N-API addon (SQLite), pinned to 13.0.3; prebuilds for other platforms are excluded in `electron-builder.yml` |
| `@huggingface/transformers` | ML pipeline library, must stay external |
| `onnxruntime-node` | Native ONNX runtime with DirectML GPU support |
| `openai` | Must be loaded at runtime in main process |
| `@anthropic-ai/sdk` | Must be loaded at runtime in main process |
| `electron-updater` | Electron-integrated, must be loaded at runtime |
| `electron-log` | Electron-integrated (also `electron-log/main`) |
| `@sentry/electron` | Electron-integrated (also `@sentry/electron/main`) |

**When adding a new native module, two steps are mandatory:**

1. Add to `external` array in `vite.main.config.ts` → `build.rollupOptions.external`:
   ```ts
   external: ['uiohook-napi', '@huggingface/transformers', 'onnxruntime-node', ..., 'new-native-module']
   ```

2. If it contains native `.node` addons, add to `asarUnpack` in `electron-builder.yml` (catch-all `**/*.node` and `**/*.dll` globs exist, but list the package explicitly):
   ```yaml
   asarUnpack:
     - "node_modules/new-native-module/**"
   ```

Skipping either step will cause the production build to fail or crash at runtime.

## Release Process

Work happens on `develop`; `main` is fast-forwarded from `develop` on release. The `staging` branch is unused.

1. Bump `version` in `package.json` and `package-lock.json`
2. Add a plain-text, user-facing entry to `CHANGELOG.md`
3. Commit: `release: vX.Y.Z - <short summary>`
4. Fast-forward `main` to `develop` and push both
5. `npm run publish` (electron-builder creates the GitHub release; needs `GH_TOKEN`). Set the token for that one command only, never as a persistent user variable, because every npm lifecycle script would inherit it: `$env:GH_TOKEN = (gh auth token); npm run publish; Remove-Item Env:GH_TOKEN`
6. Set release notes as plain text or simple Markdown (`gh release edit vX.Y.Z --notes "..."`), one bullet per line. electron-updater reads the notes from GitHub's Atom feed, where the body is already rendered to HTML; `UpdateService.releaseNotesToText` strips that HTML to plain lines, so the update window shows one list item per bullet and nothing else (no headings, links or nested lists).

## Conventions

- Conventional Commits (`feat:`, `fix(paste):`, `refactor:`, …); release commits use `release: vX.Y.Z - <summary>`.
- No TODO / FIXME / XXX / HACK comments — ESLint `no-warning-comments` flags them.
- Comment only what the code can't say itself (Win32 interop, timing, workarounds and why they exist).

## Do NOT

- `require()` anything in renderer — it's sandboxed, no Node.js access
- Define IPC channel names as raw strings anywhere except `src/shared/constants.ts`
- Bundle native modules — they must always be in `vite.main.config.ts` externals
- Send API key material to the renderer, or accept it through `SETTINGS_SET`
- Log dictated text directly: wrap it in `dictatedText()`
- Trust `tsc --noEmit` with the project's TypeScript — "no errors in `src`" means `src` wasn't checked (see Type checking)
- Re-enable `PublishSingleFile` for the audio-mute helper without code signing in place
- Use `gh release create --generate-notes` or HTML in release notes
