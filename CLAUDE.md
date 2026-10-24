# The Dictator — Claude Code Instructions

## Project Overview

Windows desktop voice dictation app. Records audio via global hotkey, transcribes with Whisper (local ONNX, or cloud via OpenAI / Groq API), optionally post-processes with AI (OpenAI / Anthropic), then auto-pastes the result into the focused application.

**Stack:** Electron 40 + Vite 6 + React 19 + TypeScript 4.5 + Tailwind CSS v4, plus a C# (.NET 8) helper that mutes other apps while recording
**Package manager:** npm

## Dev Commands

```bash
npm run dev           # Start in dev mode (custom Vite dev script + HMR)
npm run build         # Build all contexts (renderer → main → preload)
npm run build:helper  # Publish the audio-mute helper (requires .NET 8 SDK)
npm run dist          # build:helper + build + create NSIS installer
npm run publish       # build:helper + build + create installer + publish to GitHub
npm run lint          # ESLint (TypeScript + import rules)
npm run rebuild       # Rebuild native modules (run after npm install or Node version change)
```

There is no automated test suite.

### Type checking

`npx tsc --noEmit` with the project's TypeScript 4.5 does **not** type-check `src/`: it fails to parse newer `@types/node`, and tsc skips semantic checks entirely when there are syntax errors. `npm run build` doesn't type-check either (esbuild only strips types). Until TypeScript is upgraded, type-check with a newer compiler from the npx cache:

```bash
npx -y -p typescript@5.9.3 tsc --noEmit
```

`Property 'get'/'set'/'store' does not exist on type 'ElectronStore<AppSettings>'` errors are noise (`moduleResolution: "node"` can't resolve electron-store 11's ESM types). Treat every other error as real.

## Build System

**electron-builder** with NSIS target (replaced Electron Forge in v1.2.0).

- Config: `electron-builder.yml`
- Dev script: `scripts/dev.mjs` (Vite dev server + Electron watch/restart)
- Security fuses: `scripts/after-pack.js` (flipped after packaging)
- Custom NSIS pages: `assets/installer.nsh` (desktop shortcut + auto-start options)
- Installer images: `assets/nsis-header.bmp`, `assets/nsis-sidebar.bmp` (generate via `node scripts/generate-installer-images.js`)
- `postinstall` runs `scripts/patch-electron-icon.js`, which swaps the icon of the dev Electron binary so the taskbar shows the app icon in `npm run dev`
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
- API keys are encrypted with `safeStorage` (`src/main/services/secure-storage.ts`); the rest of the store is plain JSON.

### History
- SQLite via `better-sqlite3`, managed by `src/main/services/history.service.ts`.
- Schema: `RecordingEntry` in `src/shared/types.ts`.

### Paste flow
- `src/main/services/paste.service.ts` keeps a persistent PowerShell process with precompiled Win32 interop (`SendInput`).
- Call `captureTarget()` **before** any Electron UI work (state broadcast, clipboard, window show) — those can shift OS focus away from the target app.
- Paste = write text to clipboard + send Ctrl+V. Always Ctrl+V, no per-app shortcuts: Shift+Insert broke VS Code / Cursor terminals that enable the kitty keyboard protocol (v1.3.4). The previous clipboard content is not restored.

### Audio mute helper
- `src/main/services/audio-mute.service.ts` spawns `audio-mute-helper.exe` and talks to it via JSON lines over stdin/stdout. If the helper doesn't report `ready` within 5 s, the feature disables itself.
- The app's own audio sessions are excluded by **executable path** (`QueryFullProcessImageName`), not by PID tree — PID matching raced with lazily spawned Electron audio processes and muted the app's own chimes (v1.3.2).
- The pre-mute volume snapshot is persisted in `audio.muteSnapshot` and restored on next start after a crash.

### Logging & Sentry
- `src/main/services/logger.ts` (`electron-log`) writes to `%APPDATA%\The Dictator\logs\main.log`. Renderer logs (`electron-log/renderer`) end up in the same file. Use scoped loggers: `logger.scope('Name')`.
- A log hook masks API keys (`sk-proj-`, `sk-ant-`, `gsk_`). Add the prefix there when integrating a new provider.
- `log.error` is forwarded to Sentry (`src/main/services/sentry.ts`), enabled only in packaged builds.
- Nothing loads `.env` into `process.env` (no dotenv, and Vite doesn't do it for its config). `SENTRY_DSN` is read at runtime and `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` at build time (sourcemap upload, plugin disabled without a token), so all of them must come from the shell environment. As a result, packaged builds currently run without a DSN.

## Native Modules — Critical Rules

The following packages are **native modules** or large non-bundleable packages. They must stay outside Vite's bundle:

| Package | Reason |
|---|---|
| `uiohook-napi` | Native C++ addon (global hotkeys) |
| `better-sqlite3` | Native C++ addon (SQLite) |
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
5. `npm run publish` (electron-builder creates the GitHub release; needs `GH_TOKEN`)
6. Set release notes as plain text or simple Markdown (`gh release edit vX.Y.Z --notes "..."`). electron-updater shows the release body verbatim in the update window, so any HTML tags leak into the UI.

## Conventions

- Conventional Commits (`feat:`, `fix(paste):`, `refactor:`, …); release commits use `release: vX.Y.Z - <summary>`.
- No TODO / FIXME / XXX / HACK comments — ESLint `no-warning-comments` flags them.
- Comment only what the code can't say itself (Win32 interop, timing, workarounds and why they exist).

## Do NOT

- `require()` anything in renderer — it's sandboxed, no Node.js access
- Define IPC channel names as raw strings anywhere except `src/shared/constants.ts`
- Bundle native modules — they must always be in `vite.main.config.ts` externals
- Trust `tsc --noEmit` with the project's TypeScript — "no errors in `src`" means `src` wasn't checked (see Type checking)
- Re-enable `PublishSingleFile` for the audio-mute helper without code signing in place
- Use `gh release create --generate-notes` or HTML in release notes
