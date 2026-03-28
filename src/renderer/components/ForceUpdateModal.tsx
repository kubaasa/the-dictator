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

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="flex max-w-md flex-col items-center gap-6 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-10 text-center shadow-2xl">
        {/* Icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15">
          <svg className="h-8 w-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <h2 className="text-xl font-semibold text-neutral-100">
            Update Required
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Version {version} is ready to install
          </p>
        </div>

        {/* Release notes */}
        {updateState.releaseNotes && (
          <div className="w-full rounded-lg bg-neutral-800/60 p-4 text-left">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
              What&apos;s new
            </p>
            <p className="text-sm leading-relaxed text-neutral-300 whitespace-pre-line">
              {updateState.releaseNotes}
            </p>
          </div>
        )}

        {/* Install button */}
        <button
          onClick={handleInstall}
          disabled={installing}
          className="w-full rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {installing ? 'Restarting...' : 'Install & Restart'}
        </button>

      </div>
    </div>
  );
}
