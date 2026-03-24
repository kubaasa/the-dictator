import { useState, useEffect, useCallback } from 'react';
import type { VocabularyEntry } from '../../shared/types';

export function VocabularyPage() {
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [newInput, setNewInput] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const [editReplacement, setEditReplacement] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      setEntries(s.vocabulary ?? []);
    });
    const unsub = window.dictator.onSettingsChange((s) => {
      if (s.vocabulary) setEntries(s.vocabulary);
    });
    return unsub;
  }, []);

  const save = useCallback(async (updated: VocabularyEntry[]) => {
    await window.dictator.setSettings({ vocabulary: updated });
    setEntries(updated);
  }, []);

  const addEntry = useCallback(async () => {
    const trimmed = newInput.trim();
    if (!trimmed) {
      setError('Word or sentence cannot be empty');
      return;
    }
    if (entries.some((e) => e.input.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in your vocabulary`);
      return;
    }
    const entry: VocabularyEntry = {
      id: crypto.randomUUID(),
      input: trimmed,
      ...(newReplacement.trim() && { replacement: newReplacement.trim() }),
    };
    await save([...entries, entry]);
    setNewInput('');
    setNewReplacement('');
    setError('');
  }, [newInput, newReplacement, entries, save]);

  const deleteEntry = useCallback(async (id: string) => {
    await save(entries.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
  }, [entries, editingId, save]);

  const startEdit = useCallback((entry: VocabularyEntry) => {
    setEditingId(entry.id);
    setEditInput(entry.input);
    setEditReplacement(entry.replacement ?? '');
    setError('');
  }, []);

  const saveEdit = useCallback(async () => {
    const trimmed = editInput.trim();
    if (!trimmed) {
      setError('Word or sentence cannot be empty');
      return;
    }
    if (entries.some((e) => e.id !== editingId && e.input.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in your vocabulary`);
      return;
    }
    const updated = entries.map((e) =>
      e.id === editingId
        ? { ...e, input: trimmed, replacement: editReplacement.trim() || undefined }
        : e,
    );
    await save(updated);
    setEditingId(null);
    setError('');
  }, [editInput, editReplacement, editingId, entries, save]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setError('');
  }, []);

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-8">
      <section>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-1">Vocabulary</h2>
        <p className="text-sm text-neutral-500 mb-4">
          This helps The Dictator recognize people&apos;s names, company names, acronyms, slang, or words from other languages.
        </p>
        <div className="text-xs text-neutral-600 mb-6">
          <span className="block text-neutral-500 font-medium mb-2">Examples:</span>
          <div className="grid grid-cols-4 gap-x-6 gap-y-1">
            <span><span className="text-neutral-400">&quot;cloud md&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;CLAUDE.md&quot;</span></span>
            <span><span className="text-neutral-400">&quot;K8s&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;Kubernetes&quot;</span></span>
            <span><span className="text-neutral-400">&quot;Next JS&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;Next.js&quot;</span></span>
            <span><span className="text-neutral-400">&quot;Browar&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;Dzbanek&quot;</span></span>
            <span><span className="text-neutral-400">&quot;readme md&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;README.md&quot;</span></span>
            <span><span className="text-neutral-400">&quot;en 8 en&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;n8n&quot;</span></span>
            <span><span className="text-neutral-400">&quot;CI CD&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;CI/CD&quot;</span></span>
            <span><span className="text-neutral-400">&quot;JIRA&quot;</span> <span className="text-neutral-600">&rarr;</span> <span className="text-red-400/70">&quot;Jira&quot;</span></span>
          </div>
        </div>

        {/* Add new entry form */}
        <div className="rounded-lg border border-neutral-800 bg-[#141414] px-5 py-4 mb-6">
          <span className="block font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-3">Input</span>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newInput}
              onChange={(e) => { setNewInput(e.target.value); setError(''); }}
              onKeyDown={handleAddKeyDown}
              placeholder="New word or sentence"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 outline-none transition-colors focus:border-red-600"
            />
            <input
              type="text"
              value={newReplacement}
              onChange={(e) => setNewReplacement(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder="Replace with..."
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 outline-none transition-colors focus:border-red-600"
            />
            <button
              onClick={addEntry}
              className="whitespace-nowrap rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 active:bg-red-800"
            >
              Add to vocabulary
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400 mb-4">{error}</p>
        )}

        {/* Entry list */}
        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-neutral-800 bg-[#141414] px-5 py-3"
              >
                {editingId === entry.id ? (
                  /* Inline edit mode */
                  <div className="flex flex-1 items-center gap-3">
                    <input
                      type="text"
                      value={editInput}
                      onChange={(e) => { setEditInput(e.target.value); setError(''); }}
                      onKeyDown={handleEditKeyDown}
                      autoFocus
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 outline-none transition-colors focus:border-red-600"
                    />
                    <span className="text-neutral-600 text-xs">&rarr;</span>
                    <input
                      type="text"
                      value={editReplacement}
                      onChange={(e) => setEditReplacement(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      placeholder="Replace with..."
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 outline-none transition-colors focus:border-red-600"
                    />
                    <button
                      onClick={saveEdit}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* Display mode */
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-neutral-200">{entry.input}</span>
                      {entry.replacement && (
                        <>
                          <span className="text-neutral-600">&rarr;</span>
                          <span className="font-mono text-red-400">{entry.replacement}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(entry)}
                        title="Edit"
                        className="rounded p-1 text-neutral-600 transition-colors hover:text-neutral-300"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        title="Delete"
                        className="rounded p-1 text-neutral-600 transition-colors hover:text-red-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {entries.length === 0 && (
          <p className="text-center text-sm text-neutral-600 py-8">
            No vocabulary entries yet. Add words above to improve transcription accuracy.
          </p>
        )}
      </section>
    </main>
  );
}
