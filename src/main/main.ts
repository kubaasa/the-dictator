import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { TrayManager } from './tray';
import { HotkeyService } from './services/hotkey.service';
import { TranscriptionService } from './services/transcription.service';
import { registerIpcHandlers } from './ipc-handlers';
import { PasteService } from './services/paste.service';
import { AIService } from './services/ai.service';
import { DEFAULT_SETTINGS, type AppSettings, type RecordingState } from '../shared/types';
import { IPC } from '../shared/constants';
import { getOverlaySize } from './ipc-handlers';

if (started) {
  app.quit();
}

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

function sendModeSelectToRenderer(): void {
  if (mainWindow) {
    mainWindow.webContents.send(IPC.HOTKEY_MODE_SELECT);
  }
}

const hotkeyService = new HotkeyService(
  () => { pasteService.captureTarget(); sendToggleToRenderer(); },
  sendToggleToRenderer,
);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentState: RecordingState = 'idle';

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
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
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      win.webContents.openDevTools();
    }
  });

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

function createOverlayWindow(): BrowserWindow {
  const widget = store.get('widget') ?? DEFAULT_SETTINGS.widget;
  const [initW, initH] = getOverlaySize(widget.activeWidget, widget.size);

  const win = new BrowserWindow({
    width: initW,
    height: initH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Restore last saved position or default to top-right corner
  const { screen } = require('electron');
  const savedX = store.get('widget.x') as number | undefined;
  const savedY = store.get('widget.y') as number | undefined;
  if (savedX !== undefined && savedY !== undefined) {
    win.setPosition(savedX, savedY);
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
  trayManager.updateState(state);

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.RECORDING_STATE_CHANGED, state);
  }

  // Overlay is always visible — only state changes, no hide/show
}

// Recording control via IPC from renderer
function setupRecordingIpc(): void {
  ipcMain.on(IPC.RECORDING_START, () => {
    broadcastState('recording');
  });

  ipcMain.on(IPC.RECORDING_STOP, () => {
    broadcastState('idle');
  });

  ipcMain.on(IPC.VOICE_ACTIVITY, (_, level: number) => {
    overlayWindow?.webContents.send(IPC.VOICE_ACTIVITY, level);
  });

  ipcMain.handle(IPC.RECORDING_STATE_CHANGED, () => {
    return currentState;
  });
}

app.on('ready', () => {
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();

  trayManager.create(mainWindow);
  registerIpcHandlers(store, transcriptionService, broadcastState, pasteService, aiService, hotkeyService, () => overlayWindow);
  setupRecordingIpc();

  const hotkey = store.get('hotkey');
  const shortcuts = hotkey?.shortcuts ?? DEFAULT_SETTINGS.hotkey.shortcuts;
  const mode = hotkey?.mode ?? DEFAULT_SETTINGS.hotkey.mode;
  hotkeyService.start(shortcuts, mode, {
    onCancel: sendCancelToRenderer,
    onModeSelect: sendModeSelectToRenderer,
  });

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
});
