import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import type { AppSettings, HotkeyMode, WidgetType } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { VoiceBar } from './overlay/VoiceBar';
import { MaxiWidget } from './overlay/MaxiWidget';

const PREVIEW_LEVEL = 0.55;
const MAXI_PREVIEW_SCALE = 0.62;
const MAXI_PREVIEW_WIDTH = 480;
const MAXI_PREVIEW_HEIGHT = 100;

interface Fact {
  label: string;
  text: string;
}

const FACTS: Record<WidgetType, Fact[]> = {
  voicebar: [
    { label: 'Idle', text: 'Thin sliver, 64 × 8 px' },
    { label: 'Hover', text: 'Mic and shortcut, click to record' },
    { label: 'Done', text: '"Pasted" with a green border' },
  ],
  maxi: [
    { label: 'Idle', text: 'Hidden' },
    { label: 'Recording', text: 'Timer, 50 bars and shortcut pill' },
    { label: 'Done', text: 'Pasted text with a green border' },
  ],
};

const WIDGETS: { id: WidgetType; label: string }[] = [
  { id: 'voicebar', label: 'Mini' },
  { id: 'maxi', label: 'Maxi' },
];

export function WidgetPage() {
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [shortcuts, setShortcuts] = useState<AppSettings['hotkey']['shortcuts']>(DEFAULT_SETTINGS.hotkey.shortcuts);
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>(DEFAULT_SETTINGS.hotkey.mode);
  const [loaded, setLoaded] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const bandsRef = useRef<number[] | null>(null);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      if (s.widget) setActiveWidget(s.widget.activeWidget);
      if (s.hotkey) {
        setShortcuts({ ...DEFAULT_SETTINGS.hotkey.shortcuts, ...s.hotkey.shortcuts });
        setHotkeyMode(s.hotkey.mode);
      }
      if (!s.general?.widgetTooltipShown) setShowHint(true);
      setLoaded(true);
    }).catch((err) => {
      log.error('Failed to load settings in WidgetPage:', err);
      setLoaded(true);
    });
  }, []);

  const dismissHint = useCallback(async () => {
    setShowHint(false);
    const s = await window.dictator.getSettings();
    window.dictator.setSettings({ general: { ...s.general, widgetTooltipShown: true } });
  }, []);

  const save = useCallback((widget: WidgetType) => {
    setActiveWidget(widget);
    window.dictator.setSettings({ widget: { activeWidget: widget } });
  }, []);

  if (!loaded) return null;

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex max-w-[860px] flex-col gap-5">

        {showHint && (
          <div className="flex items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[13px] text-text-muted">
            <span className="flex-1">The widget floats above every window. Drag it anywhere, hover it to see the options.</span>
            <button
              onClick={dismissHint}
              aria-label="Dismiss"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-border hover:text-text"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div role="radiogroup" aria-label="Overlay widget" className="grid grid-cols-2 gap-3.5">
          {WIDGETS.map((w) => {
            const selected = activeWidget === w.id;
            return (
              <div
                key={w.id}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => save(w.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); save(w.id); } }}
                className={`flex cursor-pointer flex-col gap-3.5 rounded-xl border bg-surface p-4 text-left transition-colors ${
                  selected ? 'border-text' : 'border-border hover:border-border-strong'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-text' : 'border-border-strong'}`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-text" />}
                  </span>
                  <span className="text-sm font-semibold text-text">{w.label}</span>
                </span>

                <span
                  aria-hidden="true"
                  className="pointer-events-none flex h-[132px] items-center justify-center overflow-hidden rounded-lg bg-bg"
                >
                  {w.id === 'voicebar' ? (
                    <VoiceBar voiceLevel={PREVIEW_LEVEL} state="recording" preview />
                  ) : (
                    <span
                      className="block"
                      style={{ width: MAXI_PREVIEW_WIDTH * MAXI_PREVIEW_SCALE, height: MAXI_PREVIEW_HEIGHT * MAXI_PREVIEW_SCALE }}
                    >
                      <span className="inline-block origin-top-left" style={{ transform: `scale(${MAXI_PREVIEW_SCALE})` }}>
                        <MaxiWidget
                          voiceLevel={PREVIEW_LEVEL}
                          bandsRef={bandsRef}
                          state="recording"
                          shortcuts={shortcuts}
                          hotkeyMode={hotkeyMode}
                          preview
                        />
                      </span>
                    </span>
                  )}
                </span>

                <span className="flex flex-col gap-1.5">
                  {FACTS[w.id].map((fact) => (
                    <span key={fact.label} className="flex items-baseline gap-2.5 text-xs">
                      <span className="w-[72px] shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">{fact.label}</span>
                      <span className="text-text">{fact.text}</span>
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>

      </div>
    </main>
  );
}
