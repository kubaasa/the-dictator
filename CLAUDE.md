# The Dictator — Claude Code Instructions

## Project Overview

Windows desktop voice dictation app. Records audio via global hotkey, transcribes with Whisper (local ONNX or OpenAI API), optionally post-processes with AI, then auto-pastes the result into the focused application.

**Stack:** Electron 40 + Vite 6 + React 19 + TypeScript + Tailwind CSS v4
**Package manager:** npm

## Dev Commands

```bash
npm start          # Start in dev mode (Electron Forge + Vite HMR)
npm run lint       # ESLint (TypeScript + import rules)
npm run rebuild    # Rebuild native modules (run after npm install or Node version change)
npm run make       # Build production installer
```

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
- Access in renderer: `window.dictator.settings.get()` / `settings.set()`.

### History
- SQLite via `better-sqlite3`, managed by `src/main/services/history.service.ts`.
- Schema: `RecordingEntry` in `src/shared/types.ts`.

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

**When adding a new native module, two steps are mandatory:**

1. Add to `externals` in `vite.main.config.ts`:
   ```ts
   external: ['uiohook-napi', '@huggingface/transformers', 'onnxruntime-node', ..., 'new-native-module']
   ```

2. Add to `rebuildConfig.onlyModules` in `forge.config.ts` (only for true native C++ addons):
   ```ts
   rebuildConfig: { onlyModules: ['better-sqlite3', 'uiohook-napi', 'new-native-module'] }
   ```

Skipping either step will cause the production build to fail or crash at runtime.

## Do NOT

- `require()` anything in renderer — it's sandboxed, no Node.js access
- Define IPC channel names as raw strings anywhere except `src/shared/constants.ts`
- Bundle native modules — they must always be in `vite.main.config.ts` externals
- Use `tsc` to check for type errors in `node_modules` — run `tsc --noEmit` only; pre-existing errors in `node_modules` type definitions are a known version conflict, ignore them
