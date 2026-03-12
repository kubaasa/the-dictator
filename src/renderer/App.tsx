import { useState, useEffect, useCallback } from 'react';
import { OverlayWindow } from './components/OverlayWindow';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { ModesPage } from './components/ModesPage';
import { ShortcutsPage } from './components/ShortcutsPage';
import { MicrophoneSelector } from './components/MicrophoneSelector';
import { useRecordingState } from './hooks/useRecordingState';
import { useModelStatus } from './hooks/useModelStatus';
import { useMicrophoneSelector } from './hooks/useMicrophoneSelector';
import type { DictationMode } from '../shared/types';

type ActiveView = 'home' | 'modes' | 'shortcuts';

const MODES_CYCLE: DictationMode[] = ['voice', 'email', 'chat', 'note', 'custom'];

export function App() {
  const isOverlay = window.location.hash === '#overlay';
  const recordingState = useRecordingState();
  const modelStatus = useModelStatus();
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const micSelector = useMicrophoneSelector();

  // Cycle dictation mode on hotkey
  const cycleDictationMode = useCallback(async () => {
    const settings = await window.dictator.getSettings();
    const currentIdx = MODES_CYCLE.indexOf(settings.dictation.currentMode);
    const nextIdx = (currentIdx + 1) % MODES_CYCLE.length;
    await window.dictator.setSettings({
      dictation: { ...settings.dictation, currentMode: MODES_CYCLE[nextIdx] },
    });
  }, []);

  useEffect(() => {
    const unsub = window.dictator.onHotkeyModeSelect(cycleDictationMode);
    return unsub;
  }, [cycleDictationMode]);

  if (isOverlay) {
    return <OverlayWindow state={recordingState} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Header — full width drag region */}
      <header className="drag-region flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <div className="no-drag flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${
            recordingState === 'recording' ? 'bg-red-500 animate-pulse' :
            recordingState === 'transcribing' ? 'bg-amber-500 animate-pulse' :
            recordingState === 'processing' ? 'bg-amber-500 animate-pulse' :
            'bg-zinc-700'
          }`} />
          <span className="text-xs text-zinc-400 capitalize">{recordingState}</span>
        </div>
        <MicrophoneSelector {...micSelector} />
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onNavigate={setActiveView} />

        <div className="flex flex-1 flex-col overflow-hidden">
          {activeView === 'home' && <HomePage recordingState={recordingState} selectedDeviceId={micSelector.selectedDeviceId} />}
          {activeView === 'modes' && <ModesPage {...modelStatus} />}
          {activeView === 'shortcuts' && <ShortcutsPage />}
        </div>
      </div>
    </div>
  );
}
