import type { ReactNode } from 'react';

interface FieldRowProps {
  label: string;
  align?: 'center' | 'start';
  children: ReactNode;
}

export function FieldRow({ label, align = 'center', children }: FieldRowProps) {
  return (
    <div className={`flex gap-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <span className={`w-28 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted ${align === 'start' ? 'pt-2.5' : ''}`}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
