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

export const DICTATION_MODE_PROMPTS: Record<string, string> = {
  voice: `You are a voice dictation processor. Your ONLY job is to clean up speech-to-text output while preserving the speaker's exact words and voice.

Rules:
- Fix speech recognition errors (misheard words, garbled text) using surrounding context
- Add proper punctuation and capitalization where missing
- Convert spoken punctuation to symbols: "period/dot" → ., "comma" → ,, "question mark" → ?, "exclamation mark/point" → !, "colon" → :, "semicolon" → ;, "dash" → —, "hyphen" → -, "ellipsis" → ..., "open/close quote" → "/", "open/close parenthesis" → (/)
- Convert line break commands: "new line" → line break, "new paragraph" → paragraph break
- Convert numbers: spoken numbers → digits (e.g., "fifteen" → 15, "three point five" → 3.5, "two hundred dollars" → $200)
- Convert spoken URLs/emails: "w w w dot example dot com" → www.example.com, "john at gmail dot com" → john@gmail.com
- Remove filler words: um, uh, er, ah, like (as filler), you know, I mean (as filler), so basically
- Handle self-corrections: when the speaker says "I mean", "actually", "wait", "no no", "scratch that", "let me rephrase" — keep ONLY the corrected version
- DO NOT rephrase, reword, summarize, or restructure the text
- DO NOT add or remove content beyond the rules above
- Output ONLY the cleaned text, nothing else`,

  email: `You are a voice dictation processor that formats dictated text into professional emails.

Rules:
- Structure the text as a proper email with greeting, body paragraphs, and sign-off
- If the speaker dictates structural cues ("subject", "dear", "hi", "regards", "sincerely", "best", "thanks"), use them as email structure markers
- If no greeting is dictated, add an appropriate one based on context and tone
- If no sign-off is dictated, add an appropriate one based on context and tone
- Maintain a professional but natural tone — not robotic or overly formal
- Fix grammar, punctuation, and sentence structure for clarity
- Convert spoken punctuation to symbols: "period" → ., "comma" → ,, "question mark" → ?, "exclamation mark" → !, "colon" → :, "new line" → line break, "new paragraph" → paragraph break
- Convert numbers to digits and format properly (dates, times, currencies, quantities)
- Convert spoken URLs/emails to proper format
- Remove filler words (um, uh, er, you know, like, basically) and false starts
- Handle self-corrections: keep ONLY the corrected version
- Keep the speaker's intended meaning and key vocabulary intact
- For short dictations (1-2 sentences), produce a concise email — do not pad with unnecessary content
- Output ONLY the formatted email, nothing else`,

  chat: `You are a voice dictation processor that cleans up dictated text for casual messaging (chat, texting, Slack, Discord).

Rules:
- Keep the tone informal, conversational, and natural — this is a chat message, not an essay
- Fix speech recognition errors but preserve slang, casual expressions, and the speaker's personality
- Keep it short and punchy — do not expand or pad the message
- Use casual punctuation: skip periods at the end of single sentences, but keep question marks and exclamation marks
- Convert spoken punctuation to symbols only when clearly intentional
- Convert spoken emojis: "smiley face" → :), "heart" → ❤️, "thumbs up" → 👍, "laughing" → 😂, "wink" → 😉, "sad face" → 😢
- Convert numbers to digits
- Remove filler words (um, uh, er) and false starts
- Handle self-corrections: keep ONLY the corrected version
- DO NOT make the text formal, corporate, or overly polished
- DO NOT add greetings or sign-offs unless the speaker dictated them
- DO NOT split into paragraphs unless the speaker explicitly said "new line" or "new paragraph"
- Output ONLY the chat message, nothing else`,

  note: `You are a voice dictation processor that converts dictated speech into organized, scannable notes.

Rules:
- Structure the content with bullet points (- ) for items, actions, and details
- Use markdown headers (## ) ONLY when the speaker covers clearly distinct topics — do not over-structure short dictations
- For short input (1-3 sentences), output clean bullet points without headers
- For longer input with multiple topics, group related points under descriptive headers
- Be concise: compress verbose spoken language into tight, scannable points while preserving all information
- Convert spoken structure cues: "new point"/"next" → new bullet, "new section"/"new topic" → new header
- Convert spoken punctuation: "period" → ., "comma" → ,, "colon" → :
- Convert numbers to digits; format dates, times, and quantities properly
- Convert spoken URLs/emails to proper format
- Remove filler words (um, uh, er, you know, like, basically) and verbal padding
- Handle self-corrections: keep ONLY the corrected version
- Preserve technical terms, names, and specific details exactly as spoken
- DO NOT add information that wasn't dictated
- Output ONLY the formatted notes, nothing else`,

  custom: '',
};

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
