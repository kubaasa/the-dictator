import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import type { RecordingState } from '../../shared/types';

interface HomePageProps {
  recordingState: RecordingState;
}

export function HomePage({ recordingState }: HomePageProps) {
  const { isRecording, error: recorderError, startRecording, stopRecording, clearError } = useAudioRecorder();
  const { result, error: transcriptionError, clearResult } = useTranscriptionResult(recordingState);
  const error = recorderError || transcriptionError;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 pb-16">
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
          className={`relative z-10 flex h-28 w-28 items-center justify-center rounded-full transition-all duration-300 ${
            isRecording
              ? 'bg-red-600 shadow-[0_0_40px_rgba(239,68,68,0.3)] hover:bg-red-700'
              : recordingState === 'transcribing'
              ? 'cursor-not-allowed bg-zinc-900 opacity-50'
              : 'bg-zinc-900 hover:bg-zinc-800 hover:shadow-[0_0_30px_rgba(239,68,68,0.15)]'
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

      {/* Open recordings folder */}
      <button
        onClick={() => window.dictator.openRecordingsFolder()}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
        </svg>
        Open recordings folder
      </button>

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
    </main>
  );
}
