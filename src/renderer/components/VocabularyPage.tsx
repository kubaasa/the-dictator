import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import type { VocabularyEntry } from '../../shared/types';
import { useToast } from './Toast';
import { ConfirmDeleteButton } from './ui/ConfirmDeleteButton';
import { SectionHeading } from './ui/SectionHeading';

type Field = 'input' | 'replacement';

interface CellEdit {
  id: string;
  field: Field;
  value: string;
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1.3fr)_44px] items-center';
const CELL_INPUT = 'h-[30px] w-full rounded-md border border-text bg-surface-hover px-2 text-[13px] text-text placeholder-text-dim outline-none';

function SyntaxText({ text }: { text: string }) {
  return (
    <>
      {text.split(/([|*])/).map((part, i) =>
        part === '|' || part === '*' ? <span key={i} className="text-text-dim">{part}</span> : part,
      )}
    </>
  );
}

function hasDuplicateInput(entries: VocabularyEntry[], input: string, exceptId?: string): boolean {
  const needle = input.toLowerCase();
  return entries.some((e) => e.id !== exceptId && e.input.toLowerCase() === needle);
}

export function VocabularyPage() {
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [adding, setAdding] = useState(false);
  const [newInput, setNewInput] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { addToast } = useToast();
  const editRef = useRef<CellEdit | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      const list = s.vocabulary ?? [];
      setEntries(list);
      if (list.length === 0) setAdding(true);
      setLoaded(true);
    }).catch((err) => {
      log.error('Failed to load vocabulary:', err);
      setLoaded(true);
    });
    const unsub = window.dictator.onSettingsChange((s) => {
      if (s.vocabulary) setEntries(s.vocabulary);
    });
    return unsub;
  }, []);

  const save = useCallback(async (updated: VocabularyEntry[]): Promise<boolean> => {
    setIsSaving(true);
    try {
      await window.dictator.setSettings({ vocabulary: updated });
      setEntries(updated);
      return true;
    } catch (err) {
      log.error('Failed to save vocabulary:', err);
      addToast('error', 'Failed to save. Please try again.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const startEdit = (entry: VocabularyEntry, field: Field) => {
    const next = { id: entry.id, field, value: field === 'input' ? entry.input : entry.replacement ?? '' };
    editRef.current = next;
    setEdit(next);
  };

  const cancelEdit = () => {
    editRef.current = null;
    setEdit(null);
  };

  const updateEdit = (value: string) => {
    if (!editRef.current) return;
    const next = { ...editRef.current, value };
    editRef.current = next;
    setEdit(next);
  };

  const commitEdit = async () => {
    const current = editRef.current;
    if (!current) return;
    cancelEdit();

    const entry = entries.find((e) => e.id === current.id);
    if (!entry) return;
    const value = current.value.trim();
    const previous = current.field === 'input' ? entry.input : entry.replacement ?? '';
    if (value === previous) return;

    if (!value) {
      addToast('error', 'Both fields are required');
      return;
    }
    if (current.field === 'input' && hasDuplicateInput(entries, value, entry.id)) {
      addToast('error', `"${value}" is already in your vocabulary`);
      return;
    }
    const ok = await save(entries.map((e) => (e.id === entry.id ? { ...e, [current.field]: value } : e)));
    if (!ok) {
      editRef.current = current;
      setEdit(current);
    }
  };

  const addEntry = async () => {
    const input = newInput.trim();
    const replacement = newReplacement.trim();
    if (!input || !replacement) {
      addToast('error', 'Both fields are required');
      return;
    }
    if (hasDuplicateInput(entries, input)) {
      addToast('error', `"${input}" is already in your vocabulary`);
      return;
    }
    const ok = await save([...entries, { id: crypto.randomUUID(), input, replacement }]);
    if (ok) {
      setNewInput('');
      setNewReplacement('');
      newInputRef.current?.focus();
    }
  };

  const closeAdd = () => {
    setAdding(false);
    setNewInput('');
    setNewReplacement('');
  };

  const deleteEntry = async (id: string) => {
    if (editRef.current?.id === id) cancelEdit();
    await save(entries.filter((e) => e.id !== id));
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAdd();
    }
  };

  const renderCell = (entry: VocabularyEntry, field: Field) => {
    if (edit?.id === entry.id && edit.field === field) {
      return (
        <input
          type="text"
          value={edit.value}
          onChange={(e) => updateEdit(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={commitEdit}
          autoFocus
          maxLength={200}
          aria-label={field === 'input' ? 'Whisper writes' : 'Replace with'}
          className={CELL_INPUT}
        />
      );
    }

    const value = field === 'input' ? entry.input : entry.replacement;
    const empty = value == null ? '(inactive)' : value === '' ? '(removes match)' : null;
    return (
      <button
        type="button"
        onClick={() => startEdit(entry, field)}
        disabled={isSaving}
        title="Click to edit"
        className={`min-w-0 cursor-text truncate rounded-md px-2 text-left text-[13px] leading-[30px] transition-colors hover:bg-border/60 ${
          empty ? 'italic text-text-dim' : field === 'input' ? 'text-text' : 'font-medium text-text'
        }`}
      >
        {empty ?? <SyntaxText text={value as string} />}
      </button>
    );
  };

  if (!loaded) return null;

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex max-w-[860px] flex-col gap-2.5">
        <SectionHeading title="Vocabulary" meta={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`} />

        <div className="rounded-xl border border-border bg-surface">
          <div className={`${GRID} h-9 border-b border-border pl-4 pr-1.5`}>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Whisper writes</span>
            <span />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Replace with</span>
            <span />
          </div>

          <div className="divide-y divide-border/60">
            {entries.map((entry) => (
              <div key={entry.id} className={`group ${GRID} min-h-10 pl-2 pr-1.5 ${edit?.id === entry.id ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}>
                {renderCell(entry, 'input')}
                <span className="text-center text-[13px] text-text-dim" aria-hidden="true">→</span>
                {renderCell(entry, 'replacement')}
                <div className="flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <ConfirmDeleteButton onConfirm={() => deleteEntry(entry.id)} label="entry" size="sm" disabled={isSaving} />
                </div>
              </div>
            ))}
          </div>

          {adding ? (
            <div className={`${GRID} h-[42px] border-t border-border bg-surface-hover pl-2 pr-1.5`}>
              <input
                ref={newInputRef}
                type="text"
                value={newInput}
                onChange={(e) => setNewInput(e.target.value)}
                onKeyDown={handleAddKeyDown}
                autoFocus
                maxLength={200}
                placeholder="komit*"
                aria-label="Whisper writes"
                className={CELL_INPUT}
              />
              <span className="text-center text-[13px] text-text-dim" aria-hidden="true">→</span>
              <input
                type="text"
                value={newReplacement}
                onChange={(e) => setNewReplacement(e.target.value)}
                onKeyDown={handleAddKeyDown}
                maxLength={200}
                placeholder="commit*"
                aria-label="Replace with"
                className={CELL_INPUT}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addEntry}
                  disabled={isSaving}
                  aria-label="Add entry"
                  title="Add entry (Enter)"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-surface-hover text-text transition-colors hover:border-text-dim disabled:cursor-wait disabled:opacity-50"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-[42px] w-full items-center gap-2 border-t border-border px-4 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <span className="text-base leading-none" aria-hidden="true">+</span>
              Add entry
            </button>
          )}

          <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 border-t border-border px-4 py-3 text-xs text-text-dim">
            <span className="flex items-center gap-[7px]"><code className="rounded border border-border bg-surface-hover px-1.5 py-px font-mono text-[11px] text-text">a | b</code>any of these</span>
            <span className="flex items-center gap-[7px]"><code className="rounded border border-border bg-surface-hover px-1.5 py-px font-mono text-[11px] text-text">word*</code>any ending</span>
            <span>Spaces also match hyphens</span>
          </div>
        </div>
      </div>
    </main>
  );
}
