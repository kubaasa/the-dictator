import { useState, useCallback } from 'react';
import type { UpdateState } from '../../shared/types';

interface ForceUpdateModalProps {
  updateState: UpdateState;
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

  const buttonLabel = installing
    ? 'Restarting...'
    : isDownloading
      ? 'Preparing...'
      : 'Install & Restart';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg/90">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-surface p-10 text-center shadow-widget">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover">
          <svg className="h-7 w-7 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v10" />
            <path d="m4.93 10.93 1.41 1.41" />
            <path d="M2 18h2" />
            <path d="M20 18h2" />
            <path d="m19.07 10.93-1.41 1.41" />
            <path d="M22 22H2" />
            <path d="m16 6-4 4-4-4" />
            <path d="M16 18a4 4 0 0 0-8 0" />
          </svg>
        </div>

        {/* Title */}
        <div>
          <h2 className="text-xl font-semibold text-text">
            {isDownloading ? 'Downloading Update' : 'Update Required'}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {isDownloading
              ? `Version ${version}, ${percent}%`
              : `Version ${version} is ready to install`}
          </p>
        </div>

        {/* Progress bar (during download) */}
        {isDownloading && (
          <div className="w-full">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-text transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Release notes */}
        {updateState.releaseNotes && (
          <div className="w-full rounded-[10px] border border-border bg-surface-sunken p-4 text-left">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              What&apos;s new
            </p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-text">
              {updateState.releaseNotes}
            </p>
          </div>
        )}

        {/* Install button */}
        <button
          onClick={handleInstall}
          disabled={installing || isDownloading}
          className="flex h-10 w-full items-center justify-center rounded-lg border border-text bg-text px-6 text-[13px] font-semibold text-bg transition-colors hover:border-text-muted hover:bg-text-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-text disabled:hover:bg-text"
        >
          {buttonLabel}
        </button>

      </div>
    </div>
  );
}
