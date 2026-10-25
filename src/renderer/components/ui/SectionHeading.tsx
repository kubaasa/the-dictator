interface SectionHeadingProps {
  title: string;
  meta?: string;
}

export function SectionHeading({ title, meta }: SectionHeadingProps) {
  return (
    <h2 className="flex items-baseline gap-2.5">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">{title}</span>
      {meta && <span className="font-mono text-[11px] text-text-dim">{meta}</span>}
    </h2>
  );
}
