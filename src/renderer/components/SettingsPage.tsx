import { useState, useEffect } from 'react';
import type { AppSettings } from '../../shared/types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'transcription' | 'ai' | 'hotkeys'>('general');

  useEffect(() => {
    window.dictator.getSettings().then(setSettings);
    const unsub = window.dictator.onSettingsChange(setSettings);
    return unsub;
  }, []);

  if (!settings) return null;

  const tabs = [
    { id: 'general' as const, label: 'General' },
    { id: 'transcription' as const, label: 'Transcription' },
    { id: 'ai' as const, label: 'AI' },
    { id: 'hotkeys' as const, label: 'Hotkeys' },
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex border-b border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-red-500 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6 text-sm text-zinc-400">
        {activeTab === 'general' && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-zinc-200">General Settings</h3>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.general.minimizeToTray}
                onChange={(e) =>
                  window.dictator.setSettings({
                    general: { ...settings.general, minimizeToTray: e.target.checked },
                  })
                }
                className="accent-red-500"
              />
              Minimize to tray on close
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.dictation.autoPaste}
                onChange={(e) =>
                  window.dictator.setSettings({
                    dictation: { ...settings.dictation, autoPaste: e.target.checked },
                  })
                }
                className="accent-red-500"
              />
              Auto-paste after transcription
            </label>
          </div>
        )}

        {activeTab === 'transcription' && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-zinc-200">Transcription Engine</h3>
            <select
              value={settings.transcription.engine}
              onChange={(e) =>
                window.dictator.setSettings({
                  transcription: { ...settings.transcription, engine: e.target.value as 'local' | 'api' },
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
            >
              <option value="local">Local Whisper (offline)</option>
            </select>
            <p className="text-xs text-zinc-500">
              Local engine will be available after installing whisper models (Phase 3).
            </p>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-zinc-200">AI Provider</h3>
            <select
              value={settings.ai.provider}
              onChange={(e) =>
                window.dictator.setSettings({
                  ai: { ...settings.ai, provider: e.target.value as AppSettings['ai']['provider'] },
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
            >
              <option value="none">None (raw transcription)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </div>
        )}

        {activeTab === 'hotkeys' && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-zinc-200">Hotkey Settings</h3>
            <div>
              <label className="mb-1 block text-zinc-400">Toggle recording</label>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200">
                {settings.hotkey.shortcuts?.toggleRecording ?? 'Ctrl+Shift+Space'}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Use the Shortcuts page for full shortcut editing.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-zinc-400">Mode</label>
              <select
                value={settings.hotkey.mode}
                onChange={(e) =>
                  window.dictator.setSettings({
                    hotkey: { ...settings.hotkey, mode: e.target.value as 'toggle' | 'push-to-talk' },
                  })
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
              >
                <option value="toggle">Toggle (press to start/stop)</option>
                <option value="push-to-talk">Push-to-talk (hold to record)</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
