import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants';
import type { AppSettings, RecordingState } from '../shared/types';

export interface DictatorAPI {
  // Recording
  startRecording: () => void;
  stopRecording: () => void;
  saveWav: (audioBuffer: ArrayBuffer, sampleRate: number) => Promise<string>;
  getRecordingState: () => Promise<RecordingState>;
  onRecordingStateChanged: (callback: (state: RecordingState) => void) => () => void;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  onSettingsChange: (callback: (settings: AppSettings) => void) => () => void;

  // Hotkey
  onHotkeyToggle: (callback: () => void) => () => void;

  // App
  quit: () => void;
  showSettings: () => void;
}

const api: DictatorAPI = {
  // Recording
  startRecording: () => ipcRenderer.send(IPC.RECORDING_START),
  stopRecording: () => ipcRenderer.send(IPC.RECORDING_STOP),
  saveWav: (audioBuffer, sampleRate) =>
    ipcRenderer.invoke(IPC.AUDIO_SAVE_WAV, audioBuffer, sampleRate),
  getRecordingState: () => ipcRenderer.invoke(IPC.RECORDING_STATE_CHANGED),
  onRecordingStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RecordingState) => callback(state);
    ipcRenderer.on(IPC.RECORDING_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATE_CHANGED, handler);
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  onSettingsChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on(IPC.SETTINGS_ON_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_ON_CHANGE, handler);
  },

  // Hotkey
  onHotkeyToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.HOTKEY_TOGGLE, handler);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_TOGGLE, handler);
  },

  // App
  quit: () => ipcRenderer.send(IPC.APP_QUIT),
  showSettings: () => ipcRenderer.send(IPC.APP_SHOW_SETTINGS),
};

contextBridge.exposeInMainWorld('dictator', api);
