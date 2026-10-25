import { useEffect, useRef, useState } from 'react';

const CONFIRM_MS = 3000;

interface ConfirmDeleteButtonProps {
  onConfirm: () => void;
  label: string;
  size?: 'md' | 'sm';
  disabled?: boolean;
}

export function ConfirmDeleteButton({ onConfirm, label, size = 'md', disabled }: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), CONFIRM_MS);
      return;
    }
    setConfirming(false);
    onConfirm();
  };

  const shape = size === 'md' ? 'h-8 rounded-lg' : 'h-7 rounded-md';
  const idle = size === 'md' ? 'w-8' : 'w-7';
  const confirm = size === 'md' ? 'px-3' : 'px-2.5';
  const icon = size === 'md' ? 'h-[18px] w-[18px]' : 'h-4 w-4';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={confirming ? `Confirm delete ${label}` : `Delete ${label}`}
      title={confirming ? 'Click again to delete' : `Delete ${label}`}
      className={`flex shrink-0 cursor-pointer items-center justify-center border text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${shape} ${
        confirming
          ? `border-text bg-text text-bg ${confirm}`
          : `border-accent bg-accent hover:border-accent-strong hover:bg-accent-strong ${idle}`
      }`}
    >
      {confirming ? 'Sure?' : (
        <svg className={icon} fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#ffffff" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      )}
    </button>
  );
}
