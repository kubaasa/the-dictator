import type { RecordingState } from '../../shared/types';

interface OverlayWindowProps {
  state: RecordingState;
}

const stateConfig: Record<RecordingState, { label: string; color: string; icon: string }> = {
  idle: { label: 'Ready', color: 'bg-zinc-800', icon: '⏸' },
  recording: { label: 'Recording...', color: 'bg-red-900/90', icon: '🎙' },
  transcribing: { label: 'Transcribing...', color: 'bg-amber-900/90', icon: '✍' },
  processing: { label: 'Processing...', color: 'bg-blue-900/90', icon: '🤖' },
  done: { label: 'Done!', color: 'bg-green-900/90', icon: '✓' },
  error: { label: 'Error', color: 'bg-red-950/90', icon: '✗' },
};

export function OverlayWindow({ state }: OverlayWindowProps) {
  const config = stateConfig[state];

  return (
    <div className={`flex h-screen items-center justify-center rounded-2xl ${config.color} px-6 py-4 backdrop-blur-md`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{config.icon}</span>
        <div>
          <p className="text-sm font-semibold text-white">{config.label}</p>
          {state === 'recording' && (
            <div className="mt-1 flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-3 w-1 animate-pulse rounded-full bg-red-400"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
