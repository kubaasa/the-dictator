import { useState, useRef, useCallback } from 'react';

interface CopyButtonProps {
  text: string;
  stopPropagation?: boolean;
  className?: string;
  iconOnly?: boolean;
}

export function CopyButton({ text, stopPropagation, className, iconOnly }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text, stopPropagation]);

  const checkIcon = (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
  const copyIcon = (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
    </svg>
  );

  if (iconOnly) {
    return (
      <button
        onClick={handleClick}
        aria-label={copied ? 'Copied' : 'Copy'}
        title={copied ? 'Copied!' : 'Copy'}
        className={className ?? `flex items-center justify-center rounded-md p-1.5 transition-colors ${
          copied
            ? 'text-green-400'
            : 'text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800'
        }`}
      >
        {copied ? checkIcon : copyIcon}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={className ?? 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider border transition-colors ' +
        (copied
          ? 'text-green-400 border-green-700'
          : 'text-neutral-400 border-neutral-700 hover:border-neutral-500 hover:text-neutral-200'
        )}
    >
      {copied ? checkIcon : copyIcon}
      <span role="status" aria-live="polite">
        {copied ? 'Copied!' : 'Copy'}
      </span>
    </button>
  );
}
