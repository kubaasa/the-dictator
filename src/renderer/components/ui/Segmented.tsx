import { useLayoutEffect, useRef, useState } from 'react';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const userTargetRef = useRef<T | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number; animate: boolean } | null>(null);
  const optionKey = options.map((o) => o.value).join('|');

  const select = (next: T) => {
    userTargetRef.current = next;
    onChange(next);
  };

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = (animate: boolean) => {
      const el = group.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(value)}"]`);
      if (!el) return;
      const left = el.offsetLeft;
      const width = el.offsetWidth;
      setIndicator((prev) => (prev && prev.left === left && prev.width === width ? prev : { left, width, animate }));
    };
    measure(userTargetRef.current === value);
    userTargetRef.current = null;
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(group);
    return () => observer.disconnect();
  }, [value, optionKey]);

  // Arrow keys move the selection like a native radio group and keep focus on the chosen segment
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const idx = enabled.findIndex((o) => o.value === value);
    if (idx === -1) return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = enabled[(idx + step + enabled.length) % enabled.length];
    select(next.value);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
    buttons?.forEach((b) => { if (b.dataset.value === next.value) b.focus(); });
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="relative inline-flex overflow-hidden rounded-lg border border-border bg-surface-sunken"
    >
      {indicator && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 rounded-[7px] bg-text ${
            indicator.animate ? 'transition-[transform,width] duration-200 ease-out' : ''
          }`}
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={opt.disabled}
            data-value={opt.value}
            onClick={() => select(opt.value)}
            className={`relative z-10 px-3 py-1.5 text-xs transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? 'font-medium text-bg' : 'text-text-muted hover:text-text'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
