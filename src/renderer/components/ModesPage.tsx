import { useState, useEffect } from 'react';
import type { ModelStatus } from '../hooks/useModelStatus';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'tiny' },
  { value: 'base', label: 'base' },
  { value: 'small', label: 'small' },
  { value: 'medium', label: 'medium' },
];

export function ModesPage(props: ModelStatus) {
  const { downloaded, downloading, progress, error, download, cancel, recheck } = props;
  const [engine, setEngine] = useState<'local' | 'api'>('api');
  const [modelSize, setModelSize] = useState('base');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      setEngine(s.transcription.engine);
      setModelSize(s.transcription.localModelSize);
      setApiKey(s.transcription.openaiApiKey);
    });
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

  const handleApiKeySave = async () => {
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: { ...current.transcription, openaiApiKey: apiKey },
    });
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-md flex flex-col gap-6">

        {/* Engine toggle */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">Transcription Engine</h2>
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 w-fit gap-1">
            {(['local', 'api'] as const).map((e) => (
              <button
                key={e}
                onClick={() => handleEngineChange(e)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  engine === e
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-600'
                }`}
              >
                {e === 'local' ? 'Local (offline)' : 'OpenAI API'}
              </button>
            ))}
          </div>
        </div>

        {/* Local model section */}
        {engine === 'local' && (
          <div>
            <h2 className="mb-3 text-base font-semibold text-zinc-900">Local Whisper Model</h2>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400 w-14">Model</span>
                <select
                  value={modelSize}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={downloading}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400">change requires re-download</span>
              </div>

              <div className="flex flex-col gap-3">
                {downloaded === null ? (
                  <p className="text-sm text-zinc-400">Checking...</p>
                ) : downloaded ? (
                  <p className="flex items-center gap-2 text-sm text-emerald-400">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Model ready
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="inline-block h-2 w-2 rounded-full bg-zinc-300" />
                    Not downloaded
                  </p>
                )}

                {error && (
                  <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
                    {error}
                  </p>
                )}

                {!downloaded && !downloading && (
                  <button
                    onClick={download}
                    className="w-fit rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
                  >
                    Download Model
                  </button>
                )}

                {downloading && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-zinc-600">
                        Downloading...{progress > 0 ? ` ${progress}%` : ''}
                      </p>
                      <button
                        onClick={cancel}
                        className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
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
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => window.dictator.openModelsFolder()}
              className="flex items-center gap-2 self-start rounded-lg border border-zinc-200 px-4 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600 mt-4"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
              </svg>
              Open models folder
            </button>
          </div>
        )}

        {/* API key section */}
        {engine === 'api' && (
          <div>
            <h2 className="mb-3 text-base font-semibold text-zinc-900">OpenAI API Key</h2>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 flex flex-col gap-4">
              <p className="text-xs text-zinc-400">
                Used for Whisper API transcription. Your key is stored locally and never sent anywhere except OpenAI.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 placeholder-zinc-300 focus:outline-none focus:border-zinc-400"
                />
                <button
                  onClick={handleApiKeySave}
                  className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
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
