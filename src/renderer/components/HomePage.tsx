import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import { RecIndicator } from './RecEffects';

import { CopyButton } from './CopyButton';
import type { RecordingEntry, RecordingState } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { useAudioRecorder } from '../hooks/useAudioRecorder';
import type { View } from './Sidebar';


interface HomePageProps {
  recordingState: RecordingState;
  audioRecorder: ReturnType<typeof useAudioRecorder>;
  onNavigate: (view: View) => void;
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

export function HomePage({ recordingState, audioRecorder, onNavigate }: HomePageProps) {
  const { isRecording, error: recorderError, errorType, recordingStartTime, startRecording, stopRecording, clearError } = audioRecorder;
  const { result, error: transcriptionError, clearResult } = useTranscriptionResult(recordingState);
  const error = recorderError || transcriptionError;

  const [editedResult, setEditedResult] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editedResult when a new transcription arrives
  useEffect(() => {
    setEditedResult(result);
  }, [result]);

  const [toggleShortcut, setToggleShortcut] = useState(DEFAULT_SETTINGS.hotkey.shortcuts.toggleRecording);

  useEffect(() => {
    // Clear stale recorder errors from previous attempts (e.g., "Model not downloaded")
    // when user returns to Home after fixing the issue in Modes
    clearError();

    window.dictator.getSettings().then((s) => {
      setToggleShortcut(s.hotkey.shortcuts?.toggleRecording ?? DEFAULT_SETTINGS.hotkey.shortcuts.toggleRecording);
    }).catch((err) => log.error('Failed to load settings in HomePage:', err));
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
      log.error('[HomePage] Failed to load stats:', err);
    }
  }, []);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  // Recent transcriptions for mini-history
  const [recentEntries, setRecentEntries] = useState<RecordingEntry[]>([]);

  const refreshRecent = useCallback(async () => {
    try {
      const res = await window.dictator.history.getAll(3, 0);
      if (res.success) setRecentEntries(res.data);
    } catch (err) {
      log.error('[HomePage] Failed to load recent entries:', err);
    }
  }, []);

  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  // Refresh stats and recent history when a new transcription result arrives
  useEffect(() => {
    if (result && result.trim()) {
      refreshStats();
      refreshRecent();
    }
  }, [result, refreshStats, refreshRecent]);

  const { totalWords, totalTimeDisplay, totalRecordings, avgWpm } = stats;
  const isEmpty = totalRecordings === '—';
  const showEmptyState = isEmpty && !isRecording && recordingState !== 'transcribing' && !result && !error;

  const statCards = [
    {
      value: totalWords,
      label: 'Total words',
      icon: (
        <svg className="h-[1em] w-[1em]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
    },
    {
      value: totalTimeDisplay,
      label: 'Time recorded',
      icon: (
        <svg className="h-[1em] w-[1em]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    },
    {
      value: totalRecordings,
      label: 'Total recordings',
      icon: (
        <svg className="h-[1em] w-[1em]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
        </svg>
      ),
    },
    {
      value: avgWpm,
      label: 'AVG Pace',
      icon: (
        <svg className="h-[1em] w-[1em]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      ),
    },
  ];

  return (
    <main className="flex flex-1 flex-col gap-6 pb-6 overflow-hidden animate-fade-in">
      {/* Stats grid */}
      <div className="mx-6 mt-6 grid grid-cols-4" style={{ gap: 'clamp(0.5rem, 1vw, 0.75rem)' }}>
        {statCards.map((stat, i) => (
          <div
            key={i}
            className="relative rounded-xl border border-neutral-800 bg-[#141414] flex flex-row items-center hover:border-neutral-700 hover:bg-[#1A1A1A] transition-all duration-200 cursor-default overflow-hidden"
            style={{ padding: 'clamp(0.5rem, 1.2vw, 1.25rem)', gap: 'clamp(0.5rem, 1vw, 1rem)' }}
          >
            {/* Red top line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-600/20" />
            <span className="text-red-700 shrink-0" style={{ fontSize: 'clamp(0.875rem, 1.5vw, 1.25rem)' }}>{stat.icon}</span>
            <div className="flex flex-col min-w-0" style={{ gap: 'clamp(0.125rem, 0.3vw, 0.25rem)' }}>
              <span className="font-mono font-semibold uppercase text-neutral-400 whitespace-nowrap" style={{ fontSize: 'clamp(0.5rem, 0.9vw, 0.75rem)', letterSpacing: 'clamp(0.05em, 0.15vw, 0.15em)' }}>{stat.label}</span>
              <span className="font-mono font-bold text-white leading-none" style={{ fontSize: 'clamp(1rem, 2vw, 1.5rem)' }}>{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state callout */}
      {showEmptyState && (
        <div className="flex flex-col items-center gap-2 mt-4 animate-fade-in">
          <p className="font-mono text-sm tracking-[0.2em] uppercase text-neutral-500">
            [ make your first recording ]
          </p>
          <svg className="h-5 w-5 text-red-600/60 animate-bounce" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
        </div>
      )}

      {/* Recording section */}
      <div className={`flex flex-col items-center gap-5 ${showEmptyState ? 'mt-4' : 'mt-10'}`}>
        {/* REC indicator — above the button */}
        <div className="h-6 flex items-center">
          <RecIndicator isRecording={isRecording} recordingStartTime={recordingStartTime} />
        </div>

        <div className="relative flex items-center justify-center">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={recordingState === 'transcribing'}
            aria-label={isRecording ? 'Stop recording' : recordingState === 'transcribing' ? 'Transcribing in progress' : 'Start recording'}
            className={`btn-noise relative flex h-[134px] w-[134px] items-center justify-center rounded-full border-2 bg-zinc-950 ${
              isRecording ? 'animate-rec-glitch' : showEmptyState ? 'animate-first-run-glow' : ''
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
              <svg className="h-11 w-11 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </div>

            {/* Transcribing — spinner */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
              recordingState === 'transcribing' ? 'opacity-100' : 'opacity-0'
            }`}>
              <svg className="h-10 w-10 text-zinc-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
              </svg>
            </div>
          </button>
        </div>

        {/* Status */}
        <div className="flex flex-col items-center gap-2" aria-live="polite" aria-atomic="true">
          <p key={`${recordingState}-${isRecording}`} className="font-mono text-base font-semibold tracking-[0.25em] uppercase text-neutral-300 animate-fade-in">
            {recordingState === 'transcribing'
              ? '[ TRANSCRIBING... ]'
              : isRecording
              ? '[ RECORDING ]'
              : '[ CLICK TO RECORD ]'}
          </p>
          <p key={`sub-${isRecording}`} className="font-mono text-sm text-neutral-600 tracking-widest animate-fade-in">
            {isRecording ? 'click to stop' : toggleShortcut.replace(/\+/g, ' + ')}
          </p>
        </div>
      </div>

      {/* Transcription result */}
      {(result || error) && (
        <div className="mx-auto w-full max-w-xl px-6" aria-live="polite">
          {error ? (
            <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-center animate-fade-in">
              <p className="text-sm text-red-400">
                {error}
              </p>
              {(errorType === 'missing-api-key' || errorType === 'model-not-downloaded') && (
                <button
                  onClick={() => { clearError(); onNavigate('modes'); }}
                  className="text-sm text-red-300 underline underline-offset-2 hover:text-red-200 transition-colors"
                >
                  Go to Processing
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 animate-fade-in">
              <textarea
                ref={textareaRef}
                value={editedResult}
                onChange={(e) => setEditedResult(e.target.value)}
                rows={Math.max(2, Math.min(10, Math.ceil(editedResult.length / 60)))}
                className={`w-full resize-none rounded-xl border border-red-900/30 bg-[#141414] px-5 py-4 font-mono text-base text-neutral-200 focus:outline-none focus:border-red-700/50 transition-colors ${
                  editedResult.length <= 80 ? 'text-center' : 'text-left'
                }`}
              />
              <div className="flex justify-center gap-2">
                <CopyButton text={editedResult} />
                <button
                  onClick={() => { clearResult(); clearError(); setEditedResult(''); }}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent transcriptions mini-history */}
      {recentEntries.length > 0 && (
        <div className="mx-auto w-full max-w-xl px-6 flex-1 min-h-0 flex flex-col animate-fade-in">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-neutral-600 mb-2 shrink-0">Recent</p>
          <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0">
            {recentEntries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setEditedResult(entry.text)}
                className="group flex items-center gap-3 rounded-lg border border-neutral-800 bg-[#141414] px-4 py-2.5 text-left transition-colors hover:border-neutral-700 hover:bg-[#1A1A1A] shrink-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-neutral-300 group-hover:text-neutral-100 transition-colors">
                    {entry.text}
                  </p>
                  <p className="font-mono text-xs text-neutral-600 mt-0.5">
                    {new Date(entry.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {entry.appName && <span className="ml-2 text-neutral-700">{entry.appName}</span>}
                  </p>
                </div>
                <CopyButton text={entry.text} stopPropagation className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-xs font-semibold uppercase tracking-wider border text-neutral-500 border-neutral-700 hover:border-neutral-500 hover:text-neutral-200" />
              </button>
            ))}
          </div>
        </div>
      )}

    </main>
  );
}
