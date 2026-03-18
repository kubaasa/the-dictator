import { app, BrowserWindow, ipcMain, protocol, net, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { TrayManager } from './tray';
import { HotkeyService } from './services/hotkey.service';
import { TranscriptionService } from './services/transcription.service';
import { HistoryService } from './services/history.service';
import { registerIpcHandlers, getOverlaySize, clampToVisibleArea } from './ipc-handlers';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { DEFAULT_SETTINGS, type AppSettings, type RecordingState } from '../shared/types';
import { IPC } from '../shared/constants';

if (started) {
  app.quit();
}

// Must be called before app 'ready'
protocol.registerSchemesAsPrivileged([
  { scheme: 'recording', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS });
const trayManager = new TrayManager();
const transcriptionService = new TranscriptionService(store);
const pasteService = new PasteService();
const aiService = new AIService(store);

// Hotkey sends toggle to the main renderer window (which owns getUserMedia)
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

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentState: RecordingState = 'idle';
let overlayHideTimeout: ReturnType<typeof setTimeout> | null = null;
let historyService: HistoryService | null = null;
let pttSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

const hotkeyService = new HotkeyService(
  () => {
    // Clear safety timeout on new recording start
    if (pttSafetyTimeout) { clearTimeout(pttSafetyTimeout); pttSafetyTimeout = null; }
    pasteService.captureTarget();
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
        console.warn('[Dictator] PTT safety timeout: forcing idle from state "%s"', currentState);
        broadcastState('idle');
        hotkeyService.notifyRecordingStopped();
      }
      pttSafetyTimeout = null;
    }, 65_000);
  },
);

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    title: 'The Dictator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Prevent Chromium from throttling JS when the window is hidden (tray mode)
  win.webContents.setBackgroundThrottling(false);

  win.once('ready-to-show', () => {
    // App starts hidden in tray — don't show the window
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
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

  // Save position whenever the user moves the widget
  win.on('moved', () => {
    const { x, y } = win.getBounds();
    store.set('widget.x', x);
    store.set('widget.y', y);
  });

  // Blur immediately on focus so the overlay never steals focus from other apps
  win.on('focus', () => win.blur());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#overlay`);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: 'overlay' },
    );
  }

  return win;
}

function broadcastState(state: RecordingState): void {
  currentState = state;
  // Clear PTT safety timeout when state reaches idle normally
  if (state === 'idle' && pttSafetyTimeout) {
    clearTimeout(pttSafetyTimeout);
    pttSafetyTimeout = null;
  }
  trayManager.updateState(state);

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.RECORDING_STATE_CHANGED, state);
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
        }, 400);
      }
    } else {
      // Active states (initializing, recording, transcribing, processing, done, error):
      // cancel any pending hide and ensure the widget is visible
      if (overlayHideTimeout) { clearTimeout(overlayHideTimeout); overlayHideTimeout = null; }
      if (!overlayWindow.isVisible()) {
        overlayWindow.show();
      }
    }
  }
}

// Recording control via IPC from renderer
function setupRecordingIpc(): void {
  ipcMain.on(IPC.RECORDING_INIT, () => {
    if (currentState === 'initializing' || currentState === 'recording') return;
    // Sync HotkeyService for non-hotkey sources (overlay button, main window button)
    // so keyboard shortcuts can correctly stop the recording
    hotkeyService.notifyRecordingStarted();
    pasteService.captureTarget();
    broadcastState('initializing');
  });

  ipcMain.on(IPC.RECORDING_START, () => {
    broadcastState('recording');
  });

  ipcMain.on(IPC.RECORDING_STOP, (_event, goIdle = true) => {
    // Only transition to idle when there's no pending transcription.
    // When audio exists, the transcription handler manages state transitions
    // (transcribing → processing → done → idle), avoiding a brief idle flicker.
    if (goIdle) broadcastState('idle');
    hotkeyService.notifyRecordingStopped();
  });

  ipcMain.on(IPC.VOICE_ACTIVITY, (_, level: number) => {
    overlayWindow?.webContents.send(IPC.VOICE_ACTIVITY, level);
  });

  ipcMain.handle(IPC.RECORDING_STATE_CHANGED, () => {
    return currentState;
  });

  ipcMain.on(IPC.OVERLAY_TOGGLE, () => {
    // captureTarget is handled by RECORDING_INIT (start) or onRecordingStart (PTT)
    sendToggleToRenderer();
  });

  ipcMain.on(IPC.OVERLAY_CANCEL, () => {
    sendCancelToRenderer();
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
  // Serve local audio files via recording:// with proper Range request support.
  // The HTML5 audio element requires Range responses (HTTP 206) for buffering/seeking.
  // net.fetch('file://') doesn't handle Range headers, so we do it manually.
  protocol.handle('recording', async (request) => {
    const filePath = decodeURIComponent(request.url.replace('recording:///', ''));
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
          const fh = await fs.promises.open(filePath, 'r');
          const buf = Buffer.alloc(chunkSize);
          await fh.read(buf, 0, chunkSize, start);
          await fh.close();
          return new Response(buf, {
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

      const buf = await fs.promises.readFile(filePath);
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'audio/webm',
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();

  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  historyService = new HistoryService(path.join(app.getPath('userData'), 'history.db'));

  trayManager.create(mainWindow);
  registerIpcHandlers(store, transcriptionService, broadcastState, pasteService, aiService, hotkeyService, () => overlayWindow, historyService, () => currentState);
  setupRecordingIpc();
  setupWindowControlIpc();

  const hotkey = store.get('hotkey');
  const shortcuts = { ...DEFAULT_SETTINGS.hotkey.shortcuts, ...(hotkey?.shortcuts ?? {}) };
  const mode = hotkey?.mode ?? DEFAULT_SETTINGS.hotkey.mode;
  hotkeyService.start(shortcuts, mode, {
    onCancel: sendCancelToRenderer,
    onShowWindow: showOrHideMainWindow,
  });

  // When a monitor is disconnected or resolution changes, re-clamp the overlay widget
  const reclampOverlay = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const { x, y, width, height } = overlayWindow.getBounds();
    const clamped = clampToVisibleArea(x, y, width, height);
    if (clamped.x !== x || clamped.y !== y) {
      overlayWindow.setPosition(clamped.x, clamped.y);
      store.set('widget.x', clamped.x);
      store.set('widget.y', clamped.y);
    }
  };
  screen.on('display-removed', reclampOverlay);
  screen.on('display-metrics-changed', reclampOverlay);

  // Preload local transcription model in background (eliminates 2-3s delay on first use)
  transcriptionService.preloadModel().catch((err) => {
    console.warn('[Dictator] Model preload failed (non-critical):', err.message);
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
  hotkeyService.stop();
  trayManager.destroy();
  historyService?.close();
});
