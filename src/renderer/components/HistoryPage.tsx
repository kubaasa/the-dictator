import { useState, useEffect, useRef, useCallback } from 'react';
import type { RecordingEntry } from '../../shared/types';

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDuration(seconds: number): string {
  const totalSecs = Math.round(seconds);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getDateGroupLabel(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000);

  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays === 2) return '2 DAYS AGO';

  // Same calendar week (Mon–Sun)
  const dayOfWeek = todayStart.getDay(); // 0=Sun
  const startOfWeek = new Date(todayStart);
  startOfWeek.setDate(todayStart.getDate() - ((dayOfWeek + 6) % 7));
  if (dateStart >= startOfWeek) return 'EARLIER THIS WEEK';

  // Same calendar month
  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
    return 'EARLIER THIS MONTH';
  }

  // Older — show full date
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function groupByDate(entries: RecordingEntry[]): { label: string; entries: RecordingEntry[] }[] {
  const groups: Map<string, RecordingEntry[]> = new Map();
  for (const entry of entries) {
    const label = getDateGroupLabel(entry.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

function buildAudioUrl(audioPath: string): string {
  return 'recording:///' + audioPath.replace(/\\/g, '/');
}

interface RecordingItemProps {
  entry: RecordingEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
}

function RecordingItem({ entry, isExpanded, onToggle, onDelete }: RecordingItemProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this recording?')) {
      onDelete(entry.id);
    }
  };

  const preview = entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text;

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      {/* Collapsed row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors cursor-pointer"
      >
        <span className="text-xs text-zinc-500 shrink-0 w-10">{formatTime(entry.date)}</span>
        <span className="text-xs text-zinc-600 shrink-0 w-10">{formatDuration(entry.durationSeconds)}</span>
        <span className="text-sm text-zinc-300 truncate flex-1">{preview}</span>
      </button>

      {/* Expanded accordion body — grid trick for smooth height animation */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
        <div className="mx-4 mb-3 rounded-lg border border-zinc-700 bg-zinc-900/60 overflow-hidden">
          {/* Audio player */}
          {entry.audioPath && (
            <div className="p-3 border-b border-zinc-700">
              <audio
                controls
                src={buildAudioUrl(entry.audioPath)}
                className="w-full h-8"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          )}

          {/* Transcription text */}
          <div className="p-3 border-b border-zinc-700">
            <p className="text-sm text-zinc-200 leading-relaxed max-h-48 overflow-y-auto select-text whitespace-pre-wrap">
              {entry.text}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center px-3 py-2 border-b border-zinc-700">
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-zinc-400 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="h-3.5 w-3.5 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className="text-green-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-zinc-400 border border-zinc-700 hover:border-red-800 hover:text-red-400 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
                Delete
              </button>
            </div>
          </div>

        </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryPage() {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchQueryRef = useRef('');

  const loadAll = useCallback(async () => {
    try {
      // Migrate localStorage data to SQLite once
      const raw = localStorage.getItem('dictator_recordings');
      const migrated = localStorage.getItem('dictator_history_migrated');
      if (raw && migrated !== 'true') {
        try {
          const entries: RecordingEntry[] = JSON.parse(raw);
          if (Array.isArray(entries) && entries.length > 0) {
            await window.dictator.history.migrate(entries);
            localStorage.setItem('dictator_history_migrated', 'true');
          }
        } catch {
          // Migration failed non-critically — still load from SQLite
        }
      }
      const all = await window.dictator.history.getAll();
      setRecordings(all);
      setLoadError('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[HistoryPage] Failed to load recordings:', msg);
      setLoadError(msg);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Reload list when a new transcription arrives (so new recording appears without nav away)
  useEffect(() => {
    const unsub = window.dictator.onTranscriptionResult(() => {
      // Only reload if not in the middle of a search
      if (!searchQueryRef.current.trim()) {
        loadAll();
      }
    });
    return unsub;
  }, [loadAll]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    searchQueryRef.current = q;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        if (q.trim()) {
          const results = await window.dictator.history.search(q.trim());
          setRecordings(results);
        } else {
          await loadAll();
        }
      } catch (err) {
        console.error('[HistoryPage] Search failed:', err);
      }
    }, 300);
  }, [loadAll]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await window.dictator.history.delete(id);
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setExpandedId((prev) => (prev === id ? null : prev));
  }, []);

  const groups = groupByDate(recordings);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none"
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search recordings..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-9 pr-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
      </div>

      {/* Recording list */}
      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            {loadError ? (
              <>
                <svg className="h-8 w-8 text-red-800" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-red-600">Failed to load recordings</p>
                <button onClick={loadAll} className="text-xs text-zinc-500 hover:text-zinc-300 underline">Retry</button>
              </>
            ) : (
              <>
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <p className="text-sm">{searchQuery ? 'No recordings found' : 'No recordings yet'}</p>
              </>
            )}
          </div>
        ) : (
          groups.map(({ label, entries }) => (
            <div key={label}>
              <div className="px-4 py-2 sticky top-0 bg-zinc-950 z-10">
                <span className="text-xs font-semibold tracking-wider text-zinc-600">{label}</span>
                <div className="mt-1 border-b border-zinc-800" />
              </div>
              {entries.map((entry) => (
                <RecordingItem
                  key={entry.id}
                  entry={entry}
                  isExpanded={expandedId === entry.id}
                  onToggle={() => handleToggle(entry.id)}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
