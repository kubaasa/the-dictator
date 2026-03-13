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
  durationSeconds: number;
  appName?: string;
  audioPath?: string;
  mode?: string;
}

export type TranscriptionEngine = 'local' | 'api';
export type WidgetType = 'voicebar';
export type AIProviderType = 'openai' | 'anthropic' | 'ollama' | 'none';
export type DictationMode = 'voice' | 'email' | 'chat' | 'note' | 'custom';
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
    shortcuts: {
      toggleRecording: string;
      cancelRecording: string;
      modeSelect: string;
    };
    mode: HotkeyMode;
  };
  dictation: {
    currentMode: DictationMode;
    customPrompt: string;
    autoPaste: boolean;
    restoreClipboard: boolean;
  };
  vocabulary: string[];
  widget: {
    activeWidget: WidgetType;
    size: number; // 0–1 continuous scale
    opacity: number;
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
    shortcuts: {
      toggleRecording: 'Ctrl+Shift+Space',
      cancelRecording: 'Ctrl+Shift+Escape',
      modeSelect: 'Ctrl+Shift+M',
    },
    mode: 'toggle',
  },
  dictation: {
    currentMode: 'voice',
    customPrompt: '',
    autoPaste: true,
    restoreClipboard: true,
  },
  vocabulary: [],
  widget: {
    activeWidget: 'voicebar',
    size: 0.5,
    opacity: 1.0,
  },
  general: {
    autoStart: false,
    minimizeToTray: true,
    overlayPosition: 'top-right',
  },
};
