import { useState, useRef, useEffect } from 'react';

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '●'.repeat(key.length);
  const prefix = key.slice(0, 4);
  return `${prefix}${'●'.repeat(4)} (${key.length} chars)`;
}

interface ApiKeyInputProps {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onDelete?: () => void;
  saved?: boolean;
  buttonLabel?: string;
  buttonDisabled?: boolean;
  placeholder?: string;
}

export function ApiKeyInput({
  value,
  onChange,
  onSave,
  onDelete,
  saved = false,
  buttonLabel,
  buttonDisabled = false,
  placeholder: customPlaceholder,
}: ApiKeyInputProps) {
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmpty = !value;
  const showMasked = !isEmpty && !focused;

  const placeholder = isEmpty
    ? (customPlaceholder ?? '[NO SIGNAL] paste access key...')
    : '';

  const label = buttonLabel ?? 'Save';

  useEffect(() => {
    if (!saved) {
      setFocused(false);
      setConfirming(false);
    }
  }, [saved]);

  useEffect(() => {
    if (focused && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focused]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleDeleteClick = () => {
    if (!onDelete) return;
    if (!confirming) {
      setConfirming(true);
      confirmTimerRef.current = setTimeout(() => setConfirming(false), 3000);
    } else {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);
      onDelete();
    }
  };

  if (saved) {
    return (
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="flex items-center rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm font-mono text-neutral-500 tracking-wider">
            <span className="text-red-600/40 mr-2">[ENC]</span>
            <span className="text-neutral-600">{maskKey(value)}</span>
          </div>
        </div>
        <button
          onClick={handleDeleteClick}
          className={`w-24 shrink-0 rounded-lg border py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-center transition-colors cursor-pointer ${
            confirming
              ? 'bg-red-700 border-red-600 text-white animate-pulse'
              : 'bg-red-900/30 border-red-800/30 text-red-400 hover:bg-red-900/50'
          }`}
        >
          {confirming ? 'Sure?' : 'Delete'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div
        className="flex-1 relative cursor-text"
        onClick={() => { if (!focused) setFocused(true); }}
      >
        {showMasked ? (
          <div className="flex items-center rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm font-mono text-neutral-500 tracking-wider">
            <span className="text-red-600/40 mr-2">[ENC]</span>
            <span className="text-neutral-600">{maskKey(value)}</span>
          </div>
        ) : (
          <input
            ref={inputRef}
            type={focused ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (!value.trim()) onChange(''); }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-red-600/30"
          />
        )}
      </div>
      <button
        onClick={onSave}
        disabled={buttonDisabled}
        className="w-24 shrink-0 rounded-lg bg-neutral-700 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-200 text-center transition-colors hover:bg-neutral-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label}
      </button>
    </div>
  );
}
