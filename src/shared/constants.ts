export const IPC = {
  // Recording
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_DATA: 'recording:data',
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

  // History
  HISTORY_GET_ALL: 'history:get-all',
  HISTORY_DELETE: 'history:delete',
  HISTORY_SEARCH: 'history:search',
  HISTORY_CLEAR_ALL: 'history:clear-all',
  HISTORY_MIGRATE: 'history:migrate',

  // Audio
  AUDIO_SAVE: 'audio:save',

  // AI
  AI_TEST_PROMPT: 'ai:test-prompt',

  // App
  APP_QUIT: 'app:quit',
  APP_SHOW_SETTINGS: 'app:show-settings',
  APP_OPEN_MODELS_FOLDER: 'app:open-models-folder',
} as const;

export const DICTATION_MODE_PROMPTS: Record<string, string> = {
  voice: `You are a dictation assistant. Output the transcribed text exactly as spoken, fixing only obvious speech recognition errors. Output ONLY the processed text, no explanations.`,
  email: `You are a dictation assistant. Rewrite the following dictated text as a well-structured, professional email. Fix grammar, punctuation, and formatting. Keep the original meaning and tone. Output ONLY the processed text, no explanations.`,
  chat: `You are a dictation assistant. Clean up the following dictated text for a casual chat message. Fix obvious errors but keep the informal, conversational tone. Output ONLY the processed text, no explanations.`,
  note: `You are a dictation assistant. Convert the following dictated text into a concise, well-organized note. Use bullet points where appropriate. Fix grammar and punctuation. Output ONLY the processed text, no explanations.`,
  custom: '',
};

export const WHISPER_MODEL_DESCRIPTIONS: Record<string, string> = {
  tiny: 'Fastest, lowest accuracy',
  base: 'Good balance of speed and accuracy',
  small: 'Better accuracy, moderate speed',
  medium: 'High accuracy, slower',
  'large-v3': 'Best accuracy, slowest',
};

export const AI_MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-4o-mini': 'Fast & affordable',
  'gpt-4o': 'Best OpenAI model',
  'gpt-4-turbo': 'High quality, vision capable',
  'claude-sonnet-4-20250514': 'Best quality & reasoning',
  'claude-haiku-4-20250414': 'Fast & lightweight',
};
