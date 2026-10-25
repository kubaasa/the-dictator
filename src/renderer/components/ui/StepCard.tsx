import type { ReactNode } from 'react';

interface StepCardProps {
  number: number;
  title: string;
  description?: string;
  control?: ReactNode;
  last?: boolean;
  children?: ReactNode;
}

export function StepCard({ number, title, description, control, last = false, children }: StepCardProps) {
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-4">
      <div className="relative">
        <div className="relative z-10 grid h-7 w-7 place-items-center rounded-full border border-border-strong bg-surface font-mono text-xs font-semibold text-text">
          {number}
        </div>
        {!last && <div className="absolute -bottom-6 left-[13px] top-7 w-px bg-border" aria-hidden="true" />}
      </div>
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-[18px]">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {control}
        </div>
        {description && <p className="-mt-1 text-xs text-text-muted">{description}</p>}
        {children}
      </section>
    </div>
  );
}
