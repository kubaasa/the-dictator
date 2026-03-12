import { useState, useEffect, useRef } from 'react';
import type { ModelStatus } from '../hooks/useModelStatus';
import type { DictationMode, AIProviderType } from '../../shared/types';

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

const DICTATION_MODES: { id: DictationMode; label: string; description: string; icon: string }[] = [
  { id: 'voice', label: 'Voice', description: 'Raw transcription, no AI', icon: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z' },
  { id: 'email', label: 'Email', description: 'Professional, formatted', icon: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75' },
  { id: 'chat', label: 'Chat', description: 'Casual, conversational', icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z' },
  { id: 'note', label: 'Note', description: 'Concise, bullet points', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z' },
  { id: 'custom', label: 'Custom', description: 'Your own prompt', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' },
];

const AI_PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'none', label: 'None (no AI)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama (local)' },
];

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-20250414', label: 'Claude Haiku' },
];


export function ModesPage(props: ModelStatus) {
  const { downloaded, downloadedModels, downloading, progress, error, download, cancel, recheck } = props;
  const [engine, setEngine] = useState<'local' | 'api'>('api');
  const [modelSize, setModelSize] = useState('base');
  const [language, setLanguage] = useState('auto');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  // AI + Dictation state
  const [currentMode, setCurrentMode] = useState<DictationMode>('voice');
  const [customPrompt, setCustomPrompt] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderType>('none');
  const [aiOpenaiKey, setAiOpenaiKey] = useState('');
  const [aiOpenaiModel, setAiOpenaiModel] = useState('gpt-4o-mini');
  const [aiAnthropicKey, setAiAnthropicKey] = useState('');
  const [aiAnthropicModel, setAiAnthropicModel] = useState('claude-sonnet-4-20250514');
  const [aiOllamaUrl, setAiOllamaUrl] = useState('http://localhost:11434');
  const [aiOllamaModel, setAiOllamaModel] = useState('llama3');
  const [aiKeySaved, setAiKeySaved] = useState(false);

  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [aiModelDropdownOpen, setAiModelDropdownOpen] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const aiModelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  useEffect(() => {
    if (!langDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langDropdownOpen]);

  useEffect(() => {
    if (!providerDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(e.target as Node)) {
        setProviderDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [providerDropdownOpen]);

  useEffect(() => {
    if (!aiModelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (aiModelDropdownRef.current && !aiModelDropdownRef.current.contains(e.target as Node)) {
        setAiModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [aiModelDropdownOpen]);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
      setCurrentMode(s.dictation.currentMode);
      setCustomPrompt(s.dictation.customPrompt);
      setAiProvider(s.ai.provider);
      setAiOpenaiKey(s.ai.openaiApiKey);
      setAiOpenaiModel(s.ai.openaiModel);
      setAiAnthropicKey(s.ai.anthropicApiKey);
      setAiAnthropicModel(s.ai.anthropicModel);
      setAiOllamaUrl(s.ai.ollamaUrl);
      setAiOllamaModel(s.ai.ollamaModel);
    });

    const unsub = window.dictator.onSettingsChange((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
      setCurrentMode(s.dictation.currentMode);
      setCustomPrompt(s.dictation.customPrompt);
      setAiProvider(s.ai.provider);
      setAiOpenaiKey(s.ai.openaiApiKey);
      setAiOpenaiModel(s.ai.openaiModel);
      setAiAnthropicKey(s.ai.anthropicApiKey);
      setAiAnthropicModel(s.ai.anthropicModel);
      setAiOllamaUrl(s.ai.ollamaUrl);
      setAiOllamaModel(s.ai.ollamaModel);
    });
    return unsub;
  }, []);

  const handleEngineChange = async (newEngine: 'local' | 'api') => {
    setEngine(newEngine);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, engine: newEngine },
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

  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, language: newLang },
    });
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
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      dictation: { ...current.dictation, currentMode: mode },
    });
  };

  const handleCustomPromptSave = async () => {
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      dictation: { ...current.dictation, customPrompt },
    });
  };

  const handleProviderChange = async (provider: AIProviderType) => {
    setAiProvider(provider);
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      ai: { ...current.ai, provider },
    });
  };

  const handleAiKeySave = async () => {
    const current = await window.dictator.getSettings();
    const updates: Partial<typeof current.ai> = {};
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
    setAiKeySaved(true);
    setTimeout(() => setAiKeySaved(false), 2000);
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

  const isAiEnabled = aiProvider !== 'none';

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="mx-auto max-w-md flex flex-col gap-6">

        {/* Section 1: Transcription config */}
        <div>
          <h2 className="mb-3 text-xs font-semibold text-zinc-600 uppercase tracking-wider">Transkrypcja</h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-5">

            {/* Language */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-500 w-16 shrink-0">Language</span>
              <div ref={langDropdownRef} className="relative">
                <button
                  onClick={() => setLangDropdownOpen((o) => !o)}
                  className="flex w-40 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 cursor-pointer hover:border-zinc-600 justify-between transition-colors"
                >
                  <span>{LANGUAGE_OPTIONS.find((o) => o.value === language)?.label ?? language}</span>
                  <svg className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${langDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </button>

                {langDropdownOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-40 overflow-y-auto max-h-64 rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { handleLanguageChange(opt.value); setLangDropdownOpen(false); }}
                        className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                          opt.value === language ? 'font-medium text-white' : 'text-zinc-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Model */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-500 w-16 shrink-0">Model</span>
              <div ref={modelDropdownRef} className="relative">
                <button
                  onClick={() => !downloading && setModelDropdownOpen((o) => !o)}
                  disabled={downloading}
                  className="flex w-40 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer hover:border-zinc-600 justify-between transition-colors"
                >
                  <span>{MODEL_OPTIONS.find((o) => o.value === modelSize)?.label ?? modelSize}</span>
                  <svg className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </button>

                {modelDropdownOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
                    {MODEL_OPTIONS.map((opt) => {
                      const isSelected = opt.value === modelSize;
                      const isReady = downloadedModels.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => { handleModelChange(opt.value); setModelDropdownOpen(false); }}
                          className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                            isSelected ? 'font-medium text-white' : 'text-zinc-400'
                          }`}
                        >
                          <span className="whitespace-nowrap">{opt.label}</span>
                          {isReady ? (
                            <svg className="h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                          ) : (
                            <svg className="h-3.5 w-3.5 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {!downloaded && !downloading && (
                <button
                  onClick={download}
                  className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                >
                  Download
                </button>
              )}

              {downloading && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full bg-zinc-700 overflow-hidden">
                    {progress === 0 ? (
                      <div key="pulse" className="h-full w-full rounded-full bg-blue-500/40 animate-pulse" />
                    ) : (
                      <div
                        key="bar"
                        className="h-full rounded-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">{progress > 0 ? `${progress}%` : '...'}</span>
                  <button
                    onClick={cancel}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}
          </div>

          <button
            onClick={() => window.dictator.openModelsFolder()}
            className="flex items-center gap-2 self-start rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-600 transition-colors hover:border-zinc-700 hover:text-zinc-400 mt-4"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
            </svg>
            Open models folder
          </button>
        </div>

        {/* API key section (transcription) */}
        {engine === 'api' && (
          <div>
            <h2 className="mb-3 text-xs font-semibold text-zinc-600 uppercase tracking-wider">OpenAI API Key</h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-4">
              <p className="text-xs text-zinc-600">
                Used for Whisper API transcription. Your key is stored locally and never sent anywhere except OpenAI.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleApiKeySave}
                  className="rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                >
                  {apiKeySaved ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Dictation modes */}
        <div className={!isAiEnabled ? 'opacity-50 pointer-events-none' : ''}>
          <h2 className="mb-3 text-xs font-semibold text-zinc-600 uppercase tracking-wider">Dictation Mode</h2>
          {!isAiEnabled && (
            <p className="mb-3 text-xs text-zinc-600">Select an AI provider below to enable dictation modes.</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {DICTATION_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors cursor-pointer ${
                  currentMode === mode.id
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={mode.icon} />
                </svg>
                <span className="text-xs font-medium">{mode.label}</span>
                <span className="text-[10px] text-zinc-600 leading-tight">{mode.description}</span>
              </button>
            ))}
          </div>

          {currentMode === 'custom' && isAiEnabled && (
            <div className="mt-3">
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onBlur={handleCustomPromptSave}
                placeholder="Enter your custom system prompt..."
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
            </div>
          )}
        </div>

        {/* Section 3: AI Provider config */}
        <div>
          <h2 className="mb-3 text-xs font-semibold text-zinc-600 uppercase tracking-wider">AI Provider</h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-4">

            {/* Provider dropdown */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-500 w-16 shrink-0">Provider</span>
              <div ref={providerDropdownRef} className="relative">
                <button
                  onClick={() => setProviderDropdownOpen((o) => !o)}
                  className="flex w-48 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 cursor-pointer hover:border-zinc-600 justify-between transition-colors"
                >
                  <span>{AI_PROVIDER_OPTIONS.find((o) => o.value === aiProvider)?.label ?? aiProvider}</span>
                  <svg className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${providerDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                  </svg>
                </button>

                {providerDropdownOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
                    {AI_PROVIDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { handleProviderChange(opt.value); setProviderDropdownOpen(false); }}
                        className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                          opt.value === aiProvider ? 'font-medium text-white' : 'text-zinc-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* OpenAI config */}
            {aiProvider === 'openai' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500 w-16 shrink-0">Model</span>
                  <div ref={aiModelDropdownRef} className="relative">
                    <button
                      onClick={() => setAiModelDropdownOpen((o) => !o)}
                      className="flex w-48 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 cursor-pointer hover:border-zinc-600 justify-between transition-colors"
                    >
                      <span>{OPENAI_MODELS.find((o) => o.value === aiOpenaiModel)?.label ?? aiOpenaiModel}</span>
                      <svg className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${aiModelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                      </svg>
                    </button>
                    {aiModelDropdownOpen && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
                        {OPENAI_MODELS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { handleAiModelChange(opt.value); setAiModelDropdownOpen(false); }}
                            className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                              opt.value === aiOpenaiModel ? 'font-medium text-white' : 'text-zinc-400'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={aiOpenaiKey}
                    onChange={(e) => setAiOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    onClick={handleAiKeySave}
                    className="rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                  >
                    {aiKeySaved ? 'Saved' : 'Save'}
                  </button>
                </div>
              </>
            )}

            {/* Anthropic config */}
            {aiProvider === 'anthropic' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500 w-16 shrink-0">Model</span>
                  <div ref={aiModelDropdownRef} className="relative">
                    <button
                      onClick={() => setAiModelDropdownOpen((o) => !o)}
                      className="flex w-48 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 cursor-pointer hover:border-zinc-600 justify-between transition-colors"
                    >
                      <span>{ANTHROPIC_MODELS.find((o) => o.value === aiAnthropicModel)?.label ?? aiAnthropicModel}</span>
                      <svg className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${aiModelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                      </svg>
                    </button>
                    {aiModelDropdownOpen && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
                        {ANTHROPIC_MODELS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { handleAiModelChange(opt.value); setAiModelDropdownOpen(false); }}
                            className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-700 ${
                              opt.value === aiAnthropicModel ? 'font-medium text-white' : 'text-zinc-400'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={aiAnthropicKey}
                    onChange={(e) => setAiAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    onClick={handleAiKeySave}
                    className="rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                  >
                    {aiKeySaved ? 'Saved' : 'Save'}
                  </button>
                </div>
              </>
            )}

            {/* Ollama config */}
            {aiProvider === 'ollama' && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500 w-16 shrink-0">URL</span>
                  <input
                    type="text"
                    value={aiOllamaUrl}
                    onChange={(e) => setAiOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500 w-16 shrink-0">Model</span>
                  <input
                    type="text"
                    value={aiOllamaModel}
                    onChange={(e) => setAiOllamaModel(e.target.value)}
                    placeholder="llama3"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <button
                  onClick={handleAiKeySave}
                  className="self-end rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                >
                  {aiKeySaved ? 'Saved' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
