import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import { DEFAULT_SETTINGS, type AppSettings, type HotkeyMode } from '../../shared/types';
import { useToast } from './Toast';
import { Segmented } from './ui/Segmented';
import { Switch } from './ui/Switch';
import { FieldRow } from './ui/FieldRow';

type ShortcutKey = 'toggleRecording' | 'cancelRecording' | 'pushToTalk' | 'showWindow';

const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  toggleRecording: 'Start / stop recording',
  cancelRecording: 'Cancel recording',
  pushToTalk: 'Hold to talk',
  showWindow: 'Show / hide window',
};

const LISTENING_PLACEHOLDERS: Record<ShortcutKey, string> = {
  toggleRecording: 'Press keys',
  cancelRecording: 'Press any key',
  pushToTalk: 'Modifier + key',
  showWindow: 'Press keys',
};

const MODE_SHORTCUTS: Record<HotkeyMode, ShortcutKey[]> = {
  toggle: ['toggleRecording', 'cancelRecording'],
  'push-to-talk': ['pushToTalk'],
};

const MODE_OPTIONS: { value: HotkeyMode; label: string }[] = [
  { value: 'toggle', label: 'Toggle' },
  { value: 'push-to-talk', label: 'Push-to-talk' },
];

const SECTION_HEADING = 'font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted';

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

function KeyCaps({ combo }: { combo: string }) {
  return (
    <span className="flex items-center gap-1">
      {combo.split('+').map((part, i) => (
        <kbd
          key={i}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-b-2 border-border-strong bg-surface-hover px-[7px] font-mono text-xs text-text"
        >
          {formatKeyForDisplay(part)}
        </kbd>
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
  const [callMode, setCallMode] = useState(DEFAULT_SETTINGS.audio.callMode);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [listeningFor, setListeningFor] = useState<ShortcutKey | null>(null);
  const [pendingKeys, setPendingKeys] = useState('');
  const [error, setError] = useState('');
  const { addToast } = useToast();
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dictator.getSettings().then((s: AppSettings) => {
      const stored = s.hotkey?.shortcuts ?? DEFAULT_SETTINGS.hotkey.shortcuts;
      setShortcuts({ ...DEFAULT_SETTINGS.hotkey.shortcuts, ...stored });
      setHotkeyMode(s.hotkey?.mode ?? DEFAULT_SETTINGS.hotkey.mode);
      setCallMode(s.audio?.callMode ?? DEFAULT_SETTINGS.audio.callMode);
      setSettingsLoaded(true);
    }).catch((err) => {
      log.error('Failed to load settings in ShortcutsPage:', err);
      setSettingsLoaded(true);
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

  const saveCallMode = useCallback(async (enabled: boolean) => {
    const settings = await window.dictator.getSettings();
    await window.dictator.setSettings({
      audio: { ...settings.audio, callMode: enabled },
    });
    setCallMode(enabled);
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
        const duplicateKey = Object.entries(shortcuts).find(([k, v]) => k !== listeningFor && v === result)?.[0];
        if (duplicateKey) {
          const duplicateLabel = SHORTCUT_LABELS[duplicateKey as ShortcutKey] ?? duplicateKey;
          addToast('error', `"${result}" is already used by "${duplicateLabel}"`);
          cancelListening();
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
          setError('One modifier + one key');
        } else {
          setError('');
          setPendingKeys(parts.join('+'));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningFor, shortcuts, saveShortcuts, cancelListening, addToast]);

  useEffect(() => {
    if (listeningFor && inputRef.current) {
      inputRef.current.focus();
    }
  }, [listeningFor]);

  const resetShortcut = useCallback(async (key: ShortcutKey) => {
    const newShortcuts = { ...shortcuts, [key]: DEFAULT_SETTINGS.hotkey.shortcuts[key] };
    await saveShortcuts(newShortcuts);
    setError('');
  }, [shortcuts, saveShortcuts]);

  const renderShortcutRow = (key: ShortcutKey) => {
    const label = SHORTCUT_LABELS[key];
    const isListening = listeningFor === key;
    const isCustom = shortcuts[key] !== DEFAULT_SETTINGS.hotkey.shortcuts[key];

    return (
      <div key={key} className="flex min-h-[52px] items-center gap-2.5 pl-[18px] pr-2.5">
        <span className="text-[13px] text-text">{label}</span>
        <span className="flex-1" />

        {isCustom && !isListening && (
          <button
            onClick={() => resetShortcut(key)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-border hover:text-text"
            title="Reset to default"
            aria-label={`Reset ${label} shortcut to default`}
          >
            <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}

        <div
          ref={isListening ? inputRef : undefined}
          tabIndex={0}
          onClick={() => startListening(key)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startListening(key); } }}
          onBlur={() => { if (isListening) cancelListening(); }}
          role="button"
          aria-label={`Change ${label} shortcut`}
          className={`flex h-[34px] w-60 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-1.5 transition-colors ${
            isListening
              ? 'border-text bg-surface-hover pl-2'
              : 'justify-center border-border bg-surface-sunken hover:border-border-strong'
          }`}
        >
          {isListening ? (
            <>
              {error ? (
                <span className="truncate text-xs text-accent-strong" role="alert">{error}</span>
              ) : pendingKeys ? (
                <>
                  <KeyCaps combo={pendingKeys} />
                  <span className="font-mono text-xs text-text-muted">+</span>
                </>
              ) : (
                <span className="text-xs text-text-dim">{LISTENING_PLACEHOLDERS[key]}</span>
              )}
              <span aria-hidden="true" className="h-3.5 w-[1.5px] animate-pulse bg-text" />
              {key !== 'cancelRecording' && (
                <span className="ml-auto pr-1 text-[11px] text-text-dim">Esc cancels</span>
              )}
            </>
          ) : (
            <KeyCaps combo={shortcuts[key]} />
          )}
        </div>
      </div>
    );
  };

  if (!settingsLoaded) return null;

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex max-w-[860px] flex-col gap-6">

        <section className="flex flex-col gap-2.5">
          <h2 className={SECTION_HEADING}>Recording</h2>
          <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface px-[18px] py-4">
            <FieldRow label="Mode">
              <Segmented ariaLabel="Recording mode" value={hotkeyMode} onChange={saveHotkeyMode} options={MODE_OPTIONS} />
            </FieldRow>
            <FieldRow label="Call mode">
              <Switch checked={callMode} onChange={() => saveCallMode(!callMode)} ariaLabel="Call mode" />
              <span className="text-xs text-text-dim">Filters out voices from calls (Slack, Teams, Zoom)</span>
            </FieldRow>
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className={SECTION_HEADING}>Shortcuts</h2>
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
            {[...MODE_SHORTCUTS[hotkeyMode], 'showWindow' as const].map(renderShortcutRow)}
          </div>
        </section>

      </div>
    </main>
  );
}
