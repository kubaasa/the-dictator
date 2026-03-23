import { useState, useEffect, useRef, useCallback } from 'react';
import { ViewfinderCorners } from './RecEffects';
import { useToast } from './Toast';
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

const MODE_LABELS: Record<string, string> = {
  voice: 'VOICE',
  email: 'EMAIL',
  chat: 'CHAT',
  note: 'NOTE',
  custom: 'CUSTOM',
};

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
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({ label, entries }));
}

function buildAudioUrl(audioPath: string): string {
  if (!audioPath) return '';
  return 'recording:///' + audioPath.replace(/\\/g, '/');
}

function formatAudioTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface RecordingItemProps {
  entry: RecordingEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
  deleteError: string | null;
  isDeleting: boolean;
  isLast: boolean;
}

function RecordingItem({ entry, isExpanded, onToggle, onDelete, deleteError, isDeleting, isLast }: RecordingItemProps) {
  const { addToast } = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Custom audio player state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioCurrent, setAudioCurrent] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  // Pause audio when collapsing
  useEffect(() => {
    if (!isExpanded && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [isExpanded]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audioRef.current.currentTime = pct * audioDuration;
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.text);
    addToast('success', 'Copied to clipboard');
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDelete(true);
  };

  const handleDeleteConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDelete(false);
    onDelete(entry.id);
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDelete(false);
  };

  const preview = entry.text.length > 80 ? entry.text.slice(0, 80) + '\u2026' : entry.text;
  const modeBadge = entry.mode ? MODE_LABELS[entry.mode] ?? entry.mode.toUpperCase() : null;

  return (
    <div className={`${!isLast ? 'border-b border-neutral-800/50' : ''}`}>
      {/* Collapsed row */}
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors cursor-pointer ${
          isExpanded ? 'bg-red-600/5' : 'hover:bg-[#1A1A1A]'
        }`}
      >
        {/* Status dot */}
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isExpanded ? 'bg-red-500' : 'bg-neutral-700'}`} />

        <span className="font-mono text-sm text-neutral-400 shrink-0 w-12">{formatTime(entry.date)}</span>
        <span className="font-mono text-sm text-neutral-600 shrink-0 w-12">{formatDuration(entry.durationSeconds)}</span>
        {modeBadge && (
          <span className="font-mono text-xs font-bold tracking-wider text-neutral-500 border border-neutral-700 rounded-full px-1.5 py-0.5 shrink-0">
            {modeBadge}
          </span>
        )}
        <span className="text-sm text-neutral-300 truncate flex-1">{preview}</span>
        {/* Chevron */}
        <svg
          className={`h-4 w-4 text-neutral-600 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded accordion body */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
        <div className="bg-[#0f0f0f]/60 pb-1">
          {/* Custom audio player */}
          {entry.audioPath && (
            <div className="px-5 py-3">
              <audio
                ref={audioRef}
                preload="metadata"
                src={buildAudioUrl(entry.audioPath)}
                onLoadedMetadata={() => {
                  if (audioRef.current) setAudioDuration(audioRef.current.duration);
                }}
                onTimeUpdate={() => {
                  if (audioRef.current && audioDuration > 0) {
                    setAudioCurrent(audioRef.current.currentTime);
                    setAudioProgress((audioRef.current.currentTime / audioDuration) * 100);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  setIsPlaying(false);
                  setAudioProgress(0);
                  setAudioCurrent(0);
                }}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                {/* Play/Pause button */}
                <button
                  onClick={togglePlay}
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 hover:border-red-600/50 transition-colors cursor-pointer"
                >
                  {isPlaying ? (
                    <svg className="h-3.5 w-3.5 text-neutral-300" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5 text-neutral-300 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {/* Progress bar */}
                <div
                  className="flex-1 h-1 rounded-full bg-neutral-800 cursor-pointer relative"
                  onClick={handleProgressClick}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-red-600/60"
                    style={{ width: `${audioProgress}%` }}
                  />
                </div>

                {/* Time display */}
                <span className="font-mono text-sm text-neutral-600 shrink-0">
                  {formatAudioTime(audioCurrent)} / {formatAudioTime(audioDuration || entry.durationSeconds)}
                </span>
              </div>
            </div>
          )}

          {/* Transcription text */}
          <div className="mx-5 border-t border-neutral-800/30 py-3">
            <p className="text-sm text-neutral-200 leading-relaxed max-h-48 overflow-y-auto select-text whitespace-pre-wrap">
              {entry.text}
            </p>
          </div>

          {/* Delete error */}
          {deleteError && (
            <div className="mx-5 px-0 py-1.5 text-sm text-red-400" role="alert">
              {deleteError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mx-5 border-t border-neutral-800/30 py-2">
            {confirmingDelete ? (
              <div className="flex items-center gap-2 w-full justify-center">
                <span className="font-mono text-sm text-neutral-400">Delete this recording?</span>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={isDeleting}
                  className="rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider text-red-400 border border-red-800 hover:bg-red-950/50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  {isDeleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                  className="rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider text-neutral-400 border border-neutral-700 hover:border-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider text-neutral-400 border border-neutral-700 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                  </svg>
                  Copy
                </button>
                <button
                  onClick={handleDeleteClick}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-wider text-neutral-400 border border-neutral-700 hover:border-red-800 hover:text-red-400 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Delete
                </button>
              </>
            )}
          </div>

        </div>
        </div>
      </div>
    </div>
  );
}

const LOAD_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;

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

  // Cleanup debounce + load timeout on unmount
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

      // Loading timeout
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);

      // Migrate localStorage data to SQLite once
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

      // Fetch real total count from DB
      try {
        const countResult = await window.dictator.history.getCount();
        if (countResult.success) setTotalCount(countResult.count);
      } catch { /* non-critical */ }

    } catch (err) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[HistoryPage] Failed to load recordings:', msg);
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
      console.error('[HistoryPage] Failed to load more recordings:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, recordings.length]);

  // Initial load
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Reload list when a new transcription arrives — preserve expanded state
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
          // Another stale check after async
          if (searchQueryRef.current !== q) return;
          if (result.success) {
            setRecordings(result.data);
          }
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
    setDeletingId(id);
    setDeleteError(null);
    try {
      const result = await window.dictator.history.delete(id);
      if (result.success) {
        setRecordings((prev) => prev.filter((r) => r.id !== id));
        setTotalCount((prev) => (prev !== null ? prev - 1 : prev));
        setExpandedId((prev) => (prev === id ? null : prev));
        if (result.audioError) {
          console.warn('[HistoryPage] Audio cleanup warning:', result.audioError);
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

  // When searching: show loaded result count; otherwise: show real total from DB
  const displayCount = searchQuery.trim() ? recordings.length : (totalCount ?? recordings.length);

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-8">

        {/* ── Search Section ── */}
        <section>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">
            Footage Archive
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-600 pointer-events-none"
                fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="SEARCH FOOTAGE..."
                aria-label="Search recordings"
                className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 pl-9 pr-4 py-2 font-mono text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-red-600/30 transition-colors"
              />
            </div>
            {!isLoading && (
              <p className="mt-2 font-mono text-sm text-neutral-600">
                {displayCount} recording{displayCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </section>

        {/* ── Content ── */}
        {isLoading ? (
          <section>
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">
              Loading
            </h2>
            <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5">
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-neutral-600">
                {loadTimedOut ? (
                  <>
                    <svg className="h-8 w-8 text-red-800" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    <p className="text-sm text-red-600">Loading is taking too long</p>
                    <button
                      onClick={() => loadAll()}
                      className="rounded-lg border border-neutral-700 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.25em] text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <svg className="h-6 w-6 animate-spin text-neutral-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                    </svg>
                    <p className="font-mono text-sm">LOADING...</p>
                  </>
                )}
              </div>
            </div>
          </section>
        ) : recordings.length === 0 ? (
          <section>
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">
              {loadError ? 'Error' : searchQuery ? 'Search Results' : 'Archive'}
            </h2>
            <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5">
              <div className="relative">
                <ViewfinderCorners />
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-neutral-600">
                  {loadError ? (
                    <>
                      <svg className="h-8 w-8 text-red-800" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <p className="text-sm text-red-600">Failed to load recordings</p>
                      <p className="text-sm text-neutral-600 max-w-xs text-center">{loadError}</p>
                      <button
                        onClick={() => loadAll()}
                        className="rounded-lg border border-neutral-700 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.25em] text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors"
                      >
                        Retry
                      </button>
                    </>
                  ) : searchQuery ? (
                    <>
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                      </svg>
                      <p className="font-mono text-sm">NO FOOTAGE FOUND</p>
                      <p className="text-sm text-neutral-600">Try a different search term</p>
                    </>
                  ) : (
                    <>
                      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                      </svg>
                      <p className="font-mono text-sm">NO FOOTAGE RECORDED</p>
                      <p className="text-sm text-neutral-600">Start recording to see history here</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            {groups.map(({ label, entries }) => (
              <section key={label}>
                <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500 mb-4">
                  {label}
                </h2>
                <div className="rounded-xl border border-neutral-800 bg-[#141414] overflow-hidden">
                  {entries.map((entry, idx) => (
                    <RecordingItem
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedId === entry.id}
                      onToggle={() => handleToggle(entry.id)}
                      onDelete={handleDelete}
                      deleteError={deleteError?.id === entry.id ? deleteError.msg : null}
                      isDeleting={deletingId === entry.id}
                      isLast={idx === entries.length - 1}
                    />
                  ))}
                </div>
              </section>
            ))}
            {hasMore && !searchQuery && (
              <div className="flex justify-center pb-4">
                <button
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="rounded-lg border border-neutral-700 px-6 py-2 font-mono text-sm font-semibold uppercase tracking-[0.25em] text-neutral-500 hover:text-neutral-300 hover:border-neutral-500 transition-colors disabled:opacity-50 disabled:cursor-wait cursor-pointer"
                >
                  {isLoadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}
