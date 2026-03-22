import { useState, useEffect, useRef, useCallback } from 'react';
import type { ModelStatus } from '../hooks/useModelStatus';
import type { AIProviderType, TranscriptionEngine, AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { WHISPER_MODEL_DESCRIPTIONS, AI_MODEL_DESCRIPTIONS, OPENAI_MODELS, ANTHROPIC_MODELS } from '../../shared/constants';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large-v3', label: 'Large v3' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
];

const AI_PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'none', label: 'None (no AI)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];


function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '●'.repeat(key.length);
  const prefix = key.slice(0, 4);
  const suffix = key.slice(-4);
  return `${prefix}${'●'.repeat(Math.min(key.length - 8, 16))}${suffix}`;
}

function ApiKeyInput({
  value,
  onChange,
  onSave,
  saved,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saved: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEmpty = !value;
  const showMasked = !isEmpty && !focused;

  const placeholder = isEmpty
    ? '[NO SIGNAL] paste access key...'
    : '';

  return (
    <div className="flex gap-2">
      <div
        className="flex-1 relative cursor-text"
        onClick={() => { if (!focused) inputRef.current?.focus(); }}
      >
        {showMasked ? (
          <div className="flex items-center rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm font-mono text-neutral-500 tracking-wider">
            <span className="text-red-600/40 mr-2">[ENC]</span>
            <span className="text-neutral-600">{maskKey(value)}</span>
          </div>
        ) : (
          <input
            ref={inputRef}
            type={focused ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-red-600/30"
          />
        )}
      </div>
      <button
        onClick={onSave}
        className="rounded-lg bg-neutral-700 px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-200 transition-colors hover:bg-neutral-600 cursor-pointer"
      >
        {saved ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}

export function ModesPage(props: ModelStatus) {
  const { downloaded, downloadedModels, downloading, progress, error, download, cancel, recheck } = props;

  // Transcription state
  const [engine, setEngine] = useState<TranscriptionEngine>('api');
  const [modelSize, setModelSize] = useState('base');
  const [language, setLanguage] = useState('en');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqKeySaved, setGroqKeySaved] = useState(false);

  // AI + Dictation state
  const [aiPostProcessing, setAiPostProcessing] = useState(DEFAULT_SETTINGS.dictation.aiPostProcessing);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_SETTINGS.dictation.customPrompt);
  const [aiProvider, setAiProvider] = useState<AIProviderType>('none');
  const [aiOpenaiKey, setAiOpenaiKey] = useState('');
  const [aiOpenaiModel, setAiOpenaiModel] = useState('gpt-4.1-nano');
  const [openaiModels, setOpenaiModels] = useState(OPENAI_MODELS);
  const [aiAnthropicKey, setAiAnthropicKey] = useState('');
  const [aiAnthropicModel, setAiAnthropicModel] = useState('claude-haiku-4-5-20251001');
  const [aiOllamaUrl, setAiOllamaUrl] = useState('http://localhost:11434');
  const [aiOllamaModel, setAiOllamaModel] = useState('llama3');
  const [aiKeySaved, setAiKeySaved] = useState(false);

  // Output settings (read-only for pipeline bar)
  const [autoPaste, setAutoPaste] = useState(DEFAULT_SETTINGS.dictation.autoPaste);

  const fetchOpenAIModels = useCallback(async () => {
    const res = await window.dictator.ai.getOpenAIModels();
    if (res.success && res.models.length > 0) setOpenaiModels(res.models);
  }, []);

  const syncFromSettings = useCallback((s: AppSettings) => {
    setEngine(s.transcription.engine);
    setModelSize(s.transcription.localModelSize);
    setLanguage(s.transcription.language);
    setApiKey(s.transcription.openaiApiKey);
    setGroqApiKey(s.transcription.groqApiKey);
    setAiPostProcessing(s.dictation.aiPostProcessing);
    setCustomPrompt(s.dictation.customPrompt);
    setAutoPaste(s.dictation.autoPaste);
    setAiProvider(s.ai.provider);
    setAiOpenaiKey(s.ai.openaiApiKey);
    setAiOpenaiModel(s.ai.openaiModel);
    setAiAnthropicKey(s.ai.anthropicApiKey);
    setAiAnthropicModel(s.ai.anthropicModel);
    setAiOllamaUrl(s.ai.ollamaUrl);
    setAiOllamaModel(s.ai.ollamaModel);
  }, []);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      syncFromSettings(s);
      if (s.ai.provider === 'openai' && s.ai.openaiApiKey) fetchOpenAIModels();
    });

    const unsub = window.dictator.onSettingsChange(syncFromSettings);
    return unsub;
  }, [syncFromSettings, fetchOpenAIModels]);

  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, language: newLang },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to save language:', err);
    }
  };

  const handleModelChange = async (newSize: string) => {
    setModelSize(newSize);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, localModelSize: newSize },
      });
      recheck();
    } catch (err) {
      console.error('[ModesPage] Failed to save model:', err);
    }
  };

  const handleEngineChange = async (newEngine: TranscriptionEngine) => {
    setEngine(newEngine);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, engine: newEngine },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to save engine:', err);
    }
  };

  const handleApiKeySave = async () => {
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, openaiApiKey: apiKey },
      });
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 2000);
    } catch (err) {
      console.error('[ModesPage] Failed to save API key:', err);
    }
  };

  const handleGroqKeySave = async () => {
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, groqApiKey: groqApiKey },
      });
      setGroqKeySaved(true);
      setTimeout(() => setGroqKeySaved(false), 2000);
    } catch (err) {
      console.error('[ModesPage] Failed to save Groq key:', err);
    }
  };

  const handleToggleAi = async () => {
    const next = !aiPostProcessing;
    setAiPostProcessing(next);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, aiPostProcessing: next },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to toggle AI:', err);
    }
  };

  const handlePromptChange = (value: string) => {
    setCustomPrompt(value);
  };

  const handlePromptSave = async () => {
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, customPrompt },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to save prompt:', err);
    }
  };

  const handlePromptReset = async () => {
    setCustomPrompt(DEFAULT_SETTINGS.dictation.customPrompt);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, customPrompt: DEFAULT_SETTINGS.dictation.customPrompt },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to reset prompt:', err);
    }
  };

  const handleProviderChange = async (provider: AIProviderType) => {
    setAiProvider(provider);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        ai: { ...current.ai, provider },
      });
    } catch (err) {
      console.error('[ModesPage] Failed to save provider:', err);
    }
  };

  const handleAiModelChange = async (model: string) => {
    try {
      const current = await window.dictator.getSettings();
      if (aiProvider === 'openai') {
        setAiOpenaiModel(model);
        await window.dictator.setSettings({ ai: { ...current.ai, openaiModel: model } });
      } else if (aiProvider === 'anthropic') {
        setAiAnthropicModel(model);
        await window.dictator.setSettings({ ai: { ...current.ai, anthropicModel: model } });
      }
    } catch (err) {
      console.error('[ModesPage] Failed to save AI model:', err);
    }
  };

  const handleAiKeySave = async () => {
    try {
      const current = await window.dictator.getSettings();
      const updates: Record<string, unknown> = {};
      if (aiProvider === 'openai') {
        updates.openaiApiKey = aiOpenaiKey;
        updates.openaiModel = aiOpenaiModel;
      } else if (aiProvider === 'anthropic') {
        updates.anthropicApiKey = aiAnthropicKey;
        updates.anthropicModel = aiAnthropicModel;
      } else if (aiProvider === 'ollama') {
        updates.ollamaUrl = aiOllamaUrl;
        updates.ollamaModel = aiOllamaModel;
      }
      await window.dictator.setSettings({
        ai: { ...current.ai, ...updates },
      });
      if (aiProvider === 'openai') fetchOpenAIModels();
      setAiKeySaved(true);
      setTimeout(() => setAiKeySaved(false), 2000);
    } catch (err) {
      console.error('[ModesPage] Failed to save AI key:', err);
    }
  };

  const isAiEnabled = aiProvider !== 'none';
  const isAiConfigured =
    aiProvider === 'openai' ? !!aiOpenaiKey :
    aiProvider === 'anthropic' ? !!aiAnthropicKey :
    aiProvider === 'ollama' ? !!aiOllamaUrl :
    false;

  const isPromptModified = customPrompt !== DEFAULT_SETTINGS.dictation.customPrompt;

  const currentAiModels = aiProvider === 'openai' ? openaiModels : aiProvider === 'anthropic' ? ANTHROPIC_MODELS : [];
  const currentAiModel = aiProvider === 'openai' ? aiOpenaiModel : aiProvider === 'anthropic' ? aiAnthropicModel : '';

  // ── Pipeline status bar helpers ──
  const transcriptionSummary = engine === 'groq' ? 'Groq API' : engine === 'api' ? 'Whisper API' : `Local (${modelSize.charAt(0).toUpperCase() + modelSize.slice(1)})`;
  const languageLabel = language === 'en' ? 'EN' : 'PL';

  const aiModelLabel = aiProvider === 'openai'
    ? openaiModels.find(m => m.value === aiOpenaiModel)?.label ?? aiOpenaiModel
    : aiProvider === 'anthropic'
      ? ANTHROPIC_MODELS.find(m => m.value === aiAnthropicModel)?.label ?? aiAnthropicModel
      : aiProvider === 'ollama' ? aiOllamaModel : '';

  const aiSummary = !aiPostProcessing
    ? 'OFF'
    : aiProvider === 'none'
      ? 'No provider'
      : !isAiConfigured
        ? `${aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'anthropic' ? 'Anthropic' : 'Ollama'} / No key`
        : `${aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'anthropic' ? 'Anthropic' : 'Ollama'} / ${aiModelLabel}`;

  const transcriptionStatus: 'ready' | 'warning' | 'off' =
    engine === 'groq' ? (groqApiKey ? 'ready' : 'warning') :
    engine === 'api' ? (apiKey ? 'ready' : 'warning') : (downloaded ? 'ready' : 'warning');
  const aiStatus: 'ready' | 'warning' | 'off' =
    !aiPostProcessing ? 'off' : (isAiEnabled && isAiConfigured) ? 'ready' : 'warning';
  const outputStatus: 'ready' | 'warning' | 'off' = 'ready';

  const statusColor = (s: 'ready' | 'warning' | 'off') =>
    s === 'ready' ? 'bg-green-600/60' : s === 'warning' ? 'bg-amber-600/60' : 'bg-neutral-700';

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-8">

        {/* ── Pipeline Status Bar ── */}
        <div className="rounded-xl border border-neutral-800 bg-[#0f0f0f] p-4">
          <div className="flex items-center">
            {/* Stage 01: Transcribe */}
            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 01</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">Transcribe</span>
              <span className="text-xs text-neutral-500">{transcriptionSummary} ({languageLabel})</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(transcriptionStatus)}`} />
            </div>

            {/* Connector */}
            <svg className="h-4 w-4 shrink-0 text-neutral-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>

            {/* Stage 02: AI Process */}
            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 02</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">AI Process</span>
              <span className="text-xs text-neutral-500">{aiSummary}</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(aiStatus)}`} />
            </div>

            {/* Connector */}
            <svg className="h-4 w-4 shrink-0 text-neutral-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>

            {/* Stage 03: Output */}
            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 03</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">Output</span>
              <span className="text-xs text-neutral-500">{autoPaste ? 'Auto-paste' : 'Clipboard only'}</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(outputStatus)}`} />
            </div>
          </div>
        </div>

        {/* ── Section 1: Transcription ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Transcription
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">

            {/* Engine pills */}
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Engine
              </span>
              <div className="flex gap-2">
                {([
                  { value: 'local' as TranscriptionEngine, label: 'Local' },
                  { value: 'api' as TranscriptionEngine, label: 'OpenAI API' },
                  { value: 'groq' as TranscriptionEngine, label: 'Groq' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleEngineChange(opt.value)}
                    className={`rounded-lg border px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer ${
                      engine === opt.value
                        ? 'border-red-600/50 bg-red-600/10 text-red-400'
                        : 'border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language pills */}
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Language
              </span>
              <div className="flex gap-2">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleLanguageChange(opt.value)}
                    className={`rounded-lg border px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer ${
                      language === opt.value
                        ? 'border-red-600/50 bg-red-600/10 text-red-400'
                        : 'border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Whisper model cards */}
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Whisper Model
              </span>
              <div className="grid grid-cols-3 gap-2">
                {MODEL_OPTIONS.map((opt) => {
                  const isSelected = opt.value === modelSize;
                  const isReady = downloadedModels.includes(opt.value);
                  const isDownloading = downloading && isSelected;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleModelChange(opt.value)}
                      disabled={downloading && !isSelected}
                      className={`relative flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-200 ${
                        isSelected
                          ? 'border-red-600/50 bg-red-600/5 cursor-pointer'
                          : downloading
                            ? 'border-neutral-800 bg-[#0f0f0f] opacity-50 cursor-not-allowed'
                            : 'border-neutral-800 bg-[#0f0f0f] hover:border-neutral-700 cursor-pointer'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className={`font-mono text-sm font-semibold ${isSelected ? 'text-red-400' : 'text-neutral-300'}`}>
                          {opt.label}
                        </span>
                        {isReady ? (
                          <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                          </svg>
                        )}
                      </div>
                      <span className="mt-1 text-xs text-neutral-600 leading-tight">
                        {WHISPER_MODEL_DESCRIPTIONS[opt.value]}
                      </span>

                      {/* Download progress inside card */}
                      {isDownloading && (
                        <div className="mt-2 w-full">
                          <div className={`h-1 w-full rounded-full overflow-hidden ${
                            progress === 0 ? 'bg-red-900/40 animate-pulse' : 'bg-neutral-700'
                          }`}>
                            {progress > 0 && (
                              <div
                                className="h-full rounded-full bg-red-600 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="font-mono text-[10px] text-neutral-500">
                              {progress > 0 ? `${progress}%` : 'Preparing...'}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancel(); }}
                              className="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Download button for selected model */}
              {!downloaded && !downloading && (
                <button
                  onClick={download}
                  className="mt-3 rounded-lg bg-red-600/20 border border-red-600/30 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-red-400 transition-colors hover:bg-red-600/30 cursor-pointer"
                >
                  Download Selected Model
                </button>
              )}

              {error && (
                <p className="mt-2 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                  {error}
                </p>
              )}
            </div>

            {/* OpenAI API Key — Transcription */}
            {engine === 'api' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                    OpenAI API Key
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-blue-600/10 text-blue-400 border border-blue-600/20">
                    Whisper
                  </span>
                </div>
                <p className="text-xs text-neutral-600 mb-3">
                  Used for Whisper speech-to-text. Not the same as AI processing key.
                </p>
                <ApiKeyInput
                  value={apiKey}
                  onChange={setApiKey}
                  onSave={handleApiKeySave}
                  saved={apiKeySaved}
                />
              </div>
            )}

            {/* Groq API Key — Transcription */}
            {engine === 'groq' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                    Groq API Key
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-orange-600/10 text-orange-400 border border-orange-600/20">
                    Whisper v3
                  </span>
                </div>
                <p className="text-xs text-neutral-600 mb-3">
                  Groq runs Whisper large-v3 on dedicated hardware — up to 10x faster than local inference.
                </p>
                <ApiKeyInput
                  value={groqApiKey}
                  onChange={setGroqApiKey}
                  onSave={handleGroqKeySave}
                  saved={groqKeySaved}
                />
              </div>
            )}

          </div>
        </section>

        {/* ── Section 2: AI Processing ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            AI Processing
          </h2>

          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">
            {/* Toggle row */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-200">
                  Process with AI
                </span>
                <span className="text-xs text-neutral-500">
                  When enabled, transcribed text is processed through AI before pasting
                </span>
              </div>
              <button
                onClick={handleToggleAi}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  aiPostProcessing ? 'bg-red-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    aiPostProcessing ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* [IDLE] banner */}
            {aiPostProcessing && (!isAiEnabled || !isAiConfigured) && (
              <div className="flex items-center gap-3 rounded-lg border border-green-800/40 bg-green-950/20 px-4 py-3">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-green-500">[IDLE]</span>
                </div>
                <span className="text-xs text-green-400/70">
                  {!isAiEnabled
                    ? 'AI processing enabled but no provider selected — choose one below.'
                    : 'Provider selected — enter your API key below and click Save to activate.'}
                </span>
              </div>
            )}

            {/* All AI config — visible only when toggle is ON */}
            {aiPostProcessing && (
              <>
                {/* Provider pills */}
                <div>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                    Provider
                  </span>
                  <div className="flex gap-2">
                    {AI_PROVIDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleProviderChange(opt.value)}
                        className={`rounded-lg border px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer ${
                          aiProvider === opt.value
                            ? 'border-red-600/50 bg-red-600/10 text-red-400'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI Model cards */}
                {(aiProvider === 'openai' || aiProvider === 'anthropic') && (
                  <div>
                    <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                      Model
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {currentAiModels.map((opt) => {
                        const isSelected = opt.value === currentAiModel;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => handleAiModelChange(opt.value)}
                            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-200 cursor-pointer ${
                              isSelected
                                ? 'border-red-600/50 bg-red-600/5'
                                : 'border-neutral-800 bg-[#0f0f0f] hover:border-neutral-700'
                            }`}
                          >
                            <span className={`font-mono text-sm font-semibold ${isSelected ? 'text-red-400' : 'text-neutral-300'}`}>
                              {opt.label}
                            </span>
                            <span className="mt-1 text-xs text-neutral-600 leading-tight">
                              {AI_MODEL_DESCRIPTIONS[opt.value] ?? ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Ollama config */}
                {aiProvider === 'ollama' && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-1">URL</span>
                      <input
                        type="text"
                        value={aiOllamaUrl}
                        onChange={(e) => setAiOllamaUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-red-600/30"
                      />
                    </div>
                    <div>
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-1">Model</span>
                      <input
                        type="text"
                        value={aiOllamaModel}
                        onChange={(e) => setAiOllamaModel(e.target.value)}
                        placeholder="llama3"
                        className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-red-600/30"
                      />
                    </div>
                  </div>
                )}

                {/* API Key — AI Processing */}
                {(aiProvider === 'openai' || aiProvider === 'anthropic') && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                        API Key
                      </span>
                      {aiProvider === 'openai' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-600/10 text-emerald-400 border border-emerald-600/20">
                          GPT
                        </span>
                      )}
                      {aiProvider === 'anthropic' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-600/10 text-amber-400 border border-amber-600/20">
                          Claude
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 mb-3">
                      Used for AI text processing. Separate from transcription key.
                    </p>
                    <ApiKeyInput
                      value={aiProvider === 'openai' ? aiOpenaiKey : aiAnthropicKey}
                      onChange={(v) => aiProvider === 'openai' ? setAiOpenaiKey(v) : setAiAnthropicKey(v)}
                      onSave={handleAiKeySave}
                      saved={aiKeySaved}
                    />
                  </div>
                )}

                {/* Ollama save */}
                {aiProvider === 'ollama' && (
                  <button
                    onClick={handleAiKeySave}
                    className="self-start rounded-lg bg-neutral-700 px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-200 transition-colors hover:bg-neutral-600 cursor-pointer"
                  >
                    {aiKeySaved ? 'Saved' : 'Save'}
                  </button>
                )}

                {/* ── System Prompt ── */}
                <div className="border-t border-neutral-800 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                        System Prompt
                      </span>
                      {isPromptModified && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600/70">Modified</span>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    onBlur={handlePromptSave}
                    placeholder="Enter system prompt..."
                    rows={6}
                    className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-4 py-3 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-red-600/30 resize-none leading-relaxed"
                  />

                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={handlePromptReset}
                      disabled={!isPromptModified}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                        isPromptModified
                          ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 cursor-pointer'
                          : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                      }`}
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}
