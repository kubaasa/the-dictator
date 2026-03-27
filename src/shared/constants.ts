export const IPC = {
  // Recording
  RECORDING_INIT: 'recording:init',
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_MIC_ERROR: 'recording:mic-error',
  RECORDING_STATE_CHANGED: 'recording:state-changed',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_ON_CHANGE: 'settings:on-change',

  // Hotkey → renderer (main tells renderer to toggle recording)
  HOTKEY_TOGGLE: 'hotkey:toggle',
  HOTKEY_CANCEL: 'hotkey:cancel',

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

  // History
  HISTORY_GET_ALL: 'history:get-all',
  HISTORY_GET_COUNT: 'history:get-count',
  HISTORY_GET_STATS: 'history:get-stats',
  HISTORY_DELETE: 'history:delete',
  HISTORY_SEARCH: 'history:search',
  HISTORY_CLEAR_ALL: 'history:clear-all',
  HISTORY_MIGRATE: 'history:migrate',

  // Audio
  AUDIO_SAVE: 'audio:save',

  // AI
  AI_TEST_PROMPT: 'ai:test-prompt',
  AI_ENHANCE_PROMPT: 'ai:enhance-prompt',
  AI_GENERATE_PROMPT_NAME: 'ai:generate-prompt-name',
  AI_GET_OPENAI_MODELS: 'ai:get-openai-models',
  AI_VALIDATE_KEY: 'ai:validate-key',

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

  // Groq
  GROQ_VALIDATE_KEY: 'groq:validate-key',

  // Shell
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Updates
  UPDATE_CHECK: 'update:check',
  UPDATE_GET_INFO: 'update:get-info',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS_CHANGED: 'update:status-changed',

  // Notifications (main → renderer)
  NOTIFICATION_ERROR: 'notification:error',
} as const;

export const WHISPER_MODEL_DESCRIPTIONS: Record<string, string> = {
  tiny: 'Fastest, lowest accuracy',
  base: 'Good balance of speed and accuracy',
  small: 'Better accuracy, moderate speed',
  medium: 'High accuracy, slower',
  'large-v3': 'Best accuracy, slowest',
  'large-v3-turbo': 'Near large-v3 accuracy, much faster',
  'distil-medium.en': 'Fast, near-medium quality (English only)',
  'distil-large-v3': '2x faster than large-v3, similar accuracy',
};

// Single source of truth for AI model lists — update here when providers release new models
export const OPENAI_MODELS: { value: string; label: string }[] = [
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];

export const ANTHROPIC_MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku' },
];

export const AI_MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-4.1-nano': 'Cheapest & fastest',
  'gpt-4.1-mini': 'Fast & affordable',
  'gpt-4.1': 'Most capable OpenAI model',
  'claude-sonnet-4-6': 'Powerful & balanced',
  'claude-haiku-4-5-20251001': 'Fast & lightweight',
};
