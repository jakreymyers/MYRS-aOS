import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import {
  openVecDb,
  upsertDocument,
  deleteByIds,
  deleteBySource,
  getAllDocumentHashes,
  queryVectors,
  getDocumentsById,
  getStats,
  EMBEDDING_DIMS,
} from '../../src/vector/db';
import type { Database } from 'bun:sqlite';

const makeDbPath = () => join(tmpdir(), `vec-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const makeEmbedding = (seed: number): Float32Array => {
  const arr = new Float32Array(EMBEDDING_DIMS);
  arr[0] = seed;
  arr[1] = seed * 0.5;
  return arr;
};

describe('vector/db', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeDbPath();
    db = openVecDb(dbPath);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  test('creates schema on open', () => {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('vec_documents');
    expect(names).toContain('vec_embeddings');
  });

  test('upsert and retrieve document', () => {
    upsertDocument(db, {
      id: 'test-1',
      contentHash: 'abc123',
      text: 'Hello world',
      title: 'Test',
      source: 'test-source',
      chunkSeq: 0,
      embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));

    const docs = getDocumentsById(db, ['test-1']);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Test');
    expect(docs[0].text).toBe('Hello world');
    expect(docs[0].contentHash).toBe('abc123');
  });

  test('upsert replaces existing document', () => {
    upsertDocument(db, {
      id: 'test-1', contentHash: 'v1', text: 'First', title: 'T1',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));

    upsertDocument(db, {
      id: 'test-1', contentHash: 'v2', text: 'Second', title: 'T1',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-02T00:00:00Z',
    }, makeEmbedding(2.0));

    const docs = getDocumentsById(db, ['test-1']);
    expect(docs).toHaveLength(1);
    expect(docs[0].contentHash).toBe('v2');
    expect(docs[0].text).toBe('Second');
  });

  test('getAllDocumentHashes', () => {
    upsertDocument(db, {
      id: 'd1', contentHash: 'h1', text: 'A', title: 'A',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));
    upsertDocument(db, {
      id: 'd2', contentHash: 'h2', text: 'B', title: 'B',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(2.0));

    const hashes = getAllDocumentHashes(db);
    expect(hashes.size).toBe(2);
    expect(hashes.get('d1')).toBe('h1');
    expect(hashes.get('d2')).toBe('h2');
  });

  test('deleteByIds', () => {
    upsertDocument(db, {
      id: 'd1', contentHash: 'h1', text: 'A', title: 'A',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));
    upsertDocument(db, {
      id: 'd2', contentHash: 'h2', text: 'B', title: 'B',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(2.0));

    deleteByIds(db, ['d1']);
    const docs = getDocumentsById(db, ['d1', 'd2']);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('d2');
  });

  test('deleteBySource', () => {
    upsertDocument(db, {
      id: 'd1', contentHash: 'h1', text: 'A', title: 'A',
      source: 'source-a', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));
    upsertDocument(db, {
      id: 'd2', contentHash: 'h2', text: 'B', title: 'B',
      source: 'source-b', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(2.0));

    deleteBySource(db, 'source-a');
    const stats = getStats(db);
    expect(stats.documentCount).toBe(1);
    expect(stats.sourceBreakdown['source-b']).toBe(1);
  });

  test('kNN query returns nearest neighbors', () => {
    // Use dense, distinctive embeddings for cosine similarity to work correctly
    const embA = new Float32Array(EMBEDDING_DIMS);
    const embB = new Float32Array(EMBEDDING_DIMS);
    // A: mostly positive values
    for (let i = 0; i < EMBEDDING_DIMS; i++) embA[i] = 1.0;
    // B: mostly negative values — very different direction
    for (let i = 0; i < EMBEDDING_DIMS; i++) embB[i] = -1.0;

    upsertDocument(db, {
      id: 'd1', contentHash: 'h1', text: 'A', title: 'A',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, embA);
    upsertDocument(db, {
      id: 'd2', contentHash: 'h2', text: 'B', title: 'B',
      source: 's', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, embB);

    // Query with all-positive values (close to d1)
    const queryEmb = new Float32Array(EMBEDDING_DIMS);
    for (let i = 0; i < EMBEDDING_DIMS; i++) queryEmb[i] = 0.9;

    const results = queryVectors(db, queryEmb, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // d1 (all positive) should be closer to query (all positive) than d2 (all negative)
    expect(results[0].id).toBe('d1');
  });

  test('getStats', () => {
    upsertDocument(db, {
      id: 'd1', contentHash: 'h1', text: 'A', title: 'A',
      source: 'summary:people/jane', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(1.0));
    upsertDocument(db, {
      id: 'd2', contentHash: 'h2', text: 'B', title: 'B',
      source: 'note:2026-01-01', chunkSeq: 0, embeddedAt: '2026-01-01T00:00:00Z',
    }, makeEmbedding(2.0));

    const stats = getStats(db);
    expect(stats.documentCount).toBe(2);
    expect(stats.sourceBreakdown['summary:people/jane']).toBe(1);
    expect(stats.sourceBreakdown['note:2026-01-01']).toBe(1);
  });
});
