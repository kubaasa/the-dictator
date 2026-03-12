import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState, TranscriptionResult } from '../shared/types';

export interface DictatorAPI {
  // Recording
  startRecording: () => void;
  stopRecording: () => void;
  getRecordingState: () => Promise<RecordingState>;
  onRecordingStateChanged: (callback: (state: RecordingState) => void) => () => void;

  // Transcription
  checkTranscriptionReady: () => Promise<{ ready: boolean; error?: string }>;
  transcribeBuffer: (audioBuffer: ArrayBuffer, sampleRate: number) => Promise<void>;
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
  onHotkeyModeSelect: (callback: () => void) => () => void;

  // App
  quit: () => void;
  showSettings: () => void;
  openModelsFolder: () => void;
}

const api: DictatorAPI = {
  // Recording
  startRecording: () => ipcRenderer.send(IPC.RECORDING_START),
  stopRecording: () => ipcRenderer.send(IPC.RECORDING_STOP),
  getRecordingState: () => ipcRenderer.invoke(IPC.RECORDING_STATE_CHANGED),
  onRecordingStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(IPC.RECORDING_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATE_CHANGED, handler);
  },

  // Transcription
  checkTranscriptionReady: () => ipcRenderer.invoke(IPC.TRANSCRIPTION_CHECK_READY),
  transcribeBuffer: (audioBuffer, sampleRate) =>
    ipcRenderer.invoke(IPC.TRANSCRIPTION_START_BUFFER, audioBuffer, sampleRate),
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
  onHotkeyModeSelect: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.HOTKEY_MODE_SELECT, handler);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_MODE_SELECT, handler);
  },

  // App
  quit: () => ipcRenderer.send(IPC.APP_QUIT),
  showSettings: () => ipcRenderer.send(IPC.APP_SHOW_SETTINGS),
  openModelsFolder: () => ipcRenderer.send(IPC.APP_OPEN_MODELS_FOLDER),
};

contextBridge.exposeInMainWorld('dictator', api);
