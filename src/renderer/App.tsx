import { useState } from 'react';
import { OverlayWindow } from './components/OverlayWindow';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { ModesPage } from './components/ModesPage';
import { useRecordingState } from './hooks/useRecordingState';
import { useModelStatus } from './hooks/useModelStatus';

type ActiveView = 'home' | 'modes';

export function App() {
  const isOverlay = window.location.hash === '#overlay';
  const recordingState = useRecordingState();
  const modelStatus = useModelStatus();
  const [activeView, setActiveView] = useState<ActiveView>('home');

  if (isOverlay) {
    return <OverlayWindow state={recordingState} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Header — full width drag region */}
      <header className="drag-region flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
        <div className="no-drag flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${
            recordingState === 'recording' ? 'bg-red-500 animate-pulse' :
            recordingState === 'processing' ? 'bg-amber-500 animate-pulse' :
            'bg-zinc-700'
          }`} />
          <span className="text-xs text-zinc-500 capitalize">{recordingState}</span>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onNavigate={setActiveView} />

        <div className="flex flex-1 flex-col overflow-hidden">
          {activeView === 'home' && <HomePage recordingState={recordingState} />}
          {activeView === 'modes' && <ModesPage {...modelStatus} />}
        </div>
      </div>
    </div>
  );
}
