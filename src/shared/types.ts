export interface TranscriptionResult {
  id?: string;
  text: string;
  durationSeconds?: number;
  appName?: string;
}

export interface RecordingEntry {
  id: string;
  date: string;
  text: string;
  wordCount: number;
  /** Word count from raw transcription (before AI processing). Used for accurate stats. */
  rawWordCount: number;
  durationSeconds: number;
  appName?: string;
  audioPath?: string;
  mode?: string;
}

export interface HistoryStats {
  totalWords: number;
  totalSeconds: number;
  totalRecordings: number;
  /** Weighted AVG WPM: totalRawWords / totalMinutes */
  avgWpm: number;
}

export type TranscriptionEngine = 'local' | 'api';
export type WidgetType = 'voicebar' | 'maxi';
export type AIProviderType = 'openai' | 'anthropic' | 'ollama' | 'none';
export type DictationMode = 'voice' | 'email' | 'chat' | 'note' | 'custom';
export type RecordingState = 'idle' | 'initializing' | 'recording' | 'transcribing' | 'processing' | 'done' | 'error';
export type HotkeyMode = 'toggle' | 'push-to-talk';

export interface AppSettings {
  transcription: {
    engine: TranscriptionEngine;
    localModelSize: string;
    language: string;
    openaiApiKey: string;
  };
  ai: {
    provider: AIProviderType;
    openaiApiKey: string;
    openaiModel: string;
    anthropicApiKey: string;
    anthropicModel: string;
    ollamaUrl: string;
    ollamaModel: string;
    temperature: number;
  };
  hotkey: {
    shortcuts: {
      toggleRecording: string;
      cancelRecording: string;
      pushToTalk: string;
      modeSelect: string;
      showWindow: string;
    };
    mode: HotkeyMode;
  };
  dictation: {
    currentMode: DictationMode;
    modePrompts: Record<DictationMode, string>;
    autoPaste: boolean;
    restoreClipboard: boolean;
  };
  vocabulary: string[];
  widget: {
    activeWidget: WidgetType;
    x?: number;
    y?: number;
  };
  general: {
    autoStart: boolean;
    minimizeToTray: boolean;
    overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcription: {
    engine: 'api',
    localModelSize: 'base',
    language: 'en',
    openaiApiKey: '',
  },
  ai: {
    provider: 'none',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicApiKey: '',
    anthropicModel: 'claude-sonnet-4-6',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
    temperature: 0.3,
  },
  hotkey: {
    shortcuts: {
      toggleRecording: 'Ctrl+Shift+Space',
      cancelRecording: 'Ctrl+Shift+Escape',
      pushToTalk: 'Ctrl+X',
      modeSelect: 'Ctrl+Shift+M',
      showWindow: 'Ctrl+Shift+D',
    },
    mode: 'toggle',
  },
  dictation: {
    currentMode: 'voice',
    modePrompts: {
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
    },
    autoPaste: true,
    restoreClipboard: true,
  },
  vocabulary: [],
  widget: {
    activeWidget: 'voicebar',
  },
  general: {
    autoStart: false,
    minimizeToTray: true,
    overlayPosition: 'top-right',
  },
};
