import { useState, useEffect, useRef } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import type { RecordingState } from '../../shared/types';

interface RecordingEntry {
  id: string;
  date: string;
  text: string;
}

interface HomePageProps {
  recordingState: RecordingState;
  selectedDeviceId?: string | null;
}

export function HomePage({ recordingState, selectedDeviceId }: HomePageProps) {
  const { isRecording, error: recorderError, startRecording, stopRecording, clearError } = useAudioRecorder(selectedDeviceId);
  const { result, error: transcriptionError, clearResult } = useTranscriptionResult(recordingState);
  const error = recorderError || transcriptionError;

  const [recordings, setRecordings] = useState<RecordingEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('dictator_recordings') || '[]'); } catch { return []; }
  });
  const prevResultRef = useRef('');

  useEffect(() => {
    if (result && result.trim() && result !== prevResultRef.current) {
      prevResultRef.current = result;
      const entry: RecordingEntry = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        text: result.trim(),
      };
      setRecordings(prev => {
        const updated = [entry, ...prev].slice(0, 50);
        localStorage.setItem('dictator_recordings', JSON.stringify(updated));
        return updated;
      });
    }
  }, [result]);

  const stats = [
    {
      value: '—',
      label: 'Average speed',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      ),
    },
    {
      value: '0',
      label: 'Words this week',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
    },
    {
      value: '0',
      label: 'Apps used',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0H3" />
        </svg>
      ),
    },
    {
      value: '0 min',
      label: 'Saved this week',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    },
  ];

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <main className="flex flex-1 flex-col gap-6 pb-6 overflow-y-auto animate-fade-in">
      {/* Stats grid */}
      <div className="mx-6 mt-6 grid grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-2 hover:border-zinc-700 hover:bg-zinc-800/80 transition-all duration-200 cursor-default"
          >
            <span className="text-zinc-500">{stat.icon}</span>
            <span className="text-lg font-bold text-white">{stat.value}</span>
            <span className="text-xs text-zinc-500">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Recording button */}
      <div className="flex flex-col items-center gap-5 mt-2">
        <div className="relative flex items-center justify-center">
          {isRecording && (
            <>
              <span className="animate-ping-slow absolute h-28 w-28 rounded-full bg-red-500/30" />
              <span className="animate-ping-slower absolute h-28 w-28 rounded-full bg-red-500/20" />
            </>
          )}

          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={recordingState === 'transcribing'}
            className={`relative z-10 flex h-28 w-28 items-center justify-center rounded-full border-2 transition-all duration-300 ${
              isRecording
                ? 'border-red-500/50 bg-red-600 shadow-[0_0_50px_rgba(239,68,68,0.4),0_0_100px_rgba(239,68,68,0.15)] hover:bg-red-700'
                : recordingState === 'transcribing'
                ? 'cursor-not-allowed border-zinc-700 bg-zinc-800 opacity-50'
                : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 hover:shadow-[0_0_30px_rgba(255,255,255,0.04)] animate-idle-pulse'
            }`}
          >
            {isRecording ? (
              <svg className="h-9 w-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : recordingState === 'transcribing' ? (
              <svg className="h-8 w-8 text-zinc-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
              </svg>
            ) : (
              <svg className="h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            )}
          </button>
        </div>

        {/* Status */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-medium text-zinc-400">
            {recordingState === 'transcribing'
              ? 'Transkrybowanie...'
              : isRecording
              ? 'Nagrywanie — kliknij aby zatrzymać'
              : 'Kliknij aby nagrać'}
          </p>
          <p className="text-xs text-zinc-600">Ctrl + Shift + Space</p>
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
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                >
                  Copy
                </button>
                <button
                  onClick={() => { clearResult(); clearError(); }}
                  className="rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent recordings */}
      <div className="mx-6">
        <h2 className="mb-3 text-xs font-semibold text-zinc-600 uppercase tracking-wider">Ostatnie nagrania</h2>
        {recordings.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-8 flex flex-col items-center gap-2">
            <svg className="h-8 w-8 text-zinc-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            <p className="text-sm text-zinc-600">Brak nagrań</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
            {recordings.map((rec) => (
              <div
                key={rec.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-col gap-1 hover:border-zinc-700 transition-colors"
              >
                <span className="text-xs text-zinc-600">{formatDate(rec.date)}</span>
                <span className="text-sm text-zinc-300 line-clamp-1">
                  {rec.text.length > 80 ? rec.text.slice(0, 80) + '…' : rec.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
