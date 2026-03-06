import { useState } from 'react';
import { OverlayWindow } from './components/OverlayWindow';
import { SettingsPage } from './components/SettingsPage';
import { useRecordingState } from './hooks/useRecordingState';
import { useAudioRecorder } from './hooks/useAudioRecorder';

export function App() {
  const isOverlay = window.location.hash === '#overlay';
  const recordingState = useRecordingState();
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();
  const [view, setView] = useState<'main' | 'settings'>('main');

  if (isOverlay) {
    return <OverlayWindow state={recordingState} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Header */}
      <header className="drag-region flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2.5">
          {view === 'settings' ? (
            <button
              onClick={() => setView('main')}
              className="no-drag flex items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              <span className="text-sm font-medium">Back</span>
            </button>
          ) : (
            <h1 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              The Dictator
            </h1>
          )}
        </div>

        <div className="no-drag flex items-center gap-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${
              recordingState === 'recording' ? 'bg-red-500 animate-pulse' :
              recordingState === 'processing' ? 'bg-amber-500 animate-pulse' :
              'bg-zinc-700'
            }`} />
            <span className="text-xs text-zinc-500 capitalize">{recordingState}</span>
          </div>

          {/* Settings button */}
          {view === 'main' && (
            <button
              onClick={() => setView('settings')}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      {view === 'settings' ? (
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-xl">
            <SettingsPage />
          </div>
        </main>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center pb-16">
          {/* Recording button with pulse rings */}
          <div className="relative flex items-center justify-center">
            {/* Animated rings — only visible when recording */}
            {isRecording && (
              <>
                <span className="animate-ping-slow absolute h-28 w-28 rounded-full bg-red-500/30" />
                <span className="animate-ping-slower absolute h-28 w-28 rounded-full bg-red-500/20" />
              </>
            )}

            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`relative z-10 flex h-28 w-28 items-center justify-center rounded-full transition-all duration-300 ${
                isRecording
                  ? 'bg-red-600 shadow-[0_0_40px_rgba(239,68,68,0.3)] hover:bg-red-700'
                  : 'bg-zinc-800 hover:bg-zinc-700 hover:shadow-[0_0_30px_rgba(239,68,68,0.15)]'
              }`}
            >
              {isRecording ? (
                <svg className="h-9 w-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
              )}
            </button>
          </div>

          {/* Status text */}
          <p className="mt-8 text-sm font-medium text-zinc-400">
            {isRecording ? 'Recording... click to stop' : 'Click to start recording'}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            Ctrl + Shift + Space
          </p>
        </main>
      )}
    </div>
  );
}
