export const IPC = {
  // Recording
  RECORDING_INIT: 'recording:init',
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_STATE_CHANGED: 'recording:state-changed',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_ON_CHANGE: 'settings:on-change',

  // Hotkey → renderer (main tells renderer to toggle recording)
  HOTKEY_TOGGLE: 'hotkey:toggle',
  HOTKEY_CANCEL: 'hotkey:cancel',
  HOTKEY_MODE_SELECT: 'hotkey:mode-select',

  // Transcription
  TRANSCRIPTION_CHECK_READY: 'transcription:check-ready',
  TRANSCRIPTION_START_BUFFER: 'transcription:start-buffer',
  TRANSCRIPTION_RESULT: 'transcription:result',
  TRANSCRIPTION_ERROR: 'transcription:error',

  // Model
  MODEL_STATUS: 'model:status',
  MODEL_ALL_DOWNLOADED: 'model:all-downloaded',
  MODEL_DOWNLOAD: 'model:download',
  MODEL_DOWNLOAD_CANCEL: 'model:download:cancel',
  MODEL_DOWNLOAD_PROGRESS: 'model:download:progress',
  MODEL_DOWNLOAD_DONE: 'model:download:done',
  MODEL_DOWNLOAD_ERROR: 'model:download:error',

  // Voice Activity
  VOICE_ACTIVITY: 'recording:voice-activity',

  // Overlay button → main → renderer toggle
  OVERLAY_TOGGLE: 'overlay:toggle',
  OVERLAY_CANCEL: 'overlay:cancel',
  OVERLAY_MODE_CYCLE: 'overlay:mode-cycle',

  // History
  HISTORY_GET_ALL: 'history:get-all',
  HISTORY_GET_STATS: 'history:get-stats',
  HISTORY_DELETE: 'history:delete',
  HISTORY_SEARCH: 'history:search',
  HISTORY_CLEAR_ALL: 'history:clear-all',
  HISTORY_MIGRATE: 'history:migrate',

  // Audio
  AUDIO_SAVE: 'audio:save',

  // AI
  AI_TEST_PROMPT: 'ai:test-prompt',
  AI_GET_OPENAI_MODELS: 'ai:get-openai-models',

  // App
  APP_QUIT: 'app:quit',
  APP_SHOW_SETTINGS: 'app:show-settings',
  APP_OPEN_MODELS_FOLDER: 'app:open-models-folder',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',

  // Widget drag
  WIDGET_DRAG_START: 'widget:drag-start',
  WIDGET_DRAG_END: 'widget:drag-end',
} as const;

import { DEFAULT_SETTINGS } from './types';

/** Single source of truth is DEFAULT_SETTINGS.dictation.modePrompts in types.ts */
export const DICTATION_MODE_PROMPTS: Record<string, string> = DEFAULT_SETTINGS.dictation.modePrompts;

export const WHISPER_MODEL_DESCRIPTIONS: Record<string, string> = {
  tiny: 'Fastest, lowest accuracy',
  base: 'Good balance of speed and accuracy',
  small: 'Better accuracy, moderate speed',
  medium: 'High accuracy, slower',
  'large-v3': 'Best accuracy, slowest',
};

// Single source of truth for AI model lists — update here when providers release new models
export const OPENAI_MODELS: { value: string; label: string }[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];

export const ANTHROPIC_MODELS: { value: string; label: string }[] = [
  { value: 'claude-opus-4-6', label: 'Claude Opus' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku' },
];

export const AI_MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-4o-mini': 'Fast & affordable',
  'gpt-4o': 'Powerful multimodal model',
  'gpt-4.1': 'Latest GPT-4 generation',
  'claude-opus-4-6': 'Most capable Anthropic model',
  'claude-sonnet-4-6': 'Best quality & reasoning',
  'claude-haiku-4-5-20251001': 'Fast & lightweight',
};
