import { useEffect } from 'react';

interface UpToDatePopupProps {
  version: string;
  onClose: () => void;
}

const AUTO_DISMISS_MS = 4000;

export function UpToDatePopup({ version, onClose }: UpToDatePopupProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-neutral-700/50 bg-neutral-900 p-8 text-center shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Checkmark icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15">
          <svg className="h-7 w-7 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5L20 7" />
          </svg>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-neutral-100">
            You&apos;re up to date!
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            The Dictator v{version}
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-1 rounded-lg bg-neutral-800 px-6 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
        >
          OK
        </button>
      </div>
    </div>
  );
}
