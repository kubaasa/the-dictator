import { useState, useEffect, useRef } from 'react';
import type { ModelStatus } from '../hooks/useModelStatus';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large-v3', label: 'Large v3' },
];

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'cs', label: 'Czech' },
  { value: 'sv', label: 'Swedish' },
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
    window.dictator.getSettings().then((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
    });

    const unsub = window.dictator.onSettingsChange((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setLanguage(s.transcription.language);
      setApiKey(s.transcription.openaiApiKey);
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

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="mx-auto max-w-md flex flex-col gap-6">

        {/* Transcription config */}
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

        {/* API key section */}
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
                  {apiKeySaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
