interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}

export function Switch({ checked, onChange, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
        checked ? 'bg-text' : 'bg-border-strong'
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform duration-200 ${
          checked ? 'translate-x-[18px] bg-bg' : 'translate-x-0 bg-text'
        }`}
      />
    </button>
  );
}
