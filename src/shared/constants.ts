export const IPC = {
  RECORDING_INIT: 'recording:init',
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_MIC_ERROR: 'recording:mic-error',
  RECORDING_STATE_CHANGED: 'recording:state-changed',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_ON_CHANGE: 'settings:on-change',

  HOTKEY_TOGGLE: 'hotkey:toggle',
  HOTKEY_CANCEL: 'hotkey:cancel',

  RENDERER_READY: 'renderer:ready',

  TRANSCRIPTION_CHECK_READY: 'transcription:check-ready',
  TRANSCRIPTION_START_BUFFER: 'transcription:start-buffer',
  TRANSCRIPTION_RESULT: 'transcription:result',
  TRANSCRIPTION_ERROR: 'transcription:error',

  MODEL_STATUS: 'model:status',
  MODEL_ALL_DOWNLOADED: 'model:all-downloaded',
  MODEL_DOWNLOAD: 'model:download',
  MODEL_DOWNLOAD_CANCEL: 'model:download:cancel',
  MODEL_DOWNLOAD_PROGRESS: 'model:download:progress',
  MODEL_DOWNLOAD_DONE: 'model:download:done',
  MODEL_DOWNLOAD_ERROR: 'model:download:error',

  VOICE_ACTIVITY: 'recording:voice-activity',

  OVERLAY_TOGGLE: 'overlay:toggle',
  OVERLAY_CANCEL: 'overlay:cancel',

  HISTORY_GET_ALL: 'history:get-all',
  HISTORY_GET_COUNT: 'history:get-count',
  HISTORY_GET_STATS: 'history:get-stats',
  HISTORY_DELETE: 'history:delete',
  HISTORY_SEARCH: 'history:search',
  HISTORY_CLEAR_ALL: 'history:clear-all',
  HISTORY_MIGRATE: 'history:migrate',

  AUDIO_SAVE: 'audio:save',

  AI_ENHANCE_PROMPT: 'ai:enhance-prompt',
  AI_GENERATE_PROMPT_NAME: 'ai:generate-prompt-name',
  AI_GET_OPENAI_MODELS: 'ai:get-openai-models',

  API_KEY_SAVE: 'api-key:save',
  API_KEY_DELETE: 'api-key:delete',

  APP_QUIT: 'app:quit',
  APP_SHOW_SETTINGS: 'app:show-settings',
  APP_OPEN_MODELS_FOLDER: 'app:open-models-folder',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',

  WIDGET_DRAG_START: 'widget:drag-start',
  WIDGET_DRAG_END: 'widget:drag-end',

  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  UPDATE_CHECK: 'update:check',
  UPDATE_GET_INFO: 'update:get-info',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS_CHANGED: 'update:status-changed',

  NOTIFICATION_ERROR: 'notification:error',

  MIC_CHECK_SYSTEM_PERMISSION: 'mic:check-system-permission',
} as const;

export const TRANSCRIPTION_ENGINES = ['local', 'cloud'] as const;
export const AI_PROVIDERS = ['openai', 'anthropic'] as const;
export const API_KEY_PROVIDERS = ['groq', 'openai', 'anthropic'] as const;
export const WIDGET_TYPES = ['voicebar', 'maxi'] as const;
export const OVERLAY_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const;
export const HOTKEY_MODES = ['toggle', 'push-to-talk'] as const;

export const WHISPER_MODELS: readonly { value: string; label: string; size: string; description: string }[] = [
  { value: 'tiny', label: 'Tiny', size: '150 MB', description: 'Fastest, lowest accuracy' },
  { value: 'base', label: 'Base', size: '280 MB', description: 'Good balance of speed and accuracy' },
  { value: 'small', label: 'Small', size: '~1 GB', description: 'Better accuracy, moderate speed' },
  { value: 'medium', label: 'Medium', size: '1.5 GB', description: 'High accuracy, slower' },
  { value: 'large-v3', label: 'Large v3', size: '3.1 GB', description: 'Best accuracy, slowest' },
];

export const OPENAI_MODELS: { value: string; label: string }[] = [
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
];

export const ANTHROPIC_MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku' },
];

export const AI_MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-4.1-nano': 'Cheapest & fastest',
  'gpt-5.4-nano': 'Smart & affordable',
  'claude-sonnet-4-6': 'Powerful & balanced',
  'claude-haiku-4-5-20251001': 'Fast & lightweight',
};

/** audio.deviceId sentinel: use the mic of the headset the user listens through (see resolveAutoMic). */
export const AUTO_MIC_DEVICE_ID = 'auto';
