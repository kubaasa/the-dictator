import { useState, useEffect, useCallback } from 'react';
import type { WidgetType } from '../../shared/types';

const WIDGETS: { id: WidgetType; label: string; tag: string; description: string }[] = [
  { id: 'voicebar', label: 'Mini', tag: 'COMPACT', description: 'Floating pill — hover to interact' },
  { id: 'maxi', label: 'Maxi', tag: 'FULL', description: 'Detailed card with waveform & shortcuts' },
];

type FeatureRow = {
  feature: string;
  mini: string | boolean;
  maxi: string | boolean;
};

const COMPARISON: FeatureRow[] = [
  { feature: 'Audio bars',          mini: '6',                    maxi: '60 (Hanning shape)' },
  { feature: 'Form factor',         mini: 'Compact pill',         maxi: 'Wide card' },
  { feature: 'Hover expand',        mini: true,                   maxi: false },
  { feature: 'Error details',       mini: 'Icon only',            maxi: 'Full message' },
  { feature: 'Processing state',    mini: '[...]',                maxi: '[ PROCESSING ... ]' },
  { feature: 'Drag & drop',         mini: true,                   maxi: true },
];

export function WidgetPage() {
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [loaded, setLoaded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (s.widget) {
        setActiveWidget(s.widget.activeWidget);
      }
      if (!s.general?.widgetTooltipShown) {
        setShowTooltip(true);
      }
      setLoaded(true);
    });
  }, []);

  const dismissTooltip = useCallback(async () => {
    setShowTooltip(false);
    const s = await window.dictator.getSettings();
    window.dictator.setSettings({ general: { ...s.general, widgetTooltipShown: true } });
  }, []);

  const save = useCallback(
    (widget: WidgetType) => {
      setActiveWidget(widget);
      window.dictator.setSettings({ widget: { activeWidget: widget } });
    },
    [],
  );

  if (!loaded) return null;

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-8">

        {/* ── First-use tooltip ── */}
        {showTooltip && (
          <div className="flex items-start gap-3 rounded-xl border border-green-600/30 bg-green-600/5 px-4 py-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <p className="flex-1 font-mono text-sm leading-relaxed text-neutral-300">
              The recording widget floats on your screen — always on top.
              Hover over it to see the options.
            </p>
            <button
              onClick={dismissTooltip}
              className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
              aria-label="Dismiss"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* ── Section 1: Widget Selector ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Overlay Widget
          </h2>

          <div className="grid grid-cols-2 gap-3">
            {WIDGETS.map((w) => {
              const isActive = activeWidget === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => save(w.id)}
                  className={`group relative flex flex-col items-center gap-3 rounded-xl border p-5 transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'border-red-600/50 bg-red-600/5'
                      : 'border-neutral-800 bg-[#141414] hover:border-neutral-700'
                  }`}
                >
                  {/* Active badge */}
                  {isActive && (
                    <span className="absolute top-3 right-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-red-500">
                      Active
                    </span>
                  )}

                  {/* Preview */}
                  <div className="flex items-center justify-center h-12">
                    {w.id === 'voicebar' ? (
                      <MiniPreview active={isActive} />
                    ) : (
                      <MaxiPreview active={isActive} />
                    )}
                  </div>

                  {/* Label + description */}
                  <div className="flex flex-col items-center gap-1">
                    <span className={`font-mono text-lg font-semibold ${
                      isActive ? 'text-red-400' : 'text-neutral-200'
                    }`}>
                      {w.label}
                    </span>
                    <span className="text-sm text-neutral-500 text-center leading-tight">
                      {w.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

        </section>

        {/* ── Section 2: Comparison Table ── */}
        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Comparison
          </h2>

          <div className="rounded-xl border border-neutral-800 bg-[#141414] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className="px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
                    Feature
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-center text-neutral-500">
                    Mini
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-center text-neutral-500">
                    Maxi
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i < COMPARISON.length - 1 ? 'border-b border-neutral-800/50' : ''}
                  >
                    <td className="px-4 py-3 font-mono text-sm text-neutral-300">
                      {row.feature}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CellValue value={row.mini} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CellValue value={row.maxi} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <svg className="inline-block" width="18" height="18" viewBox="0 0 16 16">
        <path d="M4 8.5L6.5 11L12 5" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (value === false) {
    return (
      <svg className="inline-block" width="18" height="18" viewBox="0 0 16 16">
        <path d="M5 5L11 11M11 5L5 11" stroke="#737373" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <span className="font-mono text-sm text-neutral-400">{value}</span>
  );
}

function MiniPreview({ active }: { active: boolean }) {
  const stroke = active ? '#EF4444' : '#525252';
  const bar = active ? '#EF4444' : '#737373';
  const barOpacity = active ? 0.8 : 0.5;
  const heights = [5, 14, 8, 18, 10, 15];

  return (
    <svg width="80" height="28" viewBox="0 0 80 28">
      <rect x="0.5" y="0.5" width="79" height="27" rx="13.5" fill="none" stroke={stroke} strokeWidth="1" opacity={active ? 0.6 : 0.35} />
      {heights.map((h, i) => (
        <rect
          key={i}
          x={18 + i * 8}
          y={14 - h / 2}
          width="3"
          height={h}
          rx="1.5"
          fill={bar}
          opacity={barOpacity}
        />
      ))}
    </svg>
  );
}

function MaxiPreview({ active }: { active: boolean }) {
  const stroke = active ? '#EF4444' : '#525252';
  const bar = active ? '#EF4444' : '#737373';
  const barOpacity = active ? 0.7 : 0.4;
  const text = active ? '#EF4444' : '#737373';

  return (
    <svg width="120" height="40" viewBox="0 0 120 40">
      <rect x="0.5" y="0.5" width="119" height="39" rx="8" fill="none" stroke={stroke} strokeWidth="1" opacity={active ? 0.6 : 0.35} />

      {/* [REC] indicator */}
      <circle cx="10" cy="8" r="2.5" fill={text} opacity={0.6} />
      <text x="15" y="10.5" fontFamily="monospace" fontSize="6" fontWeight="700" fill={text} opacity={0.5}>REC</text>

      {/* Waveform bars */}
      {Array.from({ length: 20 }, (_, i) => {
        const pattern = [4, 12, 7, 15, 5, 14, 9, 16, 6, 13, 3, 11, 8, 15, 4, 10, 14, 6, 12, 5];
        const h = pattern[i];
        return (
          <rect
            key={i}
            x={8 + i * 5.2}
            y={22 - h / 2}
            width="2.5"
            height={h}
            rx="1"
            fill={bar}
            opacity={barOpacity}
          />
        );
      })}

      {/* Shortcut hints */}
      <rect x="8" y="33" width="20" height="5" rx="1.5" fill={text} opacity={0.15} />
      <rect x="31" y="33" width="14" height="5" rx="1.5" fill={text} opacity={0.15} />
    </svg>
  );
}
