import { useState, useEffect, useCallback } from 'react';
import { OverlayWindow } from './components/OverlayWindow';
import { Sidebar } from './components/Sidebar';
import type { View as ActiveView } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { HistoryPage } from './components/HistoryPage';
import { ModesPage } from './components/ModesPage';
import { ShortcutsPage } from './components/ShortcutsPage';
import { WidgetPage } from './components/WidgetPage';
import { MicrophoneSelector } from './components/MicrophoneSelector';
import { ScanLines, NoiseOverlay, Vignette } from './components/RecEffects';
import { useRecordingState } from './hooks/useRecordingState';
import { useModelStatus } from './hooks/useModelStatus';
import { useMicrophoneSelector } from './hooks/useMicrophoneSelector';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import type { DictationMode } from '../shared/types';

const MODES_CYCLE: DictationMode[] = ['voice', 'email', 'chat', 'note', 'custom'];

export function App() {
  const isOverlay = window.location.hash === '#overlay';
  const recordingState = useRecordingState();
  const modelStatus = useModelStatus();
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const micSelector = useMicrophoneSelector();
  const audioRecorder = useAudioRecorder(micSelector.selectedDeviceId);

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
    <div className="flex h-screen text-neutral-200 select-none font-sans" style={{ background: '#0A0A0A' }}>
      {/* Global [REC] effects */}
      <ScanLines />
      <NoiseOverlay />
      <Vignette />

      {/* Sidebar — full height */}
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      {/* Right column: header + content */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <header className="drag-region flex items-center justify-end px-5 py-3 border-b border-neutral-800/50">
          <MicrophoneSelector {...micSelector} />
        </header>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {activeView === 'home' && <HomePage recordingState={recordingState} audioRecorder={audioRecorder} />}
          {activeView === 'history' && <HistoryPage />}
          {activeView === 'modes' && <ModesPage {...modelStatus} />}
          {activeView === 'shortcuts' && <ShortcutsPage />}
          {activeView === 'widget' && <WidgetPage />}
        </div>
      </div>
    </div>
  );
}
