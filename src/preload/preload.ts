import { contextBridge, ipcRenderer } from 'electron';
import 'electron-log/preload';
import '@sentry/electron/preload';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState, TranscriptionResult, RecordingEntry, HistoryStats, UpdateState } from '../shared/types';

export interface DictatorAPI {
  initRecording: () => void;
  startRecording: () => void;
  stopRecording: (goIdle?: boolean) => void;
  reportMicError: (message: string) => void;
  getRecordingState: () => Promise<RecordingState>;
  onRecordingStateChanged: (callback: (state: RecordingState) => void) => () => void;

  checkTranscriptionReady: () => Promise<{ ready: boolean; error?: string; errorType?: string }>;
  transcribeBuffer: (audioBuffer: ArrayBuffer, sampleRate: number, id?: string, compressedAudio?: ArrayBuffer) => Promise<void>;
  onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => () => void;
  onTranscriptionError: (callback: (message: string) => void) => () => void;

  checkModelStatus: () => Promise<{ downloaded: boolean }>;
  getDownloadedModels: () => Promise<string[]>;
  downloadModel: () => Promise<void>;
  cancelDownload: () => void;
  onModelProgress: (callback: (pct: number) => void) => () => void;
  onModelDone: (callback: () => void) => () => void;
  onModelError: (callback: (msg: string) => void) => () => void;

  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  onSettingsChange: (callback: (settings: AppSettings) => void) => () => void;

  sendVoiceActivity: (level: number) => void;
  onVoiceActivity: (callback: (level: number) => void) => () => void;

  onHotkeyToggle: (callback: () => void) => () => void;
  onHotkeyCancel: (callback: () => void) => () => void;

  requestToggleRecording: () => void;
  requestCancelRecording: () => void;

  history: {
    getAll: (limit?: number, offset?: number) => Promise<{ success: boolean; data: RecordingEntry[]; error?: string }>;
    getCount: () => Promise<{ success: boolean; count: number; error?: string }>;
    getStats: () => Promise<{ success: boolean; data: HistoryStats | null; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; found?: boolean; audioDeleted?: boolean; audioError?: string; error?: string }>;
    search: (query: string) => Promise<{ success: boolean; data: RecordingEntry[]; error?: string }>;
    clearAll: () => Promise<{ success: boolean; deleted?: number; audioErrors?: number; error?: string }>;
    migrate: (entries: RecordingEntry[]) => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  };

  ai: {
    testPrompt: (text: string, systemPrompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    enhancePrompt: (rawPrompt: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    generatePromptName: (promptContent: string) => Promise<{ success: boolean; name?: string; error?: string }>;
    getOpenAIModels: () => Promise<{ success: boolean; models: { value: string; label: string }[]; error?: string }>;
    validateKey: (provider: string, apiKey: string) => Promise<{ valid: boolean; error?: string }>;
  };

  groq: {
    validateKey: (apiKey: string) => Promise<{ valid: boolean; error?: string }>;
  };

  openExternal: (url: string) => void;

  audio: {
    save: (id: string, buffer: ArrayBuffer) => Promise<string>;
  };

  quit: () => void;
  showSettings: () => void;
  openModelsFolder: () => void;

  update: {
    check: () => Promise<UpdateState>;
    getInfo: () => Promise<UpdateState>;
    install: () => Promise<void>;
    onStatusChange: (callback: (state: UpdateState) => void) => () => void;
  };

  onErrorNotification: (callback: (message: string) => void) => () => void;

  minimize: () => void;
  closeWindow: () => void;

  widgetDragStart: (offsetX: number, offsetY: number) => void;
  widgetDragEnd: () => void;
}

const api: DictatorAPI = {
  initRecording: () => ipcRenderer.send(IPC.RECORDING_INIT),
  startRecording: () => ipcRenderer.send(IPC.RECORDING_START),
  stopRecording: (goIdle?: boolean) => ipcRenderer.send(IPC.RECORDING_STOP, goIdle !== false),
  reportMicError: (message: string) => ipcRenderer.send(IPC.RECORDING_MIC_ERROR, message),
  getRecordingState: () => ipcRenderer.invoke(IPC.RECORDING_STATE_CHANGED),
  onRecordingStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(IPC.RECORDING_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATE_CHANGED, handler);
  },

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

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  onSettingsChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on(IPC.SETTINGS_ON_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_ON_CHANGE, handler);
  },

  sendVoiceActivity: (level) => ipcRenderer.send(IPC.VOICE_ACTIVITY, level),
  onVoiceActivity: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, level: number) => callback(level);
    ipcRenderer.on(IPC.VOICE_ACTIVITY, handler);
    return () => ipcRenderer.removeListener(IPC.VOICE_ACTIVITY, handler);
  },

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

  requestToggleRecording: () => ipcRenderer.send(IPC.OVERLAY_TOGGLE),
  requestCancelRecording: () => ipcRenderer.send(IPC.OVERLAY_CANCEL),

  history: {
    getAll: (limit?: number, offset?: number) => ipcRenderer.invoke(IPC.HISTORY_GET_ALL, limit, offset),
    getCount: () => ipcRenderer.invoke(IPC.HISTORY_GET_COUNT),
    getStats: () => ipcRenderer.invoke(IPC.HISTORY_GET_STATS),
    delete: (id) => ipcRenderer.invoke(IPC.HISTORY_DELETE, id),
    search: (query) => ipcRenderer.invoke(IPC.HISTORY_SEARCH, query),
    clearAll: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR_ALL),
    migrate: (entries) => ipcRenderer.invoke(IPC.HISTORY_MIGRATE, entries),
  },

  ai: {
    testPrompt: (text, systemPrompt) => ipcRenderer.invoke(IPC.AI_TEST_PROMPT, text, systemPrompt),
    enhancePrompt: (rawPrompt) => ipcRenderer.invoke(IPC.AI_ENHANCE_PROMPT, rawPrompt),
    generatePromptName: (promptContent) => ipcRenderer.invoke(IPC.AI_GENERATE_PROMPT_NAME, promptContent),
    getOpenAIModels: () => ipcRenderer.invoke(IPC.AI_GET_OPENAI_MODELS),
    validateKey: (provider, apiKey) => ipcRenderer.invoke(IPC.AI_VALIDATE_KEY, provider, apiKey),
  },

  groq: {
    validateKey: (apiKey) => ipcRenderer.invoke(IPC.GROQ_VALIDATE_KEY, apiKey),
  },

  audio: {
    save: (id, buffer) => ipcRenderer.invoke(IPC.AUDIO_SAVE, id, buffer),
  },

  openExternal: (url) => ipcRenderer.send(IPC.SHELL_OPEN_EXTERNAL, url),

  quit: () => ipcRenderer.send(IPC.APP_QUIT),
  showSettings: () => ipcRenderer.send(IPC.APP_SHOW_SETTINGS),
  openModelsFolder: () => ipcRenderer.send(IPC.APP_OPEN_MODELS_FOLDER),

  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    getInfo: () => ipcRenderer.invoke(IPC.UPDATE_GET_INFO),
    install: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
    onStatusChange: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
      ipcRenderer.on(IPC.UPDATE_STATUS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS_CHANGED, handler);
    },
  },

  onErrorNotification: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(IPC.NOTIFICATION_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.NOTIFICATION_ERROR, handler);
  },

  minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  widgetDragStart: (offsetX, offsetY) => ipcRenderer.send(IPC.WIDGET_DRAG_START, offsetX, offsetY),
  widgetDragEnd: () => ipcRenderer.send(IPC.WIDGET_DRAG_END),
};

contextBridge.exposeInMainWorld('dictator', api);
