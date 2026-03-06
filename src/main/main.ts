import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { TrayManager } from './tray';
import { AudioRecorderService } from './services/audio-recorder.service';
import { HotkeyService } from './services/hotkey.service';
import { TranscriptionService } from './services/transcription.service';
import { registerIpcHandlers } from './ipc-handlers';
import { DEFAULT_SETTINGS, type AppSettings, type RecordingState } from '../shared/types';
import { IPC } from '../shared/constants';

if (started) {
  app.quit();
}

const store = new Store<AppSettings>({ defaults: DEFAULT_SETTINGS });
const trayManager = new TrayManager();
const audioRecorder = new AudioRecorderService();
const transcriptionService = new TranscriptionService(store);

// Hotkey sends toggle to the main renderer window (which owns getUserMedia)
function sendToggleToRenderer(): void {
  if (mainWindow) {
    mainWindow.webContents.send(IPC.HOTKEY_TOGGLE);
  }
}

const hotkeyService = new HotkeyService(sendToggleToRenderer, sendToggleToRenderer);

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

  win.once('ready-to-show', () => {
    win.show();
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      win.webContents.openDevTools();
    }
  });

  win.on('close', (e) => {
    if (store.get('general.minimizeToTray')) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 300,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Position in top-right corner
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW } = primaryDisplay.workAreaSize;
  win.setPosition(screenW - 320, 20);

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

  if (state === 'idle' || state === 'done') {
    overlayWindow?.hide();
  } else {
    overlayWindow?.show();
  }
}

// Recording control via IPC from renderer
function setupRecordingIpc(): void {
  ipcMain.on(IPC.RECORDING_START, () => {
    broadcastState('recording');
  });

  ipcMain.on(IPC.RECORDING_STOP, () => {
    // TODO: replace with real transcription pipeline (Phase 3/4)
    broadcastState('idle');
  });

  ipcMain.handle(IPC.RECORDING_STATE_CHANGED, () => {
    return currentState;
  });
}

app.on('ready', () => {
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();

  trayManager.create(mainWindow);
  registerIpcHandlers(store, audioRecorder, transcriptionService, broadcastState);
  setupRecordingIpc();

  const { shortcut, mode } = store.get('hotkey');
  hotkeyService.start(shortcut, mode);
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
