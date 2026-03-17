import { useState, useEffect, useCallback } from 'react';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import { RecIndicator } from './RecEffects';
import type { RecordingState } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { useAudioRecorder } from '../hooks/useAudioRecorder';


interface HomePageProps {
  recordingState: RecordingState;
  audioRecorder: ReturnType<typeof useAudioRecorder>;
}

interface StatsDisplay {
  totalWords: string;
  totalTimeDisplay: string;
  totalRecordings: string;
  avgWpm: string;
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '—';
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)} min`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

const EMPTY_STATS: StatsDisplay = { totalWords: '—', totalTimeDisplay: '—', totalRecordings: '—', avgWpm: '—' };

export function HomePage({ recordingState, audioRecorder }: HomePageProps) {
  const { isRecording, error: recorderError, recordingStartTime, startRecording, stopRecording, clearError } = audioRecorder;
  const { result, error: transcriptionError, clearResult } = useTranscriptionResult(recordingState);
  const error = recorderError || transcriptionError;

  const [toggleShortcut, setToggleShortcut] = useState(DEFAULT_SETTINGS.hotkey.shortcuts.toggleRecording);

  useEffect(() => {
    // Clear stale recorder errors from previous attempts (e.g., "Model not downloaded")
    // when user returns to Home after fixing the issue in Modes
    clearError();

    window.dictator.getSettings().then((s) => {
      setToggleShortcut(s.hotkey.shortcuts?.toggleRecording ?? DEFAULT_SETTINGS.hotkey.shortcuts.toggleRecording);
    });
    const unsub = window.dictator.onSettingsChange((s) => {
      setToggleShortcut(s.hotkey.shortcuts?.toggleRecording ?? DEFAULT_SETTINGS.hotkey.shortcuts.toggleRecording);
      // Settings changed (e.g., model downloaded) — clear stale error so it doesn't
      // persist after the user fixed the issue. If the problem remains, the next
      // recording attempt will re-show the error.
      clearError();
    });
    return unsub;
  }, []);

  // Stats loaded from SQLite via dedicated aggregate query (no row limit)
  const [stats, setStats] = useState<StatsDisplay>(EMPTY_STATS);

  const refreshStats = useCallback(async () => {
    try {
      const result = await window.dictator.history.getStats();
      if (result.success && result.data) {
        const { totalWords, totalSeconds, totalRecordings, avgWpm } = result.data;
        setStats({
          totalWords: totalWords > 0 ? totalWords.toLocaleString() : '—',
          totalTimeDisplay: formatTime(totalSeconds),
          totalRecordings: totalRecordings > 0 ? totalRecordings.toString() : '—',
          avgWpm: avgWpm > 0 ? `${avgWpm} wpm` : '—',
        });
      }
    } catch (err) {
      console.error('[HomePage] Failed to load stats:', err);
    }
  }, []);

  // Load stats on mount
  useEffect(() => { refreshStats(); }, [refreshStats]);

  // Refresh stats when a new transcription result arrives
  useEffect(() => {
    if (result && result.trim()) {
      refreshStats();
    }
  }, [result, refreshStats]);

  const { totalWords, totalTimeDisplay, totalRecordings, avgWpm } = stats;

  const statCards = [
    {
      value: totalWords,
      label: 'Total words',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
    },
    {
      value: totalTimeDisplay,
      label: 'Time recorded',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    },
    {
      value: totalRecordings,
      label: 'Total recordings',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
        </svg>
      ),
    },
    {
      value: avgWpm,
      label: 'AVG Pace',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      ),
    },
  ];

  return (
    <main className="flex flex-1 flex-col gap-6 pb-6 overflow-y-auto animate-fade-in">
      {/* Stats grid */}
      <div className="mx-6 mt-6 grid grid-cols-4 gap-3">
        {statCards.map((stat, i) => (
          <div
            key={i}
            className="relative rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-row items-center gap-4 hover:border-neutral-700 hover:bg-[#1A1A1A] transition-all duration-200 cursor-default overflow-hidden"
          >
            {/* Red top line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-600/20" />
            <span className="text-red-700 shrink-0">{stat.icon}</span>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400 whitespace-nowrap">{stat.label}</span>
              <span className="font-mono text-2xl font-bold text-white leading-none">{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Recording section */}
      <div className="flex flex-col items-center gap-5 mt-10">
        {/* REC indicator — above the button */}
        <div className="h-6 flex items-center">
          <RecIndicator isRecording={isRecording} recordingStartTime={recordingStartTime} />
        </div>

        <div className="relative flex items-center justify-center">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={recordingState === 'transcribing'}
            className={`btn-noise relative flex h-28 w-28 items-center justify-center rounded-full border-2 bg-zinc-950 ${
              isRecording ? 'animate-rec-glitch' : ''
            } ${recordingState === 'transcribing' ? 'cursor-not-allowed' : 'hover:bg-zinc-900/80'}`}
            style={{
              borderColor: recordingState === 'transcribing' ? '#27272a' : '#DC2626',
              opacity: recordingState === 'transcribing' ? 0.4 : 1,
              transition: 'border-color 300ms, opacity 300ms, box-shadow 500ms',
            }}
          >
            {/* Idle — red circle */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
              !isRecording && recordingState !== 'transcribing' ? 'opacity-100' : 'opacity-0'
            }`}>
              <svg className="h-full w-full" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" fill="#DC2626" />
              </svg>
            </div>

            {/* Recording — stop square */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
              isRecording ? 'opacity-100' : 'opacity-0'
            }`}>
              <svg className="h-9 w-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </div>

            {/* Transcribing — spinner */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
              recordingState === 'transcribing' ? 'opacity-100' : 'opacity-0'
            }`}>
              <svg className="h-8 w-8 text-zinc-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
              </svg>
            </div>
          </button>
        </div>

        {/* Status */}
        <div className="flex flex-col items-center gap-2">
          <p key={`${recordingState}-${isRecording}`} className="font-mono text-sm font-semibold tracking-[0.25em] uppercase text-neutral-300 animate-fade-in">
            {recordingState === 'transcribing'
              ? '[ TRANSCRIBING... ]'
              : isRecording
              ? '[ RECORDING ]'
              : '[ CLICK TO RECORD ]'}
          </p>
          <p key={`sub-${isRecording}`} className="font-mono text-xs text-neutral-600 tracking-widest animate-fade-in">
            {isRecording ? 'click to stop' : toggleShortcut.replace(/\+/g, ' + ')}
          </p>
        </div>
      </div>

      {/* Transcription result */}
      {(result || error) && (
        <div className="mx-auto w-full max-w-lg px-6">
          {error ? (
            <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400 animate-fade-in">
              {error}
            </p>
          ) : (
            <div className="flex flex-col gap-3 animate-fade-in">
              <textarea
                readOnly
                value={result}
                rows={4}
                className="w-full resize-none rounded-xl border border-red-900/30 bg-[#141414] px-4 py-3 font-mono text-sm text-neutral-200 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="rounded-lg border border-neutral-700 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
                >
                  Copy
                </button>
                <button
                  onClick={() => { clearResult(); clearError(); }}
                  className="rounded-lg border border-neutral-700 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </main>
  );
}
