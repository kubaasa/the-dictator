import Database from 'better-sqlite3';
import fs from 'node:fs';
import type { RecordingEntry } from '../../shared/types';

export class HistoryService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        text TEXT NOT NULL,
        word_count INTEGER DEFAULT 0,
        duration_seconds REAL DEFAULT 0,
        app_name TEXT,
        audio_path TEXT,
        mode TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_recordings_date ON recordings(date DESC);
    `);
  }

  add(entry: RecordingEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO recordings
        (id, date, text, word_count, duration_seconds, app_name, audio_path, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.date,
      entry.text,
      entry.wordCount,
      entry.durationSeconds,
      entry.appName ?? null,
      entry.audioPath ?? null,
      entry.mode ?? null,
    );
  }

  getAll(): RecordingEntry[] {
    const rows = this.db.prepare('SELECT * FROM recordings ORDER BY date DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  delete(id: string): void {
    const row = this.db.prepare('SELECT audio_path FROM recordings WHERE id = ?').get(id) as { audio_path: string | null } | undefined;
    if (row?.audio_path) {
      try { fs.unlinkSync(row.audio_path); } catch { /* ignore if file already gone */ }
    }
    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  }

  search(query: string): RecordingEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM recordings WHERE text LIKE ? ORDER BY date DESC'
    ).all(`%${query}%`) as Record<string, unknown>[];
    return rows.map(this.rowToEntry);
  }

  clearAll(): void {
    const rows = this.db.prepare(
      'SELECT audio_path FROM recordings WHERE audio_path IS NOT NULL'
    ).all() as { audio_path: string }[];
    for (const row of rows) {
      try { fs.unlinkSync(row.audio_path); } catch { /* ignore */ }
    }
    this.db.prepare('DELETE FROM recordings').run();
  }

  updateAudioPath(id: string, audioPath: string): void {
    this.db.prepare('UPDATE recordings SET audio_path = ? WHERE id = ?').run(audioPath, id);
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: Record<string, unknown>): RecordingEntry {
    return {
      id: row.id as string,
      date: row.date as string,
      text: row.text as string,
      wordCount: row.word_count as number,
      durationSeconds: row.duration_seconds as number,
      appName: (row.app_name as string | null) ?? undefined,
      audioPath: (row.audio_path as string | null) ?? undefined,
      mode: (row.mode as string | null) ?? undefined,
    };
  }
}
