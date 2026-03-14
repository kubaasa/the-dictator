import { useState, useEffect, useCallback } from 'react';
import type { WidgetType } from '../../shared/types';

const WIDGETS: { id: WidgetType; label: string; description: string }[] = [
  { id: 'voicebar', label: 'Mini', description: 'Compact pill with animated bars' },
  { id: 'maxi', label: 'Maxi', description: 'Detailed card with waveform & controls' },
];

export function WidgetPage() {
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [size, setSize] = useState(0.5);
  const [opacity, setOpacity] = useState(1.0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (s.widget) {
        setActiveWidget(s.widget.activeWidget);
        setSize(s.widget.size);
        setOpacity(s.widget.opacity);
      }
      setLoaded(true);
    });
  }, []);

  const save = useCallback(
    (patch: Partial<{ activeWidget: WidgetType; size: number; opacity: number }>) => {
      const next = { activeWidget, size, opacity, ...patch };
      setActiveWidget(next.activeWidget);
      setSize(next.size);
      setOpacity(next.opacity);
      window.dictator.setSettings({ widget: next });
    },
    [activeWidget, size, opacity],
  );

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-8 p-6 overflow-y-auto h-full">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-400">Widget</h2>

      {/* Widget Appearance */}
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-400">
          Appearance
        </span>
        <div className="flex gap-3">
          {WIDGETS.map((w) => {
            const isActive = activeWidget === w.id;
            return (
              <button
                key={w.id}
                onClick={() => save({ activeWidget: w.id })}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors flex-1 ${
                  isActive
                    ? 'border-red-600/50 bg-red-600/10 text-red-400'
                    : 'border-neutral-800 bg-[#141414] text-neutral-500 hover:border-neutral-700'
                }`}
              >
                {/* Thumbnail icon */}
                <div className="flex items-center justify-center h-10">
                  {w.id === 'voicebar' ? (
                    <MiniIcon active={isActive} />
                  ) : (
                    <MaxiIcon active={isActive} />
                  )}
                </div>
                <span className="font-mono text-sm font-semibold">{w.label}</span>
                <span className="text-[10px] text-neutral-600">{w.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Size */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-400">Size</span>
          <span className="font-mono text-xs text-neutral-400">{Math.round(size * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={size}
          onChange={(e) => {
            const val = Number(e.target.value);
            save({ size: val });
          }}
          className="w-full accent-red-600"
        />
      </div>

      {/* Opacity */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-400">Opacity</span>
          <span className="font-mono text-xs text-neutral-400">{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.3}
          max={1.0}
          step={0.05}
          value={opacity}
          onChange={(e) => {
            const val = Number(e.target.value);
            save({ opacity: val });
          }}
          className="w-full accent-red-600"
        />
      </div>
    </div>
  );
}

function MiniIcon({ active }: { active: boolean }) {
  const color = active ? '#EF4444' : '#737373';
  return (
    <svg width="64" height="24" viewBox="0 0 64 24">
      <rect x="0" y="0" width="64" height="24" rx="12" fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
      {[14, 22, 30, 34, 26, 18].map((h, i) => (
        <rect
          key={i}
          x={12 + i * 7}
          y={12 - h / 5}
          width="3"
          height={h / 2.5}
          rx="1.5"
          fill={color}
          opacity="0.7"
        />
      ))}
    </svg>
  );
}

function MaxiIcon({ active }: { active: boolean }) {
  const color = active ? '#EF4444' : '#737373';
  return (
    <svg width="64" height="32" viewBox="0 0 64 32">
      <rect x="0" y="0" width="64" height="32" rx="6" fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Mode pill */}
      <rect x="4" y="11" width="12" height="10" rx="3" fill={color} opacity="0.3" />
      {/* Waveform bars */}
      {Array.from({ length: 12 }, (_, i) => {
        const h = 4 + Math.sin(i * 0.8) * 6 + Math.cos(i * 1.3) * 4;
        return (
          <rect
            key={i}
            x={20 + i * 3}
            y={16 - h / 2}
            width="2"
            height={h}
            rx="1"
            fill={color}
            opacity="0.6"
          />
        );
      })}
      {/* Buttons */}
      <rect x="56" y="11" width="5" height="5" rx="1" fill={color} opacity="0.4" />
      <path d="M56.5 20L60.5 24M56.5 24L60.5 20" stroke={color} strokeWidth="0.8" opacity="0.4" />
    </svg>
  );
}
