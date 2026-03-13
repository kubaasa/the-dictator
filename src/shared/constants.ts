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

  // App
  APP_QUIT: 'app:quit',
  APP_SHOW_SETTINGS: 'app:show-settings',
  APP_OPEN_MODELS_FOLDER: 'app:open-models-folder',
} as const;

export const DICTATION_MODE_PROMPTS: Record<string, string> = {
  email: `You are a dictation assistant. Rewrite the following dictated text as a well-structured, professional email. Fix grammar, punctuation, and formatting. Keep the original meaning and tone. Output ONLY the processed text, no explanations.`,
  chat: `You are a dictation assistant. Clean up the following dictated text for a casual chat message. Fix obvious errors but keep the informal, conversational tone. Output ONLY the processed text, no explanations.`,
  note: `You are a dictation assistant. Convert the following dictated text into a concise, well-organized note. Use bullet points where appropriate. Fix grammar and punctuation. Output ONLY the processed text, no explanations.`,
};
