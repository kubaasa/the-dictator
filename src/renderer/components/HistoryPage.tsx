import { useState, useEffect, useRef, useCallback } from 'react';
import log from 'electron-log/renderer';
import { ViewfinderCorners } from './RecEffects';
import { CopyButton } from './CopyButton';
import { ConfirmDeleteButton } from './ui/ConfirmDeleteButton';
import { SectionHeading } from './ui/SectionHeading';
import type { RecordingEntry } from '../../shared/types';

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDuration(seconds: number): string {
  const totalSecs = Math.round(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function pluralizeRecordings(count: number): string {
  return `${count} recording${count !== 1 ? 's' : ''}`;
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

  const dayOfWeek = todayStart.getDay();
  const startOfWeek = new Date(todayStart);
  startOfWeek.setDate(todayStart.getDate() - ((dayOfWeek + 6) % 7));
  if (dateStart >= startOfWeek) return 'EARLIER THIS WEEK';

  if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
    return 'EARLIER THIS MONTH';
  }

  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function groupByDate(entries: RecordingEntry[]): { label: string; entries: RecordingEntry[] }[] {
  const groups: Map<string, RecordingEntry[]> = new Map();
  for (const entry of entries) {
    const label = getDateGroupLabel(entry.date);
    const group = groups.get(label) ?? [];
    if (!groups.has(label)) groups.set(label, group);
    group.push(entry);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

const normalizeWord = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function RawText({ raw, text }: { raw: string; text: string }) {
  const finalWords = new Set(text.split(/\s+/).map(normalizeWord));
  return (
    <>
      {raw.split(/(\s+)/).map((token, i) => {
        const word = normalizeWord(token);
        return word && !finalWords.has(word)
          ? <span key={i} className="rounded-[3px] bg-text/[0.07] px-0.5 text-text-dim">{token}</span>
          : token;
      })}
    </>
  );
}

interface RecordingItemProps {
  entry: RecordingEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
  deleteError: string | null;
  isDeleting: boolean;
}

function RecordingItem({ entry, isExpanded, onToggle, onDelete, deleteError, isDeleting }: RecordingItemProps) {
  const hasRaw = !!entry.rawText && entry.rawText !== entry.text;
  const rawWords = entry.rawWordCount || entry.wordCount;
  const wpm = entry.durationSeconds >= 1 ? Math.round(rawWords / (entry.durationSeconds / 60)) : null;

  return (
    <div className={`relative ${isExpanded ? 'bg-surface-hover' : ''}`}>
      {isExpanded && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-text" />}

      <div className="group relative">
        <button
          onClick={onToggle}
          aria-expanded={isExpanded}
          className={`flex h-11 w-full items-center gap-3.5 pl-4 pr-12 text-left transition-colors ${
            isExpanded ? '' : 'group-hover:bg-surface-hover'
          }`}
        >
          <span className="w-10 shrink-0 font-mono text-xs text-text-muted">{formatTime(entry.date)}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text">{isExpanded ? '' : entry.text}</span>
          {entry.appName && (
            <span className="max-w-[130px] shrink-0 truncate text-xs text-text-dim">{entry.appName}</span>
          )}
          <span className="w-9 shrink-0 text-right font-mono text-xs text-text-dim">{formatDuration(entry.durationSeconds)}</span>
        </button>

        {!isExpanded && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <CopyButton text={entry.text} stopPropagation iconOnly />
          </div>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden" inert={!isExpanded}>
          <div className="flex flex-col gap-3 pb-3.5 pl-[70px] pr-4">
            <p className="max-h-48 select-text overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text">
              {entry.text}
            </p>

            {hasRaw && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                  Whisper raw
                </span>
                <p className="max-h-32 select-text overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
                  <RawText raw={entry.rawText ?? ''} text={entry.text} />
                </p>
              </div>
            )}

            {deleteError && (
              <p className="text-xs text-accent-strong" role="alert">{deleteError}</p>
            )}

            <div className="flex items-center gap-2 border-t border-border pt-3">
              <CopyButton text={entry.text} />
              {hasRaw && <CopyButton text={entry.rawText ?? ''} label="Copy raw" variant="ghost" />}
              <span className="ml-auto font-mono text-[11px] text-text-dim">
                {entry.wordCount} words{wpm !== null && ` · ${wpm} wpm`}
              </span>
              <ConfirmDeleteButton
                key={isExpanded ? 'open' : 'closed'}
                onConfirm={() => onDelete(entry.id)}
                label="recording"
                size="sm"
                disabled={isDeleting}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const LOAD_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;

const SECONDARY_BUTTON = 'flex h-8 items-center rounded-md border border-border-strong bg-surface-hover px-4 text-xs font-medium text-text transition-colors hover:border-text-dim disabled:cursor-wait disabled:opacity-50';

export function HistoryPage() {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; msg: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchQueryRef = useRef('');
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadTimedOut(false);

      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);

      const raw = localStorage.getItem('dictator_recordings');
      const migrated = localStorage.getItem('dictator_history_migrated');
      if (raw && migrated !== 'true') {
        try {
          const entries: RecordingEntry[] = JSON.parse(raw);
          if (Array.isArray(entries) && entries.length > 0) {
            const result = await window.dictator.history.migrate(entries);
            if (result.success) {
              localStorage.setItem('dictator_history_migrated', 'true');
            }
          }
        } catch {
          // Migration failed non-critically
        }
      }

      const result = await window.dictator.history.getAll(PAGE_SIZE, 0);
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);

      if (result.success) {
        setRecordings(result.data);
        setHasMore(result.data.length >= PAGE_SIZE);
        setLoadError('');
      } else {
        setLoadError(result.error ?? 'Unknown error');
      }

      try {
        const countResult = await window.dictator.history.getCount();
        if (countResult.success) setTotalCount(countResult.count);
      } catch (err) {
        log.warn('[HistoryPage] Failed to fetch total count:', err);
      }

    } catch (err) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      const msg = err instanceof Error ? err.message : String(err);
      log.error('[HistoryPage] Failed to load recordings:', msg);
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const result = await window.dictator.history.getAll(PAGE_SIZE, recordings.length);
      if (result.success) {
        setRecordings((prev) => [...prev, ...result.data]);
        setHasMore(result.data.length >= PAGE_SIZE);
      }
    } catch (err) {
      log.error('[HistoryPage] Failed to load more recordings:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, recordings.length]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const unsub = window.dictator.onTranscriptionResult(() => {
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
      // Stale check — if user changed query since we scheduled, skip
      if (searchQueryRef.current !== q) return;
      try {
        if (q.trim()) {
          const result = await window.dictator.history.search(q.trim());
          if (searchQueryRef.current !== q) return;
          if (result.success) {
            setRecordings(result.data);
          }
        } else {
          await loadAll();
        }
      } catch (err) {
        log.error('[HistoryPage] Search failed:', err);
      }
    }, 300);
  }, [loadAll]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const result = await window.dictator.history.delete(id);
      if (result.success) {
        setRecordings((prev) => prev.filter((r) => r.id !== id));
        setTotalCount((prev) => (prev !== null ? prev - 1 : prev));
        setExpandedId((prev) => (prev === id ? null : prev));
        if (result.audioError) {
          log.warn('[HistoryPage] Audio cleanup warning:', result.audioError);
        }
      } else {
        setDeleteError({ id, msg: result.error ?? 'Failed to delete recording' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeleteError({ id, msg });
    } finally {
      setDeletingId(null);
    }
  }, []);

  const groups = groupByDate(recordings);

  const displayCount = searchQuery.trim() ? recordings.length : (totalCount ?? recordings.length);

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-6">

        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim"
            fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search recordings"
            aria-label="Search recordings"
            className="h-10 w-full rounded-[10px] border border-border bg-surface pl-10 pr-36 text-[13px] text-text placeholder-text-dim transition-colors focus:border-border-strong focus:outline-none"
          />
          {!isLoading && (
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-text-dim">
              {pluralizeRecordings(displayCount)}
            </span>
          )}
        </div>

        {isLoading ? (
          <section className="flex flex-col gap-2.5">
            <SectionHeading title="Loading" />
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="relative">
                <ViewfinderCorners />
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-dim">
                  {loadTimedOut ? (
                    <>
                      <svg className="h-8 w-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-accent-strong">Loading is taking too long</p>
                      <button onClick={() => loadAll()} className={SECONDARY_BUTTON}>Retry</button>
                    </>
                  ) : (
                    <>
                      <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                      </svg>
                      <p className="font-mono text-sm">LOADING...</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : recordings.length === 0 ? (
          <section className="flex flex-col gap-2.5">
            <SectionHeading title={loadError ? 'Error' : searchQuery ? 'Search Results' : 'Archive'} />
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="relative">
                <ViewfinderCorners />
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-dim">
                  {loadError ? (
                    <>
                      <svg className="h-8 w-8 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-accent-strong">Failed to load recordings</p>
                      <p className="max-w-xs text-center text-sm text-text-muted">{loadError}</p>
                      <button onClick={() => loadAll()} className={SECONDARY_BUTTON}>Retry</button>
                    </>
                  ) : searchQuery ? (
                    <>
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                      </svg>
                      <p className="font-mono text-sm text-text-muted">NO FOOTAGE FOUND</p>
                      <p className="text-sm">Try a different search term</p>
                    </>
                  ) : (
                    <>
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                      </svg>
                      <p className="font-mono text-sm text-text-muted">NO FOOTAGE RECORDED</p>
                      <p className="text-sm">Start recording to see history here</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            {groups.map(({ label, entries }) => {
              const totalSeconds = entries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
              return (
                <section key={label} className="flex flex-col gap-2.5">
                  <SectionHeading title={label} meta={`${pluralizeRecordings(entries.length)} · ${formatDuration(totalSeconds)}`} />
                  <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-surface">
                    {entries.map((entry) => (
                      <RecordingItem
                        key={entry.id}
                        entry={entry}
                        isExpanded={expandedId === entry.id}
                        onToggle={() => handleToggle(entry.id)}
                        onDelete={handleDelete}
                        deleteError={deleteError?.id === entry.id ? deleteError.msg : null}
                        isDeleting={deletingId === entry.id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {hasMore && !searchQuery && (
              <div className="flex justify-center pb-2">
                <button onClick={loadMore} disabled={isLoadingMore} className={SECONDARY_BUTTON}>
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}
