import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_SETTINGS, type AppSettings, type HotkeyMode } from '../../shared/types';

type ShortcutKey = 'toggleRecording' | 'cancelRecording' | 'pushToTalk' | 'showWindow';

interface ShortcutConfig {
  key: ShortcutKey;
  label: string;
  description: string;
}

const RECORDING_SHORTCUTS: ShortcutConfig[] = [
  { key: 'toggleRecording', label: 'Toggle Recording', description: 'Start or stop voice recording' },
  { key: 'cancelRecording', label: 'Cancel Recording', description: 'Discard current recording without transcription' },
  { key: 'pushToTalk', label: 'Push-to-Talk', description: 'One modifier + one key — hold to record, release to stop (active only in Push-to-Talk mode)' },
];

const APP_SHORTCUTS: ShortcutConfig[] = [
  { key: 'showWindow', label: 'Show / Hide Window', description: 'Bring the app window to focus or hide it' },
];

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const KEY_DISPLAY_SYMBOLS: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', Enter: '↵', Tab: 'Tab', Backspace: '⌫',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
  Comma: ',', Period: '.', Slash: '/',
};

function formatKeyForDisplay(key: string): string {
  return KEY_DISPLAY_SYMBOLS[key] ?? key;
}

function KeyBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-block rounded px-2 py-0.5 font-mono text-xs text-neutral-200 bg-neutral-700 border border-neutral-600"
      style={{ boxShadow: '0 2px 0 #111111, inset 0 1px 0 rgba(255,255,255,0.08)' }}
    >
      {label}
    </span>
  );
}

function ShortcutDisplay({ combo }: { combo: string }) {
  const parts = combo.split('+');
  return (
    <span className="flex items-center gap-1.5">
      {parts.map((part, i) => (
        <KeyBadge key={i} label={formatKeyForDisplay(part)} />
      ))}
    </span>
  );
}

// Maps e.code (physical key) → readable name that matches KEY_MAP in hotkey.service.ts
function physicalKeyName(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;

  const codeMap: Record<string, string> = {
    Space: 'Space',
    Escape: 'Escape',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Minus: 'Minus',
    Equal: 'Equal',
    BracketLeft: 'BracketLeft',
    BracketRight: 'BracketRight',
    Backslash: 'Backslash',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    Backquote: 'Backquote',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
  };
  return codeMap[code] ?? null;
}

// Returns exactly one modifier + one key for push-to-talk (e.g. Ctrl+X, Shift+F9)
function formatPttCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  if (mods.length !== 1) return null;

  const keyName = physicalKeyName(e.code);
  if (!keyName) return null;

  return mods[0] + '+' + keyName;
}

// Returns a modifier+key combo string (requires at least one modifier)
function formatKeyCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (parts.length === 0) return null;

  const keyName = physicalKeyName(e.code);
  if (!keyName) return null;

  parts.push(keyName);
  return parts.join('+');
}

// Returns a single key OR modifier+key combo (modifier is optional)
function formatSingleOrComboKey(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  const keyName = physicalKeyName(e.code);
  if (!keyName) return null;

  parts.push(keyName);
  return parts.join('+');
}

export function ShortcutsPage() {
  const [shortcuts, setShortcuts] = useState(DEFAULT_SETTINGS.hotkey.shortcuts);
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>(DEFAULT_SETTINGS.hotkey.mode);
  const [listeningFor, setListeningFor] = useState<ShortcutKey | null>(null);
  const [pendingKeys, setPendingKeys] = useState('');
  const [error, setError] = useState('');
  const [shakingKey, setShakingKey] = useState<ShortcutKey | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dictator.getSettings().then((s: AppSettings) => {
      const stored = s.hotkey?.shortcuts ?? DEFAULT_SETTINGS.hotkey.shortcuts;
      setShortcuts({ ...DEFAULT_SETTINGS.hotkey.shortcuts, ...stored });
      setHotkeyMode(s.hotkey?.mode ?? DEFAULT_SETTINGS.hotkey.mode);
    });
  }, []);

  const saveShortcuts = useCallback(async (newShortcuts: typeof shortcuts) => {
    const settings = await window.dictator.getSettings();
    await window.dictator.setSettings({
      hotkey: { ...settings.hotkey, shortcuts: newShortcuts },
    });
    setShortcuts(newShortcuts);
  }, []);

  const saveHotkeyMode = useCallback(async (newMode: HotkeyMode) => {
    const settings = await window.dictator.getSettings();
    await window.dictator.setSettings({
      hotkey: { ...settings.hotkey, mode: newMode },
    });
    setHotkeyMode(newMode);
  }, []);

  const startListening = useCallback((key: ShortcutKey) => {
    setListeningFor(key);
    setPendingKeys('');
    setError('');
  }, []);

  const cancelListening = useCallback(() => {
    setListeningFor(null);
    setPendingKeys('');
    setError('');
  }, []);

  useEffect(() => {
    if (!listeningFor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && listeningFor !== 'cancelRecording') {
        cancelListening();
        return;
      }

      const isPtt = listeningFor === 'pushToTalk';
      const isCancelRecording = listeningFor === 'cancelRecording';
      const result = isPtt ? formatPttCombo(e) : isCancelRecording ? formatSingleOrComboKey(e) : formatKeyCombo(e);

      if (result) {
        const otherShortcuts = Object.entries(shortcuts)
          .filter(([k]) => k !== listeningFor)
          .map(([, v]) => v);

        if (otherShortcuts.includes(result)) {
          setError(`"${result}" is already used by another shortcut`);
          return;
        }

        const newShortcuts = { ...shortcuts, [listeningFor]: result };
        saveShortcuts(newShortcuts);
        setListeningFor(null);
        setPendingKeys('');
        setError('');
      } else {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');

        if (isPtt && parts.length > 1) {
          setError('Push-to-Talk accepts only one modifier + one key');
        } else {
          setPendingKeys(parts.length > 0 ? parts.join('+') + '+...' : '');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningFor, shortcuts, saveShortcuts, cancelListening]);

  useEffect(() => {
    if (listeningFor && inputRef.current) {
      inputRef.current.focus();
    }
  }, [listeningFor]);

  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up shake timer on unmount
  useEffect(() => {
    return () => { if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current); };
  }, []);

  const resetShortcut = useCallback(async (key: ShortcutKey) => {
    if (shortcuts[key] === DEFAULT_SETTINGS.hotkey.shortcuts[key]) {
      setShakingKey(key);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = setTimeout(() => { setShakingKey(null); shakeTimerRef.current = null; }, 300);
      return;
    }
    const newShortcuts = { ...shortcuts, [key]: DEFAULT_SETTINGS.hotkey.shortcuts[key] };
    await saveShortcuts(newShortcuts);
    setError('');
  }, [shortcuts, saveShortcuts]);

  const isInactive = (key: ShortcutKey): boolean => {
    if (hotkeyMode === 'toggle') return key === 'pushToTalk';
    if (hotkeyMode === 'push-to-talk') return key === 'toggleRecording' || key === 'cancelRecording';
    return false;
  };

  const renderShortcutRow = (config: ShortcutConfig) => {
    const inactive = isInactive(config.key);
    const isListening = !inactive && listeningFor === config.key;
    return (
      <div
        key={config.key}
        className={`flex items-center justify-between rounded-lg border px-5 py-4 transition-opacity ${
          inactive
            ? 'border-neutral-800/50 bg-[#0f0f0f] opacity-35 pointer-events-none select-none'
            : 'border-neutral-800 bg-[#141414]'
        }`}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-200">{config.label}</span>
          <span className="text-xs text-neutral-500">{config.description}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => resetShortcut(config.key)}
            className={`p-1 rounded transition-colors ${
              inactive
                ? 'text-neutral-700 pointer-events-none'
                : 'text-white hover:text-neutral-400'
            }`}
            title="Reset to default"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="4" x2="5" y2="20" />
              <polyline points="11 8 7 12 11 16" />
              <path d="M7 12h10a3 3 0 0 0 0-6h-2" />
            </svg>
          </button>
          <div
            ref={isListening ? inputRef : undefined}
            tabIndex={inactive ? -1 : 0}
            onClick={() => !inactive && startListening(config.key)}
            className={`min-w-[200px] rounded-md border px-4 py-2 flex items-center justify-center text-sm font-mono transition-colors ${
              isListening
                ? 'cursor-pointer border-red-600 bg-red-600/10 text-red-400'
                : inactive
                  ? 'cursor-default border-neutral-800 bg-neutral-900 text-neutral-600'
                  : 'cursor-pointer border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600'
            }`}
            style={shakingKey === config.key ? { animation: 'sc-shake 0.3s ease-in-out' } : undefined}
          >
            {isListening
              ? (pendingKeys
                  ? <ShortcutDisplay combo={pendingKeys} />
                  : config.key === 'pushToTalk' ? 'MODIFIER + KEY...' : config.key === 'cancelRecording' ? 'PRESS ANY KEY...' : 'AWAITING INPUT...')
              : <ShortcutDisplay combo={shortcuts[config.key]} />
            }
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-8">
      <style>{`
        @keyframes sc-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          60% { transform: translateX(-2px); }
          80% { transform: translateX(1px); }
        }
      `}</style>

      {/* Recording Mode */}
      <section>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">Recording Mode</h2>
        <div className="flex gap-3">
          {(['toggle', 'push-to-talk'] as HotkeyMode[]).map((m) => (
            <button
              key={m}
              onClick={() => saveHotkeyMode(m)}
              className={`flex-1 rounded-lg border px-5 py-4 text-left transition-colors ${
                hotkeyMode === m
                  ? 'border-red-700 bg-red-900/20 text-red-400'
                  : 'border-neutral-800 bg-[#141414] text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <span className="block font-mono text-xs font-semibold uppercase tracking-[0.25em] mb-1">
                {m === 'toggle' ? 'Toggle Mode' : 'Push-to-Talk'}
              </span>
              <span className="text-xs text-neutral-500">
                {m === 'toggle'
                  ? 'Press once to start, press again to stop'
                  : 'Hold the hotkey while speaking, release to stop'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Recording Shortcuts */}
      <section>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">Recording Shortcuts</h2>
        <div className="space-y-3">
          {RECORDING_SHORTCUTS.map(renderShortcutRow)}
        </div>
      </section>

      {/* App Shortcuts */}
      <section>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">App Shortcuts</h2>
        <div className="space-y-3">
          {APP_SHORTCUTS.map(renderShortcutRow)}
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

    </main>
  );
}
