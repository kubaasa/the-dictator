import { useState, useEffect, useRef, useCallback } from 'react';
import type { ModelStatus } from '../hooks/useModelStatus';
import type { DictationMode, AIProviderType } from '../../shared/types';
import { DICTATION_MODE_PROMPTS, WHISPER_MODEL_DESCRIPTIONS, AI_MODEL_DESCRIPTIONS, OPENAI_MODELS, ANTHROPIC_MODELS } from '../../shared/constants';

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

const DICTATION_MODES: { id: DictationMode; label: string; icon: string }[] = [
  { id: 'voice', label: 'Voice', icon: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z' },
  { id: 'email', label: 'Email', icon: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75' },
  { id: 'chat', label: 'Chat', icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z' },
  { id: 'note', label: 'Note', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z' },
  { id: 'custom', label: 'Custom', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' },
];

const AI_PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'none', label: 'None (no AI)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama (local)' },
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
  provider,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saved: boolean;
  provider: 'openai' | 'anthropic' | 'whisper';
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
  const [engine, setEngine] = useState<'local' | 'api'>('api');
  const [modelSize, setModelSize] = useState('base');
  const [language, setLanguage] = useState('en');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // AI + Dictation state
  const [currentMode, setCurrentMode] = useState<DictationMode>('voice');
  const [modePrompts, setModePrompts] = useState<Record<DictationMode, string>>({
    voice: DICTATION_MODE_PROMPTS.voice,
    email: DICTATION_MODE_PROMPTS.email,
    chat: DICTATION_MODE_PROMPTS.chat,
    note: DICTATION_MODE_PROMPTS.note,
    custom: DICTATION_MODE_PROMPTS.custom,
  });
  const [aiProvider, setAiProvider] = useState<AIProviderType>('none');
  const [aiOpenaiKey, setAiOpenaiKey] = useState('');
  const [aiOpenaiModel, setAiOpenaiModel] = useState('gpt-4o-mini');
  const [openaiModels, setOpenaiModels] = useState(OPENAI_MODELS);
  const [aiAnthropicKey, setAiAnthropicKey] = useState('');
  const [aiAnthropicModel, setAiAnthropicModel] = useState('claude-sonnet-4-6');
  const [aiOllamaUrl, setAiOllamaUrl] = useState('http://localhost:11434');
  const [aiOllamaModel, setAiOllamaModel] = useState('llama3');
  const [aiKeySaved, setAiKeySaved] = useState(false);
  const [temperature, setTemperature] = useState(0.3);

  // Test prompt state
  const [testExpanded, setTestExpanded] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState('');

  const fetchOpenAIModels = useCallback(async () => {
    const res = await window.dictator.ai.getOpenAIModels();
    if (res.success && res.models.length > 0) setOpenaiModels(res.models);
  }, []);

  // Load settings
  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
      setCurrentMode(s.dictation.currentMode);
      if (s.dictation.modePrompts) setModePrompts(s.dictation.modePrompts);
      setAiProvider(s.ai.provider);
      setAiOpenaiKey(s.ai.openaiApiKey);
      setAiOpenaiModel(s.ai.openaiModel);
      setAiAnthropicKey(s.ai.anthropicApiKey);
      setAiAnthropicModel(s.ai.anthropicModel);
      setAiOllamaUrl(s.ai.ollamaUrl);
      setAiOllamaModel(s.ai.ollamaModel);
      setTemperature(s.ai.temperature ?? 0.3);
      if (s.ai.provider === 'openai' && s.ai.openaiApiKey) fetchOpenAIModels();
    });

    const unsub = window.dictator.onSettingsChange((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
      setCurrentMode(s.dictation.currentMode);
      if (s.dictation.modePrompts) setModePrompts(s.dictation.modePrompts);
      setAiProvider(s.ai.provider);
      setAiOpenaiKey(s.ai.openaiApiKey);
      setAiOpenaiModel(s.ai.openaiModel);
      setAiAnthropicKey(s.ai.anthropicApiKey);
      setAiAnthropicModel(s.ai.anthropicModel);
      setAiOllamaUrl(s.ai.ollamaUrl);
      setAiOllamaModel(s.ai.ollamaModel);
      setTemperature(s.ai.temperature ?? 0.3);
    });
    return unsub;
  }, []);

  // Handlers
  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, language: newLang },
    });
  };

  const handleModelChange = async (newSize: string) => {
    setModelSize(newSize);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, localModelSize: newSize },
    });
    recheck();
  };

  const handleApiKeySave = async () => {
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, openaiApiKey: apiKey },
    });
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  const handleModeChange = async (mode: DictationMode) => {
    setCurrentMode(mode);
    setTestExpanded(false);
    setTestResult('');
    setTestError('');
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      dictation: { ...current.dictation, currentMode: mode },
    });
  };

  const handlePromptChange = (mode: DictationMode, value: string) => {
    setModePrompts((prev) => ({ ...prev, [mode]: value }));
  };

  const handlePromptSave = async () => {
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      dictation: { ...current.dictation, modePrompts },
    });
  };

  const handlePromptReset = async (mode: DictationMode) => {
    const defaultPrompt = DICTATION_MODE_PROMPTS[mode] ?? '';
    const updated = { ...modePrompts, [mode]: defaultPrompt };
    setModePrompts(updated);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      dictation: { ...current.dictation, modePrompts: updated },
    });
  };

  const handleTestPrompt = async () => {
    if (!testInput.trim()) return;
    setTestLoading(true);
    setTestError('');
    setTestResult('');
    try {
      const res = await window.dictator.ai.testPrompt(testInput, modePrompts[currentMode]);
      if (res.success) {
        setTestResult(res.result ?? '');
      } else {
        setTestError(res.error ?? 'Unknown error');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestLoading(false);
    }
  };

  const handleProviderChange = async (provider: AIProviderType) => {
    setAiProvider(provider);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      ai: { ...current.ai, provider },
    });
  };

  const handleAiModelChange = async (model: string) => {
    const current = await window.dictator.getSettings();
    if (aiProvider === 'openai') {
      setAiOpenaiModel(model);
      await window.dictator.setSettings({ ai: { ...current.ai, openaiModel: model } });
    } else if (aiProvider === 'anthropic') {
      setAiAnthropicModel(model);
      await window.dictator.setSettings({ ai: { ...current.ai, anthropicModel: model } });
    }
  };

  const handleAiKeySave = async () => {
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
  };

  const handleTemperatureChange = async (value: number) => {
    setTemperature(value);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      ai: { ...current.ai, temperature: value },
    });
  };

  const isAiEnabled = aiProvider !== 'none';
  const isAiConfigured =
    aiProvider === 'openai' ? !!aiOpenaiKey :
    aiProvider === 'anthropic' ? !!aiAnthropicKey :
    aiProvider === 'ollama' ? !!aiOllamaUrl :
    false;

  const currentPrompt = modePrompts[currentMode] ?? '';
  const defaultPrompt = DICTATION_MODE_PROMPTS[currentMode] ?? '';
  const isPromptModified = currentPrompt !== defaultPrompt;

  const currentAiModels = aiProvider === 'openai' ? openaiModels : aiProvider === 'anthropic' ? ANTHROPIC_MODELS : [];
  const currentAiModel = aiProvider === 'openai' ? aiOpenaiModel : aiProvider === 'anthropic' ? aiAnthropicModel : '';

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-8">

        {/* ── Section 1: Dictation Modes ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Dictation Mode
          </h2>

          {/* Mode selector pills */}
          <div className="flex gap-2">
            {DICTATION_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 transition-all duration-200 cursor-pointer ${
                  currentMode === mode.id
                    ? 'border-red-600/50 bg-red-600/10 text-red-400'
                    : 'border-neutral-800 bg-[#141414] text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                }`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={mode.icon} />
                </svg>
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em]">{mode.label}</span>
              </button>
            ))}
          </div>

          {(!isAiEnabled || !isAiConfigured) && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-green-800/40 bg-green-950/20 px-4 py-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-green-500">[IDLE]</span>
              </div>
              <span className="text-xs text-green-400/70">
                {!isAiEnabled
                  ? 'AI processing disabled — select a provider below to activate dictation modes.'
                  : 'Provider selected — enter your API key below and click Save to activate dictation modes.'}
              </span>
            </div>
          )}

          {/* Expandable prompt editor */}
          <div
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: '600px', opacity: 1 }}
          >
            <div className="mt-4 rounded-xl border border-neutral-800 bg-[#141414] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                  System Prompt
                </span>
                {isPromptModified && (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600/70">Modified</span>
                )}
              </div>
              <textarea
                value={currentPrompt}
                onChange={(e) => handlePromptChange(currentMode, e.target.value)}
                onBlur={handlePromptSave}
                placeholder="Enter system prompt..."
                rows={4}
                className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-4 py-3 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-red-600/30 resize-none leading-relaxed"
              />

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => handlePromptReset(currentMode)}
                  disabled={!isPromptModified}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                    isPromptModified
                      ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 cursor-pointer'
                      : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                  }`}
                >
                  Reset to Default
                </button>
                <button
                  onClick={() => setTestExpanded((o) => !o)}
                  disabled={!isAiEnabled}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                    isAiEnabled
                      ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 cursor-pointer'
                      : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                  }`}
                  title={!isAiEnabled ? 'Select an AI provider first' : ''}
                >
                  {testExpanded ? 'Hide Test' : 'Test Prompt'}
                </button>
              </div>

              {/* Test prompt panel */}
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  testExpanded && isAiEnabled ? 'max-h-[400px] opacity-100 mt-4' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="rounded-lg border border-neutral-700/30 bg-neutral-900/50 p-4">
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                    Sample Input
                  </span>
                  <textarea
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="Type or paste sample dictated text..."
                    rows={2}
                    className="w-full rounded-lg border border-neutral-700/50 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-red-600/30 resize-none"
                  />
                  <button
                    onClick={handleTestPrompt}
                    disabled={testLoading || !testInput.trim()}
                    className={`mt-2 rounded-lg px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                      testLoading || !testInput.trim()
                        ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                        : 'bg-red-600/20 text-red-400 hover:bg-red-600/30 cursor-pointer border border-red-600/30'
                    }`}
                  >
                    {testLoading ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Processing...
                      </span>
                    ) : 'Run Test'}
                  </button>

                  {testError && (
                    <p className="mt-2 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                      {testError}
                    </p>
                  )}
                  {testResult && (
                    <div className="mt-2">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-1">
                        Result
                      </span>
                      <div className="rounded-lg border border-green-800/30 bg-green-950/10 px-3 py-2 text-sm text-green-300/80 leading-relaxed">
                        {testResult}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </section>

        {/* ── Section 2: AI Provider ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            AI Provider
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">

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

            {/* API Key */}
            {(aiProvider === 'openai' || aiProvider === 'anthropic') && (
              <div>
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-1">
                  API Key
                </span>
                <ApiKeyInput
                  value={aiProvider === 'openai' ? aiOpenaiKey : aiAnthropicKey}
                  onChange={(v) => aiProvider === 'openai' ? setAiOpenaiKey(v) : setAiAnthropicKey(v)}
                  onSave={handleAiKeySave}
                  saved={aiKeySaved}
                  provider={aiProvider as 'openai' | 'anthropic'}
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

          </div>
        </section>

        {/* ── Section 3: Transcription ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Transcription
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">

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
          </div>

          {/* API key section (transcription) */}
          {engine === 'api' && (
            <div className="mt-4 rounded-xl border border-neutral-800 bg-[#141414] p-5">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-1">
                OpenAI API Key
              </span>
              <p className="text-xs text-neutral-600 mb-3">
                Used for Whisper API transcription. Stored locally, never sent anywhere except OpenAI.
              </p>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                onSave={handleApiKeySave}
                saved={apiKeySaved}
                provider="whisper"
              />
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
