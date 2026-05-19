import { app, BrowserWindow, ipcMain, protocol, screen, session, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import Store from 'electron-store';
import { initSentry } from './services/sentry';
import log from './services/logger';

initSentry();
import { TrayManager } from './tray';
import { HotkeyService } from './services/hotkey.service';
import { TranscriptionService } from './services/transcription.service';
import { HistoryService } from './services/history.service';
import { UpdateService } from './services/update.service';
import { migrateApiKeys, decryptSettingsForRenderer } from './services/secure-storage';
import { registerIpcHandlers, getOverlaySize, clampToVisibleArea } from './ipc-handlers';
import { getAssetPath } from './paths';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { DEFAULT_SETTINGS, type AppSettings, type RecordingState } from '../shared/types';
import { IPC } from '../shared/constants';

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection:', reason);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.setAppUserModelId('com.jakubbruniecki.the-dictator');

// Fix GPU/disk cache "Access Denied" errors on Windows
app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('userData'), 'Cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Bypass Chromium's internal permission system for camera/microphone capture.
// In packaged builds (file:// origin), Chromium 134 may reject getUserMedia with AbortError
// even when Electron permission handlers grant access — this switch ensures the internal
// permission gate is skipped entirely. Safe because this is a standalone desktop app.
app.commandLine.appendSwitch('auto-accept-camera-and-microphone-capture');

protocol.registerSchemesAsPrivileged([
  { scheme: 'recording', privileges: { stream: true, supportFetchAPI: true } },
]);

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS });

// Migrate legacy engine values ('api' | 'groq') → 'cloud'
const legacyEngine = store.get('transcription.engine') as string;
if (legacyEngine === 'api' || legacyEngine === 'groq') {
  store.set('transcription.engine', 'cloud');
}

function syncAutoStart(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ['--autostart'],
  });
}

const trayManager = new TrayManager();
const transcriptionService = new TranscriptionService(store);
const pasteService = new PasteService();
const aiService = new AIService(store);
const updateService = new UpdateService(getAssetPath('icon.png'));

function sendToggleToRenderer(): void {
  if (mainWindow) {
    mainWindow.webContents.send(IPC.HOTKEY_TOGGLE);
  }
}

function sendCancelToRenderer(): void {
  if (mainWindow) {
    mainWindow.webContents.send(IPC.HOTKEY_CANCEL);
  }
}

function showOrHideMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

let isQuitting = false;
let isPostInstallLaunch = false;
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentState: RecordingState = 'idle';
let overlayHideTimeout: ReturnType<typeof setTimeout> | null = null;
let historyService: HistoryService | null = null;
let pttSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

const hotkeyService = new HotkeyService(
  () => {
    if (pttSafetyTimeout) { clearTimeout(pttSafetyTimeout); pttSafetyTimeout = null; }
    broadcastState('initializing');
    sendToggleToRenderer();
  },
  () => {
    sendToggleToRenderer();
    // Safety net: if state is still non-idle after all timeouts expire,
    // force reset. Normal flow should never hit this — covers edge cases
    // where renderer/IPC chain breaks silently.
    if (pttSafetyTimeout) clearTimeout(pttSafetyTimeout);
    pttSafetyTimeout = setTimeout(() => {
      if (currentState !== 'idle') {
        log.warn('PTT safety timeout: forcing idle from state "%s"', currentState);
        broadcastState('idle');
        hotkeyService.notifyRecordingStopped();
      }
      pttSafetyTimeout = null;
    }, 65_000);
  },
);

const BASE_WIDTH = 1200;
const BASE_HEIGHT = 840;
const WINDOW_MARGIN = 40;

function calcWindowBounds(): { width: number; height: number; x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  const maxW = workArea.width - WINDOW_MARGIN * 2;
  const maxH = workArea.height - WINDOW_MARGIN * 2;

  let w = BASE_WIDTH;
  let h = BASE_HEIGHT;

  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / BASE_WIDTH, maxH / BASE_HEIGHT);
    w = Math.round(BASE_WIDTH * scale);
    h = Math.round(BASE_HEIGHT * scale);
  }

  const x = Math.round(workArea.x + (workArea.width - w) / 2);
  const y = Math.round(workArea.y + (workArea.height - h) / 2);

  return { width: w, height: h, x, y };
}

function createMainWindow(): BrowserWindow {
  const bounds = calcWindowBounds();

  const win = new BrowserWindow({
    ...bounds,
    resizable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    title: 'The Dictator',
    icon: getAssetPath('icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.webContents.setBackgroundThrottling(false);

  win.once('ready-to-show', () => {
    const firstRun = !(store.get('general.firstRunComplete') as boolean);
    if (firstRun || isPostInstallLaunch) {
      win.show();
      // Bypass Windows focus-stealing prevention when launched from NSIS finish page
      win.setAlwaysOnTop(true);
      win.focus();
      win.setAlwaysOnTop(false);
    }
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createOverlayWindow(): BrowserWindow {
  const widget = store.get('widget') ?? DEFAULT_SETTINGS.widget;
  const [initW, initH] = getOverlaySize(widget.activeWidget);

  const win = new BrowserWindow({
    width: initW,
    height: initH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: widget.activeWidget !== 'maxi',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Cue chimes (useSoundFeedback) run in this window — the maxi widget starts hidden,
      // so AudioContext can land in 'suspended' without a prior user gesture
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Restore last saved position or default to top-right corner,
  // always clamped to a visible display (handles disconnected monitors)
  const savedX = store.get('widget.x') as number | undefined;
  const savedY = store.get('widget.y') as number | undefined;
  if (savedX !== undefined && savedY !== undefined) {
    const clamped = clampToVisibleArea(savedX, savedY, initW, initH);
    win.setPosition(clamped.x, clamped.y);
  } else {
    const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
    win.setPosition(screenW - initW - 20, 20);
  }

  win.on('moved', () => {
    const { x, y } = win.getBounds();
    store.set('widget.x', x);
    store.set('widget.y', y);
  });

  // Blur immediately on focus so the overlay never steals focus from other apps
  win.on('focus', () => win.blur());

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#overlay`);
  } else {
    win.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      { hash: 'overlay' },
    );
  }

  return win;
}

function broadcastState(state: RecordingState): void {
  if (currentState !== state) {
    log.info('state: %s -> %s', currentState, state);
  }
  currentState = state;
  if (state === 'idle' && pttSafetyTimeout) {
    clearTimeout(pttSafetyTimeout);
    pttSafetyTimeout = null;
  }
  trayManager.updateRecordingState(state);

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IPC.RECORDING_STATE_CHANGED, state);
    } catch {
      // Window webContents may have been destroyed between getAllWindows() and send()
    }
  }

  // Maxi widget: visible for all active states, hidden only on idle
  const activeWidget = (store.get('widget') ?? DEFAULT_SETTINGS.widget).activeWidget;
  if (activeWidget === 'maxi' && overlayWindow) {
    if (state === 'idle') {
      if (overlayHideTimeout) { clearTimeout(overlayHideTimeout); overlayHideTimeout = null; }
      if (overlayWindow.isVisible()) {
        overlayHideTimeout = setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
          overlayHideTimeout = null;
        }, 350);
      }
    } else {
      if (overlayHideTimeout) { clearTimeout(overlayHideTimeout); overlayHideTimeout = null; }
      // Re-clamp position and force show unconditionally — guards against cases where
      // isVisible() reports true but the window is on a stale display or its GPU
      // compositor froze after a display config change.
      const { x, y, width, height } = overlayWindow.getBounds();
      const clamped = clampToVisibleArea(x, y, width, height);
      if (clamped.x !== x || clamped.y !== y) {
        overlayWindow.setPosition(clamped.x, clamped.y);
        store.set('widget.x', clamped.x);
        store.set('widget.y', clamped.y);
      }
      overlayWindow.showInactive();
    }
  }
}

function setupRecordingIpc(): void {
  ipcMain.on(IPC.RECORDING_INIT, () => {
    if (currentState === 'initializing' || currentState === 'recording') return;
    // Sync HotkeyService for non-hotkey sources (overlay button, main window button)
    // so keyboard shortcuts can correctly stop the recording
    hotkeyService.notifyRecordingStarted();
    broadcastState('initializing');
  });

  ipcMain.on(IPC.RECORDING_START, () => {
    broadcastState('recording');
  });

  ipcMain.on(IPC.RECORDING_STOP, (_event, goIdle = true) => {
    if (goIdle) {
      broadcastState('idle');
    } else {
      // Audio exists — transition to 'transcribing' immediately so the overlay
      // releases its mic stream right away (instead of waiting for transcribeBuffer IPC).
      broadcastState('transcribing');
    }
    hotkeyService.notifyRecordingStopped();
  });

  ipcMain.on(IPC.RECORDING_MIC_ERROR, (_event, errorMessage: string) => {
    broadcastState('error');
    hotkeyService.notifyRecordingStopped();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send(IPC.TRANSCRIPTION_ERROR, errorMessage);
    }
    setTimeout(() => {
      if (currentState === 'error') broadcastState('idle');
    }, 2500);
  });

  ipcMain.on(IPC.VOICE_ACTIVITY, (_, level: number, bands?: number[]) => {
    overlayWindow?.webContents.send(IPC.VOICE_ACTIVITY, level, bands);
  });

  ipcMain.handle(IPC.RECORDING_STATE_CHANGED, () => {
    return currentState;
  });

  ipcMain.on(IPC.OVERLAY_TOGGLE, () => {
    sendToggleToRenderer();
  });

  ipcMain.on(IPC.OVERLAY_CANCEL, () => {
    sendCancelToRenderer();
  });
}

function setupMicPermissionIpc(): void {
  ipcMain.handle(IPC.MIC_CHECK_SYSTEM_PERMISSION, () => {
    return systemPreferences.getMediaAccessStatus('microphone');
  });
}

function setupWindowControlIpc(): void {
  ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize());
  ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.hide());
  ipcMain.on(IPC.APP_QUIT, () => app.quit());
  ipcMain.on(IPC.APP_SHOW_SETTINGS, () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('ready', () => {
  // CSP headers — only in production (strict CSP breaks Vite dev server HMR)
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' recording:; img-src 'self' data:",
          ],
        },
      });
    });
  }

  // Auto-grant all permissions (standalone desktop app — only loads our own renderer code).
  // Three layers needed for full coverage: synchronous check, async request, device access.
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });
  session.defaultSession.setDevicePermissionHandler(() => true);

  // Resolve recordings directory early so the protocol handler can validate paths.
  const recordingsDir = path.resolve(path.join(app.getPath('userData'), 'recordings'));

  // Serve local audio files via recording:// with proper Range request support.
  // The HTML5 audio element requires Range responses (HTTP 206) for buffering/seeking.
  // Uses streaming (fs.createReadStream) instead of loading entire file into memory —
  // buffer-based Response hangs in Electron's custom protocol for files over ~1 MB.
  protocol.handle('recording', async (request) => {
    const filePath = decodeURIComponent(request.url.replace('recording:///', ''));

    // Prevent path traversal — only serve files inside the recordings directory.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(recordingsDir + path.sep) && resolved !== recordingsDir) {
      log.warn('recording:// blocked path traversal attempt:', filePath);
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stat = await fs.promises.stat(filePath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;
          const stream = fs.createReadStream(filePath, { start, end });
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': 'audio/webm',
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(chunkSize),
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': 'audio/webm',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      log.error('recording:// protocol error for', filePath, err);
      return new Response('Not found', { status: 404 });
    }
  });

  // Detect first launch after installation (marker created by NSIS installer)
  const installMarkerPath = path.join(app.getPath('userData'), '.install-marker');
  try {
    if (fs.existsSync(installMarkerPath)) {
      fs.unlinkSync(installMarkerPath);
      isPostInstallLaunch = true;
      log.info('Post-install launch detected — will show main window');
    }
  } catch (err) {
    log.warn('Failed to check/remove install marker:', err);
  }

  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();

  fs.mkdirSync(recordingsDir, { recursive: true });
  historyService = new HistoryService(path.join(app.getPath('userData'), 'history.db'));
  historyService.setRecordingsDir(recordingsDir);

  migrateApiKeys(store);

  // Bidirectional sync: adopt the OS auto-start state into the store so the
  // UI toggle stays consistent with what the NSIS installer (or the user via
  // Windows settings) has configured.
  const systemAutoStart = app.getLoginItemSettings({ args: ['--autostart'] }).openAtLogin;
  const storeAutoStart = store.get('general.autoStart') as boolean;
  if (systemAutoStart !== storeAutoStart) {
    store.set('general.autoStart', systemAutoStart);
  }

  const autoStartEnabled = store.get('general.autoStart') as boolean;
  syncAutoStart(autoStartEnabled);

  const launchedAtStartup = process.argv.includes('--autostart');
  if (launchedAtStartup) {
    log.info('Launched at Windows startup — starting minimized to tray');
  }

  trayManager.create(mainWindow, {
    onCheckForUpdates: () => updateService.checkForUpdates(true),
    onInstallUpdate: () => updateService.quitAndInstall(),
    onAutoStartToggle: (enabled) => {
      store.set('general.autoStart', enabled);
      syncAutoStart(enabled);
      const decrypted = decryptSettingsForRenderer(store.store);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.SETTINGS_ON_CHANGE, decrypted);
      }
    },
    onAudioCuesToggle: (enabled) => {
      store.set('audio.soundEnabled', enabled);
      const decrypted = decryptSettingsForRenderer(store.store);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.SETTINGS_ON_CHANGE, decrypted);
      }
    },
  });
  trayManager.setAutoStart(autoStartEnabled);
  trayManager.setAudioCues(store.get('audio.soundEnabled') as boolean);

  updateService.onStatusChange((state) => {
    trayManager.setUpdateState(state);
    if (mainWindow && !mainWindow.isVisible()) {
      // Force-show the window so the ForceUpdateModal is visible
      if (state.status === 'downloaded') {
        mainWindow.show();
        mainWindow.focus();
      }
      if (state.status === 'up-to-date' && state.manual) {
        mainWindow.show();
        mainWindow.focus();
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.UPDATE_STATUS_CHANGED, state);
    }
  });

  registerIpcHandlers(store, transcriptionService, broadcastState, pasteService, aiService, hotkeyService, () => overlayWindow, historyService, () => currentState, updateService, (enabled) => {
    syncAutoStart(enabled);
    trayManager.setAutoStart(enabled);
  }, (enabled) => {
    trayManager.setAudioCues(enabled);
  });

  updateService.start();
  setupRecordingIpc();
  setupMicPermissionIpc();
  setupWindowControlIpc();

  const hotkey = store.get('hotkey');
  const shortcuts = { ...DEFAULT_SETTINGS.hotkey.shortcuts, ...(hotkey?.shortcuts ?? {}) };
  const mode = hotkey?.mode ?? DEFAULT_SETTINGS.hotkey.mode;
  hotkeyService.start(shortcuts, mode, {
    onCancel: sendCancelToRenderer,
    onShowWindow: showOrHideMainWindow,
  });

  // When a monitor is disconnected or resolution changes, re-clamp the overlay widget.
  // On display-removed: center on primary display (old position is meaningless).
  // On display-metrics-changed / display-added: clamp to nearest visible area (same display, just resized).
  const reclampOverlay = (center: boolean) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const { x, y, width, height } = overlayWindow.getBounds();

    if (center) {
      const primary = screen.getPrimaryDisplay().workArea;
      const cx = Math.round(primary.x + (primary.width - width) / 2);
      const cy = Math.round(primary.y + (primary.height - height) / 2);
      overlayWindow.setPosition(cx, cy);
      store.set('widget.x', cx);
      store.set('widget.y', cy);
    } else {
      const clamped = clampToVisibleArea(x, y, width, height);
      if (clamped.x !== x || clamped.y !== y) {
        overlayWindow.setPosition(clamped.x, clamped.y);
        store.set('widget.x', clamped.x);
        store.set('widget.y', clamped.y);
      }
    }
  };
  const reclampMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = calcWindowBounds();
    mainWindow.setBounds(bounds);
  };

  // Force overlay renderer to recover its GPU compositor after a display config change.
  // Transparent always-on-top windows on Windows can silently lose their GPU context on
  // monitor disconnect/sleep, leaving webContents alive but the surface blank. A hide/show
  // cycle (only when widget should currently be visible) forces re-composition.
  const recoverOverlayCompositor = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.invalidate();
    const activeWidget = (store.get('widget') ?? DEFAULT_SETTINGS.widget).activeWidget;
    const shouldBeVisible = activeWidget === 'voicebar' || currentState !== 'idle';
    if (shouldBeVisible) {
      overlayWindow.hide();
      overlayWindow.showInactive();
    }
  };

  screen.on('display-added', () => {
    log.info('display-added — reclamping overlay and main window');
    reclampOverlay(false);
    reclampMainWindow();
    recoverOverlayCompositor();
  });
  screen.on('display-removed', () => {
    log.info('display-removed — centering overlay on primary');
    reclampOverlay(true);
    reclampMainWindow();
    recoverOverlayCompositor();
  });
  screen.on('display-metrics-changed', () => {
    log.info('display-metrics-changed — reclamping overlay');
    reclampOverlay(false);
    reclampMainWindow();
    recoverOverlayCompositor();
  });

  // Preload local transcription model in background (eliminates 2-3s delay on first use)
  transcriptionService.preloadModel().catch((err) => {
    log.warn('Model preload failed (non-critical):', err.message);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (overlayHideTimeout) { clearTimeout(overlayHideTimeout); overlayHideTimeout = null; }
  if (pttSafetyTimeout) { clearTimeout(pttSafetyTimeout); pttSafetyTimeout = null; }
  hotkeyService.stop();
  trayManager.destroy();
  historyService?.close();
  pasteService.destroy();
  updateService.stop();
});
