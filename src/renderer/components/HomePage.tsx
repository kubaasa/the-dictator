import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import type { RecordingState } from '../../shared/types';

interface HomePageProps {
  recordingState: RecordingState;
  selectedDeviceId?: string | null;
}

export function HomePage({ recordingState, selectedDeviceId }: HomePageProps) {
  const { isRecording, error: recorderError, startRecording, stopRecording, clearError } = useAudioRecorder(selectedDeviceId);
  const { result, error: transcriptionError, clearResult } = useTranscriptionResult(recordingState);
  const error = recorderError || transcriptionError;

  const stats = [
    { value: '—', label: 'Average speed' },
    { value: '0', label: 'Words this week' },
    { value: '0', label: 'Apps used' },
    { value: '0 minutes', label: 'Saved this week ☺' },
  ];

  return (
    <main className="flex flex-1 flex-col gap-8 pb-16">
      {/* Stats bar */}
      <div className="mx-6 mt-6 flex items-center justify-between rounded-xl bg-zinc-800 px-6 py-4">
        {stats.map((stat, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="text-base font-bold text-white">{stat.value}</span>
            <span className="text-xs text-zinc-400">{stat.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
      {/* Recording button with pulse rings */}
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
          className={`relative z-10 flex h-28 w-28 items-center justify-center rounded-full border transition-all duration-300 ${
            isRecording
              ? 'border-transparent bg-red-600 shadow-[0_0_40px_rgba(239,68,68,0.3)] hover:bg-red-700'
              : recordingState === 'transcribing'
              ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 opacity-50'
              : 'border-zinc-200 bg-zinc-100 hover:border-red-200 hover:bg-red-50 hover:shadow-[0_0_30px_rgba(239,68,68,0.1)]'
          }`}
        >
          {isRecording ? (
            <svg className="h-9 w-9 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="h-10 w-10 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-zinc-600">
          {recordingState === 'transcribing'
            ? 'Transcribing...'
            : isRecording
            ? 'Recording... click to stop'
            : 'Click to start recording'}
        </p>
        <p className="text-xs text-zinc-400">Ctrl + Shift + Space</p>
      </div>

      {/* Transcription result */}
      {(result || error) && (
        <div className="mx-auto w-full max-w-lg px-6">
          {error ? (
            <p className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                readOnly
                value={result}
                rows={5}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="rounded-lg border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100"
                >
                  Copy
                </button>
                <button
                  onClick={() => { clearResult(); clearError(); }}
                  className="rounded-lg border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </main>
  );
}
