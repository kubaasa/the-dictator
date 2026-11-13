import { useState, useCallback } from 'react';
import type { UpdateState } from '../../shared/types';

interface ForceUpdateModalProps {
  updateState: UpdateState;
}

const NOTE_LABEL_RE = /^(New|Fixed|Changed|Improved|Removed)\s*:\s*/i;
const PROGRESS_SEGMENTS = 24;

interface ReleaseNote {
  label: string | null;
  text: string;
}

function parseReleaseNotes(notes: string): ReleaseNote[] {
  return notes
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(NOTE_LABEL_RE);
      return match ? { label: match[1], text: line.slice(match[0].length) } : { label: null, text: line };
    });
}

export function ForceUpdateModal({ updateState }: ForceUpdateModalProps) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = useCallback(() => {
    setInstalling(true);
    window.dictator.update.install();
  }, []);

  const version = updateState.latestVersion ?? 'new';
  const isDownloading = updateState.status === 'downloading';
  const percent = Math.max(0, Math.min(100, Math.round(updateState.progress ?? 0)));
  const filledSegments = isDownloading ? Math.round((percent / 100) * PROGRESS_SEGMENTS) : 0;
  const notes = updateState.releaseNotes ? parseReleaseNotes(updateState.releaseNotes) : [];

  const statusLabel = installing
    ? 'restarting'
    : isDownloading
      ? `downloading ${percent}%`
      : notes.length > 0
        ? `${notes.length} ${notes.length === 1 ? 'change' : 'changes'}`
        : 'ready';

  const buttonLabel = installing
    ? '[ restarting ]'
    : isDownloading
      ? '[ preparing ]'
      : '[ install and restart ]';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg/90">
      <div className="relative flex w-full max-w-md flex-col gap-6 overflow-hidden rounded-xl border border-border bg-surface px-8 pb-8 pt-7 shadow-widget">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent/35" />

        <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" />
            Update
          </span>
          <span>{statusLabel}</span>
        </div>

        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[32px] font-bold leading-none text-text">{version}</span>
          <span className="font-mono text-xs font-medium text-text-dim">from {updateState.currentVersion}</span>
        </div>

        <div
          className="grid h-1.5 grid-cols-24 gap-[3px]"
          role="progressbar"
          aria-label="Download progress"
          aria-valuenow={isDownloading ? percent : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={`rounded-[1px] transition-colors duration-300 ${i < filledSegments ? 'bg-text' : 'bg-border'}`}
            />
          ))}
        </div>

        {notes.length > 0 && (
          <ol className="max-h-[300px] overflow-y-auto border-t border-border">
            {notes.map((note, i) => (
              <li key={i} className="grid grid-cols-[28px_84px_minmax(0,1fr)] items-start gap-3 border-b border-border py-3">
                <span className="font-mono text-[11px] font-medium leading-5 text-text-dim">{String(i + 1).padStart(2, '0')}</span>
                <span className="flex h-5 items-center justify-center">
                  {note.label && (
                    <span className="flex h-5 w-full items-center justify-center rounded border border-border-strong font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-text-muted">
                      {note.label}
                    </span>
                  )}
                </span>
                <span className="text-[13px] leading-5 text-text">{note.text}</span>
              </li>
            ))}
          </ol>
        )}

        <button
          onClick={handleInstall}
          disabled={installing || isDownloading}
          className="flex h-10 w-full items-center justify-center rounded-lg border border-text bg-text px-6 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-bg transition-colors hover:border-text-muted hover:bg-text-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-text disabled:hover:bg-text"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
