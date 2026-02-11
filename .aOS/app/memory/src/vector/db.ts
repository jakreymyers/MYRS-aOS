import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { resolveVecDbPath } from '../utils/paths';

const EMBEDDING_DIMS = 768;

// macOS ships a stripped SQLite that doesn't support extensions.
// Must point to Homebrew's before creating any Database instance.
let customSqliteSet = false;
const ensureCustomSQLite = (): void => {
  if (customSqliteSet) return;
  const candidates = [
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      Database.setCustomSQLite(p);
      customSqliteSet = true;
      return;
    }
  }
  // On Linux, system SQLite usually supports extensions
  customSqliteSet = true;
};

const initSchema = (db: Database): void => {
  db.run(`CREATE TABLE IF NOT EXISTS vec_documents (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    chunk_seq INTEGER NOT NULL DEFAULT 0,
    embedded_at TEXT NOT NULL
  )`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[${EMBEDDING_DIMS}] distance_metric=cosine
  )`);
};

export const openVecDb = (dbPath?: string): Database => {
  ensureCustomSQLite();
  const path = dbPath ?? resolveVecDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  sqliteVec.load(db);
  db.run('PRAGMA journal_mode=WAL');
  initSchema(db);
  return db;
};

export interface VecDocument {
  id: string;
  contentHash: string;
  text: string;
  title: string;
  source: string;
  chunkSeq: number;
  embeddedAt: string;
}

export const upsertDocument = (
  db: Database,
  doc: VecDocument,
  embedding: Float32Array,
): void => {
  const tx = db.transaction(() => {
    // Delete existing (if any) from both tables
    db.run('DELETE FROM vec_embeddings WHERE id = ?', [doc.id]);
    db.run('DELETE FROM vec_documents WHERE id = ?', [doc.id]);
    // Insert new
    db.run(
      'INSERT INTO vec_documents (id, content_hash, text, title, source, chunk_seq, embedded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [doc.id, doc.contentHash, doc.text, doc.title, doc.source, doc.chunkSeq, doc.embeddedAt],
    );
    db.run(
      'INSERT INTO vec_embeddings (id, embedding) VALUES (?, ?)',
      [doc.id, new Uint8Array(embedding.buffer)],
    );
  });
  tx();
};

export const deleteBySource = (db: Database, source: string): void => {
  const ids = db.query('SELECT id FROM vec_documents WHERE source = ?').all(source) as { id: string }[];
  if (ids.length === 0) return;
  const tx = db.transaction(() => {
    for (const { id } of ids) {
      db.run('DELETE FROM vec_embeddings WHERE id = ?', [id]);
      db.run('DELETE FROM vec_documents WHERE id = ?', [id]);
    }
  });
  tx();
};

export const deleteByIds = (db: Database, ids: string[]): void => {
  if (ids.length === 0) return;
  const tx = db.transaction(() => {
    for (const id of ids) {
      db.run('DELETE FROM vec_embeddings WHERE id = ?', [id]);
      db.run('DELETE FROM vec_documents WHERE id = ?', [id]);
    }
  });
  tx();
};

export const getAllDocumentHashes = (db: Database): Map<string, string> => {
  const rows = db.query('SELECT id, content_hash FROM vec_documents').all() as { id: string; content_hash: string }[];
  return new Map(rows.map(r => [r.id, r.content_hash]));
};

export interface VecQueryResult {
  id: string;
  distance: number;
}

export const queryVectors = (
  db: Database,
  embedding: Float32Array,
  k: number,
): VecQueryResult[] => {
  // vec0 kNN query — must be done separately from JOINs
  return db.query(
    'SELECT id, distance FROM vec_embeddings WHERE embedding MATCH ? AND k = ?',
  ).all(new Uint8Array(embedding.buffer), k) as VecQueryResult[];
};

export const getDocumentsById = (
  db: Database,
  ids: string[],
): VecDocument[] => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.query(
    `SELECT id, content_hash, text, title, source, chunk_seq, embedded_at FROM vec_documents WHERE id IN (${placeholders})`,
  ).all(...ids) as Array<{
    id: string;
    content_hash: string;
    text: string;
    title: string;
    source: string;
    chunk_seq: number;
    embedded_at: string;
  }>;
  return rows.map(r => ({
    id: r.id,
    contentHash: r.content_hash,
    text: r.text,
    title: r.title,
    source: r.source,
    chunkSeq: r.chunk_seq,
    embeddedAt: r.embedded_at,
  }));
};

export interface VecStats {
  documentCount: number;
  sourceBreakdown: Record<string, number>;
}

export const getStats = (db: Database): VecStats => {
  const [{ count }] = db.query('SELECT COUNT(*) as count FROM vec_documents').all() as [{ count: number }];
  const rows = db.query('SELECT source, COUNT(*) as count FROM vec_documents GROUP BY source').all() as Array<{ source: string; count: number }>;
  const sourceBreakdown: Record<string, number> = {};
  for (const r of rows) {
    sourceBreakdown[r.source] = r.count;
  }
  return { documentCount: count, sourceBreakdown };
};

export { EMBEDDING_DIMS };
