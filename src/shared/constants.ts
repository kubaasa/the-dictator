export const IPC = {
  // Recording
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_DATA: 'recording:data',
  RECORDING_STATE_CHANGED: 'recording:state-changed',

  // Audio
  AUDIO_SAVE_WAV: 'audio:save-wav',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_ON_CHANGE: 'settings:on-change',

  // Hotkey → renderer (main tells renderer to toggle recording)
  HOTKEY_TOGGLE: 'hotkey:toggle',

  // Transcription
  TRANSCRIPTION_START: 'transcription:start',
  TRANSCRIPTION_RESULT: 'transcription:result',
  TRANSCRIPTION_ERROR: 'transcription:error',

  // Model
  MODEL_STATUS: 'model:status',
  MODEL_DOWNLOAD: 'model:download',
  MODEL_DOWNLOAD_CANCEL: 'model:download:cancel',
  MODEL_DOWNLOAD_PROGRESS: 'model:download:progress',
  MODEL_DOWNLOAD_DONE: 'model:download:done',
  MODEL_DOWNLOAD_ERROR: 'model:download:error',

  // App
  APP_QUIT: 'app:quit',
  APP_SHOW_SETTINGS: 'app:show-settings',
  APP_OPEN_RECORDINGS_FOLDER: 'app:open-recordings-folder',
  APP_OPEN_MODELS_FOLDER: 'app:open-models-folder',
} as const;
