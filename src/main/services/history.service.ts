import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordingEntry, HistoryStats } from '../../shared/types';

const MAX_QUERY_LENGTH = 500;
const DEFAULT_LIMIT = 1000;

export interface DeleteResult {
  found: boolean;
  audioDeleted: boolean;
  audioError?: string;
}

export interface ClearAllResult {
  deleted: number;
  audioErrors: number;
}

export class HistoryService {
  private db: Database.Database;
  private recordingsDir: string | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        text TEXT NOT NULL,
        word_count INTEGER DEFAULT 0,
        raw_word_count INTEGER DEFAULT 0,
        duration_seconds REAL DEFAULT 0,
        app_name TEXT,
        audio_path TEXT,
        mode TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_recordings_date ON recordings(date DESC);
    `);
    this.migrateSchema();
  }

  /** Add raw_word_count column if missing (existing databases from before this change). */
  private migrateSchema(): void {
    const columns = this.db.pragma('table_info(recordings)') as { name: string }[];
    const hasRawWordCount = columns.some((c) => c.name === 'raw_word_count');
    if (!hasRawWordCount) {
      this.db.exec('ALTER TABLE recordings ADD COLUMN raw_word_count INTEGER DEFAULT 0');
      // Backfill: for old entries without raw_word_count, copy word_count as best-effort fallback
      this.db.exec('UPDATE recordings SET raw_word_count = word_count WHERE raw_word_count = 0');
    }
  }

  add(entry: RecordingEntry): void {
    this.validateEntry(entry);
    console.debug('[HistoryService] Adding entry:', entry.id);
    this.db.prepare(`
      INSERT OR REPLACE INTO recordings
        (id, date, text, word_count, raw_word_count, duration_seconds, app_name, audio_path, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.date,
      entry.text,
      entry.wordCount,
      entry.rawWordCount,
      entry.durationSeconds,
      entry.appName ?? null,
      entry.audioPath ?? null,
      entry.mode ?? null,
    );
  }

  /** Aggregate stats across ALL recordings (no limit). */
  getStats(): HistoryStats {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_recordings,
        COALESCE(SUM(word_count), 0) as total_words,
        COALESCE(SUM(raw_word_count), 0) as total_raw_words,
        COALESCE(SUM(duration_seconds), 0) as total_seconds
      FROM recordings
    `).get() as {
      total_recordings: number;
      total_words: number;
      total_raw_words: number;
      total_seconds: number;
    };

    const totalMinutes = row.total_seconds / 60;
    const avgWpm = totalMinutes > 0 ? Math.round(row.total_raw_words / totalMinutes) : 0;

    return {
      totalWords: row.total_words,
      totalSeconds: row.total_seconds,
      totalRecordings: row.total_recordings,
      avgWpm,
    };
  }

  getAll(limit = DEFAULT_LIMIT, offset = 0): RecordingEntry[] {
    console.debug('[HistoryService] getAll limit=%d offset=%d', limit, offset);
    const rows = this.db.prepare(
      'SELECT * FROM recordings ORDER BY date DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  delete(id: string): DeleteResult {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid recording ID');
    }
    console.debug('[HistoryService] Deleting entry:', id);

    const row = this.db.prepare(
      'SELECT audio_path FROM recordings WHERE id = ?'
    ).get(id) as { audio_path: string | null } | undefined;

    if (!row) {
      return { found: false, audioDeleted: false };
    }

    let audioDeleted = false;
    let audioError: string | undefined;

    if (row.audio_path) {
      // Only delete files inside the recordings directory to prevent arbitrary file deletion
      if (this.isPathInsideRecordingsDir(row.audio_path)) {
        try {
          fs.unlinkSync(row.audio_path);
          audioDeleted = true;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            audioDeleted = true;
          } else {
            audioError = `Failed to delete audio file: ${code ?? String(err)}`;
            console.warn('[HistoryService]', audioError);
          }
        }
      } else {
        audioError = 'Audio path outside recordings directory — skipped deletion';
        console.warn('[HistoryService]', audioError, row.audio_path);
      }
    }

    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    return { found: true, audioDeleted, audioError };
  }

  search(query: string): RecordingEntry[] {
    const trimmed = (query ?? '').trim();
    if (!trimmed) return this.getAll();
    if (trimmed.length > MAX_QUERY_LENGTH) {
      throw new Error(`Search query too long (max ${MAX_QUERY_LENGTH} characters)`);
    }
    console.debug('[HistoryService] Searching:', trimmed);
    // Escape LIKE wildcards so user input like "100%" is treated literally
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = this.db.prepare(
      "SELECT * FROM recordings WHERE text LIKE ? ESCAPE '\\' ORDER BY date DESC LIMIT ?"
    ).all(`%${escaped}%`, DEFAULT_LIMIT) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  clearAll(): ClearAllResult {
    console.debug('[HistoryService] Clearing all recordings');

    const deleteAll = this.db.transaction(() => {
      const rows = this.db.prepare(
        'SELECT audio_path FROM recordings WHERE audio_path IS NOT NULL'
      ).all() as { audio_path: string }[];

      let audioErrors = 0;
      for (const row of rows) {
        if (!this.isPathInsideRecordingsDir(row.audio_path)) {
          audioErrors++;
          console.warn('[HistoryService] Skipping deletion — path outside recordings dir:', row.audio_path);
          continue;
        }
        try {
          fs.unlinkSync(row.audio_path);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            audioErrors++;
            console.warn('[HistoryService] Failed to delete audio:', row.audio_path, code);
          }
        }
      }

      const result = this.db.prepare('DELETE FROM recordings').run();
      return { deleted: result.changes, audioErrors };
    });

    return deleteAll();
  }

  /** Set the trusted recordings directory for path validation. */
  setRecordingsDir(dir: string): void {
    this.recordingsDir = path.resolve(dir);
  }

  /** Validate that a file path is inside the recordings directory to prevent arbitrary file access. */
  private isPathInsideRecordingsDir(filePath: string): boolean {
    if (!this.recordingsDir) return false;
    const resolved = path.resolve(filePath);
    return resolved.startsWith(this.recordingsDir + path.sep) || resolved === this.recordingsDir;
  }

  updateAudioPath(id: string, audioPath: string): void {
    if (!id || typeof id !== 'string') throw new Error('Invalid recording ID');
    if (!audioPath || typeof audioPath !== 'string') throw new Error('Invalid audio path');
    if (!this.isPathInsideRecordingsDir(audioPath)) {
      throw new Error('Audio path must be inside the recordings directory');
    }
    this.db.prepare('UPDATE recordings SET audio_path = ? WHERE id = ?').run(audioPath, id);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM recordings').get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private validateEntry(entry: RecordingEntry): void {
    if (!entry.id || typeof entry.id !== 'string') throw new Error('Entry missing valid id');
    if (!entry.date || typeof entry.date !== 'string') throw new Error('Entry missing valid date');
    if (typeof entry.text !== 'string') throw new Error('Entry missing valid text');
    if (typeof entry.wordCount !== 'number' || entry.wordCount < 0) {
      throw new Error('Entry has invalid wordCount');
    }
    if (typeof entry.rawWordCount !== 'number' || entry.rawWordCount < 0) {
      throw new Error('Entry has invalid rawWordCount');
    }
    if (typeof entry.durationSeconds !== 'number' || entry.durationSeconds < 0) {
      throw new Error('Entry has invalid durationSeconds');
    }
  }

  private rowToEntry(row: Record<string, unknown>): RecordingEntry {
    const id = row.id as string | null;
    const date = row.date as string | null;
    const text = row.text as string | null;
    if (!id || !date || text == null) {
      throw new Error(`Corrupted DB row: missing required fields (id=${id}, date=${date})`);
    }
    const wordCount = typeof row.word_count === 'number' ? row.word_count : 0;
    return {
      id,
      date,
      text,
      wordCount,
      rawWordCount: typeof row.raw_word_count === 'number' ? row.raw_word_count : wordCount,
      durationSeconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : 0,
      appName: (row.app_name as string | null) ?? undefined,
      audioPath: (row.audio_path as string | null) ?? undefined,
      mode: (row.mode as string | null) ?? undefined,
    };
  }
}
