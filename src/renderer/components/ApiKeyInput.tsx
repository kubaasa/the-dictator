import { useState, useRef, useEffect } from 'react';
import { ConfirmDeleteButton } from './ui/ConfirmDeleteButton';

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
  invalid?: boolean;
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
  invalid = false,
  buttonLabel,
  buttonDisabled = false,
  placeholder: customPlaceholder,
}: ApiKeyInputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEmpty = !value;
  const showMasked = !isEmpty && !focused;

  const placeholder = isEmpty
    ? (customPlaceholder ?? '[NO SIGNAL] paste access key...')
    : '';

  const label = buttonLabel ?? 'Save';

  useEffect(() => {
    if (!saved) setFocused(false);
  }, [saved]);

  useEffect(() => {
    if (focused && inputRef.current) {
      inputRef.current.focus();
    }
  }, [focused]);

  // Every caller saves a key only after it passed validation, so a saved key is a verified key
  if (saved) {
    return (
      <div className="flex gap-2">
        <div className="flex-1 relative min-w-0">
          <div className="flex items-center rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-sm font-mono text-text-muted tracking-wider">
            <span className="text-accent/50 mr-2 shrink-0">[ENC]</span>
            <span className="min-w-0 truncate text-text-dim">{maskKey(value)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 font-sans text-[11px] tracking-normal text-ok">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.4} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7" />
              </svg>
              Verified
            </span>
          </div>
        </div>
        {onDelete && <ConfirmDeleteButton onConfirm={onDelete} label="API key" />}
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
          <div className={`flex items-center rounded-lg border bg-surface-sunken px-3 py-1.5 text-sm font-mono text-text-muted tracking-wider ${invalid ? 'border-accent/60' : 'border-border'}`}>
            <span className="text-accent/50 mr-2">[ENC]</span>
            <span className="text-text-dim">{maskKey(value)}</span>
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
            className={`w-full rounded-lg border bg-surface-sunken px-3 py-1.5 text-sm font-mono text-text placeholder-text-dim focus:outline-none ${
              invalid ? 'border-accent/60' : 'border-border focus:border-border-strong'
            }`}
          />
        )}
      </div>
      <button
        onClick={onSave}
        disabled={buttonDisabled}
        className="w-24 shrink-0 rounded-lg border border-border-strong bg-surface-hover py-1.5 text-xs font-medium text-text text-center transition-colors hover:border-text-dim cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label}
      </button>
    </div>
  );
}
