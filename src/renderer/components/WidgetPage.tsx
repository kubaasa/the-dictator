import { useState, useEffect, useCallback } from 'react';
import log from 'electron-log/renderer';
import type { ReactNode } from 'react';
import type { WidgetType } from '../../shared/types';

const WIDGETS: { id: WidgetType; label: string; description: string }[] = [
  { id: 'voicebar', label: 'Mini', description: 'Floating pill — hover to interact' },
  { id: 'maxi', label: 'Maxi', description: 'Detailed card with waveform & shortcuts' },
];

function WhiteWaveBars() {
  const heights = [8, 14, 6, 16, 10, 12];
  return (
    <svg className="inline-block" width="42" height="20" viewBox="0 0 42 20">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={3 + i * 6.5}
          y={10 - h / 2}
          width="3"
          height={h}
          rx="1.5"
          fill="rgba(255,255,255,0.85)"
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

type FeatureRow = {
  feature: string;
  mini: string | boolean | ReactNode;
  maxi: string | boolean | ReactNode;
};

const COMPARISON: FeatureRow[] = [
  { feature: 'Audio bars',          mini: '6 (flat)',              maxi: '60 (Hanning shape)' },
  { feature: 'Form factor',         mini: 'Compact pill',          maxi: 'Wide card' },
  { feature: 'Hover to interact',   mini: true,                    maxi: false },
  { feature: 'Keyboard shortcuts',  mini: false,                   maxi: true },
  { feature: 'REC indicator',       mini: false,                   maxi: true },
  { feature: 'Error details',       mini: '✕ icon',                maxi: 'Full message' },
  { feature: 'Processing state',    mini: <WhiteWaveBars />,       maxi: <span className="font-mono text-sm text-neutral-400">Processing...</span> },
  { feature: 'Enter/exit animation',mini: true,                    maxi: true },
  { feature: 'Drag & drop',         mini: true,                    maxi: true },
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
    }).catch((err) => log.error('Failed to load settings in WidgetPage:', err));
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
                  {isActive && (
                    <span className="absolute top-3 right-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-red-500">
                      Active
                    </span>
                  )}

                  <div className="flex items-center justify-center h-12">
                    {w.id === 'voicebar' ? (
                      <MiniPreview active={isActive} />
                    ) : (
                      <MaxiPreview active={isActive} />
                    )}
                  </div>

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

        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Comparison
          </h2>

          <div className="rounded-xl border border-neutral-800 bg-[#141414] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className="px-4 py-3 text-sm font-semibold text-neutral-200 bg-neutral-800/30">
                    Feature
                  </th>
                  <th className="px-4 py-3 text-sm font-semibold text-neutral-200 text-center bg-neutral-800/30">
                    Mini
                  </th>
                  <th className="px-4 py-3 text-sm font-semibold text-neutral-200 text-center bg-neutral-800/30">
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
                    <td className="px-4 py-3 text-sm font-semibold text-neutral-200 bg-neutral-800/30">
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

function CellValue({ value }: { value: string | boolean | ReactNode }) {
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
  if (typeof value === 'string') {
    return (
      <span className="font-mono text-sm text-neutral-400">{value}</span>
    );
  }
  return <>{value}</>;
}

function MiniPreview({ active }: { active: boolean }) {
  const borderColor = active ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)';
  const barColor = active ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.45)';

  const heights = [4, 12, 7, 18, 14, 5];

  return (
    <svg width="82" height="34" viewBox="0 0 82 34">
      <rect x="3" y="4" width="78" height="28" rx="14" fill="rgba(0,0,0,0.2)" />
      <rect x="1" y="2" width="78" height="28" rx="14"
        fill="#0a0a0a" stroke={borderColor} strokeWidth="1" />
      <rect x="2" y="3" width="76" height="26" rx="13"
        fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
      {heights.map((h, i) => (
        <rect
          key={i}
          x={21 + i * 7}
          y={16 - h / 2}
          width="3"
          height={h}
          rx="1.5"
          fill={barColor}
        />
      ))}
    </svg>
  );
}

function MaxiPreview({ active }: { active: boolean }) {
  const borderColor = active ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)';
  const barColor = active ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.35)';
  const accentColor = active ? '#DC2626' : 'rgba(255,255,255,0.35)';
  const labelColor = active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
  const badgeFill = active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
  const badgeStroke = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)';
  const badgeText = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';

  const barCount = 30;
  const barW = 2;
  const barGap = 1.5;
  const totalBarsW = barCount * barW + (barCount - 1) * barGap;
  const barsStartX = 1 + (128 - totalBarsW) / 2;

  return (
    <svg width="132" height="48" viewBox="0 0 132 48">
      <rect x="3" y="3" width="128" height="44" rx="8" fill="rgba(0,0,0,0.2)" />
      <rect x="1" y="1" width="128" height="44" rx="8"
        fill="#0a0a0a" stroke={borderColor} strokeWidth="1" />
      <rect x="2" y="2" width="126" height="42" rx="7"
        fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />

      <text x="9" y="12" fontFamily="'Courier New', monospace" fontSize="6" fontWeight="700"
        fill={accentColor} letterSpacing="0.5">[</text>
      <circle cx="15.5" cy="10" r="2" fill={accentColor} opacity={active ? 1 : 0.5} />
      <text x="19" y="12" fontFamily="'Courier New', monospace" fontSize="6" fontWeight="700"
        fill={accentColor} letterSpacing="0.5">REC]</text>

      {[2, 3, 5, 8, 14, 7, 16, 11, 18, 9, 15, 17, 6, 14, 18, 16, 8, 17, 12, 15, 10, 18, 7, 13, 16, 9, 6, 4, 3, 1.5].map((h, i) => (
        <rect
          key={i}
          x={barsStartX + i * (barW + barGap)}
          y={25 - h / 2}
          width={barW}
          height={h}
          rx="1"
          fill={barColor}
        />
      ))}

      <text x="30" y="42" fontFamily="'Courier New', monospace" fontSize="5"
        fill={labelColor}>Stop</text>
      <rect x="46" y="37" width="12" height="7" rx="1.5"
        fill={badgeFill} stroke={badgeStroke} strokeWidth="0.5" />
      <text x="48.5" y="42.5" fontFamily="'Courier New', monospace" fontSize="4.5"
        fill={badgeText}>F2</text>

      <line x1="62" y1="38" x2="62" y2="44" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />

      <text x="66" y="42" fontFamily="'Courier New', monospace" fontSize="5"
        fill={labelColor}>Cancel</text>
      <rect x="87" y="37" width="14" height="7" rx="1.5"
        fill={badgeFill} stroke={badgeStroke} strokeWidth="0.5" />
      <text x="89" y="42.5" fontFamily="'Courier New', monospace" fontSize="4.5"
        fill={badgeText}>Esc</text>
    </svg>
  );
}
