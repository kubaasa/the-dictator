export interface TranscriptionResult {
  text: string;
}

export type DictationMode = 'voice' | 'message' | 'email' | 'chat' | 'custom';
export type TranscriptionEngine = 'local' | 'api';
export type AIProviderType = 'openai' | 'anthropic' | 'ollama' | 'none';
export type RecordingState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'done' | 'error';
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
  };
  hotkey: {
    shortcut: string;
    mode: HotkeyMode;
  };
  dictation: {
    currentMode: DictationMode;
    customPrompt: string;
    autoPaste: boolean;
    restoreClipboard: boolean;
  };
  vocabulary: string[];
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
    language: 'auto',
    openaiApiKey: '',
  },
  ai: {
    provider: 'none',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicApiKey: '',
    anthropicModel: 'claude-sonnet-4-20250514',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
  },
  hotkey: {
    shortcut: 'Ctrl+Shift+Space',
    mode: 'toggle',
  },
  dictation: {
    currentMode: 'voice',
    customPrompt: '',
    autoPaste: true,
    restoreClipboard: true,
  },
  vocabulary: [],
  general: {
    autoStart: false,
    minimizeToTray: true,
    overlayPosition: 'top-right',
  },
};
