import { useState, useEffect, useCallback } from 'react';

export function WidgetPage() {
  const [size, setSize] = useState(0.5);
  const [opacity, setOpacity] = useState(1.0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (s.widget) {
        setSize(s.widget.size);
        setOpacity(s.widget.opacity);
      }
      setLoaded(true);
    });
  }, []);

  const save = useCallback(
    (patch: Partial<{ size: number; opacity: number }>) => {
      window.dictator.setSettings({
        widget: { activeWidget: 'voicebar', size, opacity, ...patch },
      });
    },
    [size, opacity],
  );

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-8 p-6 overflow-y-auto h-full">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-400">Widget</h2>

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
            setSize(val);
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
            setOpacity(val);
            save({ opacity: val });
          }}
          className="w-full accent-red-600"
        />
      </div>
    </div>
  );
}
