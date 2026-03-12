import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types';

type ShortcutKey = 'toggleRecording' | 'cancelRecording' | 'modeSelect';

interface ShortcutConfig {
  key: ShortcutKey;
  label: string;
  description: string;
}

const SHORTCUT_CONFIGS: ShortcutConfig[] = [
  { key: 'toggleRecording', label: 'Toggle Recording', description: 'Start or stop voice recording' },
  { key: 'cancelRecording', label: 'Cancel Recording', description: 'Discard current recording without transcription' },
  { key: 'modeSelect', label: 'Cycle Mode', description: 'Switch to next dictation mode' },
];

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

// Maps e.code (physical key) → readable name that matches KEY_MAP in hotkey.service.ts
function physicalKeyName(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3);        // KeyA → A
  if (code.startsWith('Digit')) return code.slice(5);      // Digit1 → 1
  if (/^F\d{1,2}$/.test(code)) return code;               // F1-F12

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

function formatKeyCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (parts.length === 0) return null; // require at least one modifier

  const keyName = physicalKeyName(e.code);
  if (!keyName) return null;

  parts.push(keyName);
  return parts.join('+');
}

export function ShortcutsPage() {
  const [shortcuts, setShortcuts] = useState(DEFAULT_SETTINGS.hotkey.shortcuts);
  const [listeningFor, setListeningFor] = useState<ShortcutKey | null>(null);
  const [pendingKeys, setPendingKeys] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dictator.getSettings().then((s: AppSettings) => {
      // Migration safety: old store may have hotkey.shortcut instead of hotkey.shortcuts
      const stored = s.hotkey?.shortcuts ?? DEFAULT_SETTINGS.hotkey.shortcuts;
      setShortcuts(stored);
    });
  }, []);

  const saveShortcuts = useCallback(async (newShortcuts: typeof shortcuts) => {
    const settings = await window.dictator.getSettings();
    await window.dictator.setSettings({
      hotkey: { ...settings.hotkey, shortcuts: newShortcuts },
    });
    setShortcuts(newShortcuts);
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

      if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        cancelListening();
        return;
      }

      // Show current modifier state
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');

      const combo = formatKeyCombo(e);
      if (combo) {
        // Check for duplicates
        const otherShortcuts = Object.entries(shortcuts)
          .filter(([k]) => k !== listeningFor)
          .map(([, v]) => v);

        if (otherShortcuts.includes(combo)) {
          setError(`"${combo}" is already used by another shortcut`);
          return;
        }

        const newShortcuts = { ...shortcuts, [listeningFor]: combo };
        saveShortcuts(newShortcuts);
        setListeningFor(null);
        setPendingKeys('');
        setError('');
      } else {
        setPendingKeys(parts.length > 0 ? parts.join('+') + '+...' : '');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listeningFor, shortcuts, saveShortcuts, cancelListening]);

  // Focus trap for listening mode
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

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Keyboard Shortcuts</h2>

        <div className="space-y-3">
          {SHORTCUT_CONFIGS.map((config) => {
            const isListening = listeningFor === config.key;
            const isDefault = shortcuts[config.key] === DEFAULT_SETTINGS.hotkey.shortcuts[config.key];

            return (
              <div
                key={config.key}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-200">{config.label}</span>
                  <span className="text-xs text-zinc-500">{config.description}</span>
                </div>

                <div className="flex items-center gap-2">
                  {!isDefault && (
                    <button
                      onClick={() => resetShortcut(config.key)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Reset to default"
                    >
                      Reset
                    </button>
                  )}

                  <div
                    ref={isListening ? inputRef : undefined}
                    tabIndex={0}
                    onClick={() => startListening(config.key)}
                    className={`min-w-[180px] cursor-pointer rounded-md border px-3 py-1.5 text-center text-sm font-mono transition-colors ${
                      isListening
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    {isListening
                      ? (pendingKeys || 'Press keys...')
                      : shortcuts[config.key]
                    }
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        )}

        <p className="mt-4 text-xs text-zinc-600">
          Click a shortcut field, then press your desired key combination (modifier + key). Press Escape to cancel.
        </p>
      </section>
    </main>
  );
}
