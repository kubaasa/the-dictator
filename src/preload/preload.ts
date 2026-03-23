import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState, TranscriptionResult, RecordingEntry, HistoryStats } from '../shared/types';

export interface DictatorAPI {
  // Recording
  initRecording: () => void;
  startRecording: () => void;
  stopRecording: (goIdle?: boolean) => void;
  getRecordingState: () => Promise<RecordingState>;
  onRecordingStateChanged: (callback: (state: RecordingState) => void) => () => void;

  // Transcription
  checkTranscriptionReady: () => Promise<{ ready: boolean; error?: string }>;
  transcribeBuffer: (audioBuffer: ArrayBuffer, sampleRate: number, id?: string, compressedAudio?: ArrayBuffer) => Promise<void>;
  onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => () => void;
  onTranscriptionError: (callback: (message: string) => void) => () => void;

  // Model
  checkModelStatus: () => Promise<{ downloaded: boolean }>;
  getDownloadedModels: () => Promise<string[]>;
  downloadModel: () => Promise<void>;
  cancelDownload: () => void;
  onModelProgress: (callback: (pct: number) => void) => () => void;
  onModelDone: (callback: () => void) => () => void;
  onModelError: (callback: (msg: string) => void) => () => void;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  onSettingsChange: (callback: (settings: AppSettings) => void) => () => void;

  // Voice Activity
  sendVoiceActivity: (level: number) => void;
  onVoiceActivity: (callback: (level: number) => void) => () => void;

  // Hotkey
  onHotkeyToggle: (callback: () => void) => () => void;
  onHotkeyCancel: (callback: () => void) => () => void;
  // Overlay
  requestToggleRecording: () => void;
  requestCancelRecording: () => void;

  // History
  history: {
    getAll: (limit?: number, offset?: number) => Promise<{ success: boolean; data: RecordingEntry[]; error?: string }>;
    getStats: () => Promise<{ success: boolean; data: HistoryStats | null; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; found?: boolean; audioDeleted?: boolean; audioError?: string; error?: string }>;
    search: (query: string) => Promise<{ success: boolean; data: RecordingEntry[]; error?: string }>;
    clearAll: () => Promise<{ success: boolean; deleted?: number; audioErrors?: number; error?: string }>;
    migrate: (entries: RecordingEntry[]) => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  };

  // AI
  ai: {
    testPrompt: (text: string, systemPrompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    getOpenAIModels: () => Promise<{ success: boolean; models: { value: string; label: string }[]; error?: string }>;
  };

  // Audio
  audio: {
    save: (id: string, buffer: ArrayBuffer) => Promise<string>;
  };

  // App
  quit: () => void;
  showSettings: () => void;
  openModelsFolder: () => void;

  // Updates
  update: {
    check: () => Promise<{ available: boolean; currentVersion: string; latestVersion?: string; downloadUrl?: string; releaseNotes?: string }>;
    getInfo: () => Promise<{ available: boolean; currentVersion: string; latestVersion?: string; downloadUrl?: string; releaseNotes?: string }>;
  };

  // Notifications
  onErrorNotification: (callback: (message: string) => void) => () => void;

  // Window controls
  minimize: () => void;
  closeWindow: () => void;

  // Widget drag
  widgetDragStart: (offsetX: number, offsetY: number) => void;
  widgetDragEnd: () => void;
}

const api: DictatorAPI = {
  // Recording
  initRecording: () => ipcRenderer.send(IPC.RECORDING_INIT),
  startRecording: () => ipcRenderer.send(IPC.RECORDING_START),
  stopRecording: (goIdle?: boolean) => ipcRenderer.send(IPC.RECORDING_STOP, goIdle !== false),
  getRecordingState: () => ipcRenderer.invoke(IPC.RECORDING_STATE_CHANGED),
  onRecordingStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(IPC.RECORDING_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATE_CHANGED, handler);
  },

  // Transcription
  checkTranscriptionReady: () => ipcRenderer.invoke(IPC.TRANSCRIPTION_CHECK_READY),
  transcribeBuffer: (audioBuffer, sampleRate, id, compressedAudio) =>
    ipcRenderer.invoke(IPC.TRANSCRIPTION_START_BUFFER, audioBuffer, sampleRate, id, compressedAudio),
  onTranscriptionResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, result: TranscriptionResult) => callback(result);
    ipcRenderer.on(IPC.TRANSCRIPTION_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.TRANSCRIPTION_RESULT, handler);
  },
  onTranscriptionError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(IPC.TRANSCRIPTION_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.TRANSCRIPTION_ERROR, handler);
  },

  // Model
  checkModelStatus: () => ipcRenderer.invoke(IPC.MODEL_STATUS),
  getDownloadedModels: () => ipcRenderer.invoke(IPC.MODEL_ALL_DOWNLOADED),
  downloadModel: () => ipcRenderer.invoke(IPC.MODEL_DOWNLOAD),
  cancelDownload: () => ipcRenderer.send(IPC.MODEL_DOWNLOAD_CANCEL),
  onModelProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, pct: number) => callback(pct);
    ipcRenderer.on(IPC.MODEL_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.MODEL_DOWNLOAD_PROGRESS, handler);
  },
  onModelDone: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.MODEL_DOWNLOAD_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.MODEL_DOWNLOAD_DONE, handler);
  },
  onModelError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on(IPC.MODEL_DOWNLOAD_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.MODEL_DOWNLOAD_ERROR, handler);
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  onSettingsChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on(IPC.SETTINGS_ON_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_ON_CHANGE, handler);
  },

  // Voice Activity
  sendVoiceActivity: (level) => ipcRenderer.send(IPC.VOICE_ACTIVITY, level),
  onVoiceActivity: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, level: number) => callback(level);
    ipcRenderer.on(IPC.VOICE_ACTIVITY, handler);
    return () => ipcRenderer.removeListener(IPC.VOICE_ACTIVITY, handler);
  },

  // Hotkey
  onHotkeyToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.HOTKEY_TOGGLE, handler);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_TOGGLE, handler);
  },
  onHotkeyCancel: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.HOTKEY_CANCEL, handler);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_CANCEL, handler);
  },
  // Overlay
  requestToggleRecording: () => ipcRenderer.send(IPC.OVERLAY_TOGGLE),
  requestCancelRecording: () => ipcRenderer.send(IPC.OVERLAY_CANCEL),

  // History
  history: {
    getAll: (limit?: number, offset?: number) => ipcRenderer.invoke(IPC.HISTORY_GET_ALL, limit, offset),
    getStats: () => ipcRenderer.invoke(IPC.HISTORY_GET_STATS),
    delete: (id) => ipcRenderer.invoke(IPC.HISTORY_DELETE, id),
    search: (query) => ipcRenderer.invoke(IPC.HISTORY_SEARCH, query),
    clearAll: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR_ALL),
    migrate: (entries) => ipcRenderer.invoke(IPC.HISTORY_MIGRATE, entries),
  },

  // AI
  ai: {
    testPrompt: (text, systemPrompt) => ipcRenderer.invoke(IPC.AI_TEST_PROMPT, text, systemPrompt),
    getOpenAIModels: () => ipcRenderer.invoke(IPC.AI_GET_OPENAI_MODELS),
  },

  // Audio
  audio: {
    save: (id, buffer) => ipcRenderer.invoke(IPC.AUDIO_SAVE, id, buffer),
  },

  // App
  quit: () => ipcRenderer.send(IPC.APP_QUIT),
  showSettings: () => ipcRenderer.send(IPC.APP_SHOW_SETTINGS),
  openModelsFolder: () => ipcRenderer.send(IPC.APP_OPEN_MODELS_FOLDER),

  // Updates
  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    getInfo: () => ipcRenderer.invoke(IPC.UPDATE_GET_INFO),
  },

  // Notifications
  onErrorNotification: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(IPC.NOTIFICATION_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.NOTIFICATION_ERROR, handler);
  },

  // Window controls
  minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // Widget drag
  widgetDragStart: (offsetX, offsetY) => ipcRenderer.send(IPC.WIDGET_DRAG_START, offsetX, offsetY),
  widgetDragEnd: () => ipcRenderer.send(IPC.WIDGET_DRAG_END),
};

contextBridge.exposeInMainWorld('dictator', api);
