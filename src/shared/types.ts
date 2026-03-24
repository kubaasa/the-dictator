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

export type TranscriptionEngine = 'local' | 'cloud';
export type WidgetType = 'voicebar' | 'maxi';
export type AIProviderType = 'openai' | 'anthropic';
export type RecordingState = 'idle' | 'initializing' | 'recording' | 'transcribing' | 'processing' | 'done' | 'error';
export type HotkeyMode = 'toggle' | 'push-to-talk';

export interface VocabularyEntry {
  id: string;
  input: string;
  replacement?: string;
}

export interface AppSettings {
  transcription: {
    engine: TranscriptionEngine;
    localModelSize: string;
    language: string;
    groqApiKey: string;
  };
  ai: {
    provider: AIProviderType;
    openaiApiKey: string;
    openaiModel: string;
    anthropicApiKey: string;
    anthropicModel: string;
    temperature: number;
  };
  hotkey: {
    shortcuts: {
      toggleRecording: string;
      cancelRecording: string;
      pushToTalk: string;
      showWindow: string;
    };
    mode: HotkeyMode;
  };
  dictation: {
    aiPostProcessing: boolean;
    customPrompt: string;
    autoPaste: boolean;
    restoreClipboard: boolean;
  };
  audio: {
    deviceId: string;
  };
  vocabulary: VocabularyEntry[];
  widget: {
    activeWidget: WidgetType;
    x?: number;
    y?: number;
  };
  general: {
    autoStart: boolean;
    minimizeToTray: boolean;
    overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
    firstRunComplete: boolean;
    widgetTooltipShown: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  transcription: {
    engine: 'cloud',
    localModelSize: 'base',
    language: 'en',
    groqApiKey: '',
  },
  ai: {
    provider: 'openai',
    openaiApiKey: '',
    openaiModel: 'gpt-4.1-nano',
    anthropicApiKey: '',
    anthropicModel: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
  },
  hotkey: {
    shortcuts: {
      toggleRecording: 'Ctrl+Space',
      cancelRecording: 'Escape',
      pushToTalk: 'Ctrl+X',
      showWindow: 'Ctrl+Shift+D',
    },
    mode: 'toggle',
  },
  dictation: {
    aiPostProcessing: true,
    customPrompt: `Your task is to reformat the user message according to the following guidelines:

**PRIMARY RULE: PRESERVE THE ORIGINAL MESSAGE**
- Only make changes when you are absolutely certain they improve accuracy
- When in doubt, leave the original text unchanged
- The names/vocabulary list is for CONTEXT and SPELLING HELP only - do NOT randomly substitute words

1. **Context Analysis**: Consider the application context, focused element, vocabulary, and names provided as background information to understand the user's environment.

2. **Conservative Spelling Correction**:
   - Only fix obvious spelling errors where the intended word is clear
   - Use the vocabulary/names list to help identify correct spellings of technical terms
   - Example: "Slak" → "Slack" (if Slack is in the names list)
   - DO NOT replace valid words with different words from the list

3. **Self-Corrections**: Apply user corrections within the message.
   Example: "Let's meet at 8pm actually I mean 9pm" → "Let's meet at 9pm"

4. **Name Handling**:
   - **CRITICAL**: Only change names if there's a clear misspelling with an obvious correction
   - **Direct messaging contexts**: Prefer actual names over usernames to maintain natural flow, do not use @username for the person you are directly messaging
   - **Group conversations**: Use @username when directly addressing someone and an exact username match exists in the names list
   - **Only use @username**: When "At [name]" directly precedes a name AND an exact username match exists
   - **Don't replace partial matches**: "John" should not become "@JohnC12345"
   - **Keep nicknames unchanged**: Preserve short names/nicknames as they appear - do NOT replace them with names from the list
   - **Name replacement criteria**: Only replace a name if:
     * Do not replace names that are very different from the one in the list e.g. "John" → "Fred"
     * It's clearly a misspelling of a name in the list (e.g., "Jhon" → "John")
     * There's an exact match in the names list
     * The context clearly indicates it should be corrected
   - **When in doubt, preserve the original**: If uncertain whether something is a nickname, misspelling, or intentional name, keep it unchanged

5. **URL/Email Formatting**: Convert spelled-out formats.
   Examples: "John at Example dot com" → "john@example.com", "Arcade dot net" → "arcade.net"

6. **Preserve Intent**: Maintain original meaning and tone without adding new content.

**CRITICAL REQUIREMENTS**:
- Only make changes when confident about corrections
- Don't include placeholders in output

Respond with ONLY the reformatted message wrapped in the required tags.`,
    autoPaste: true,
    restoreClipboard: true,
  },
  audio: {
    deviceId: '',
  },
  vocabulary: [],
  widget: {
    activeWidget: 'voicebar',
  },
  general: {
    autoStart: false,
    minimizeToTray: true,
    overlayPosition: 'top-right',
    firstRunComplete: false,
    widgetTooltipShown: false,
  },
};

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  error?: string;
}
