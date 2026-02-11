import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { openVecDb, getStats, getAllDocumentHashes } from '../../src/vector/db';
import { syncVectors } from '../../src/vector/sync';

// These tests require the embedding model — skip if not available
const modelAvailable = await (async () => {
  try {
    const { resolveModelFile } = await import('node-llama-cpp');
    await resolveModelFile('hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf', { download: false, cli: false });
    return true;
  } catch { return false; }
})();

const describeWithModel = modelAvailable ? describe : describe.skip;

describeWithModel('vector/sync', () => {
  let tmpDir: string;
  let contextRoot: string;
  let memoryRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    contextRoot = join(tmpDir, 'context');
    memoryRoot = join(tmpDir, 'memory');
    dbPath = join(memoryRoot, 'data', 'vectors.db');

    // Create entity with summary.md + items.json
    const entityDir = join(contextRoot, 'people', 'jane');
    mkdirSync(entityDir, { recursive: true });
    writeFileSync(join(entityDir, 'summary.md'), `---
title: "Jane Smith"
type: person
para: people
created: 2026-01-01
updated: 2026-01-01
tags: [engineering]
---

# Jane Smith

Software engineer who leads the platform team.
`);
    writeFileSync(join(entityDir, 'items.json'), '[]');

    // Create daily note
    const notesDir = join(memoryRoot, 'daily-notes');
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(join(notesDir, '2026-01-15.md'), `# 2026-01-15

Discussed platform migration with Jane. Decision: proceed with TypeScript.
`);

    // Set env vars for sync
    process.env.CONTEXT_ROOT = contextRoot;
    process.env.MEMORY_ROOT = memoryRoot;
  });

  afterEach(() => {
    delete process.env.CONTEXT_ROOT;
    delete process.env.MEMORY_ROOT;
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  test('initial sync indexes entities and notes', async () => {
    const result = await syncVectors({ dbPath });
    expect(result.added).toBe(2); // 1 summary + 1 note
    expect(result.unchanged).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.total).toBe(2);

    const db = openVecDb(dbPath);
    const stats = getStats(db);
    expect(stats.documentCount).toBe(2);
    db.close();
  }, 30_000);

  test('incremental sync skips unchanged content', async () => {
    await syncVectors({ dbPath });
    const result = await syncVectors({ dbPath });
    expect(result.added).toBe(0);
    expect(result.unchanged).toBe(2);
    expect(result.updated).toBe(0);
  }, 30_000);

  test('force sync re-embeds everything', async () => {
    await syncVectors({ dbPath });
    const result = await syncVectors({ dbPath, force: true });
    expect(result.updated).toBe(2);
    expect(result.unchanged).toBe(0);
  }, 30_000);

  test('detects and re-embeds changed content', async () => {
    await syncVectors({ dbPath });

    // Modify the summary
    const summaryPath = join(contextRoot, 'people', 'jane', 'summary.md');
    writeFileSync(summaryPath, `---
title: "Jane Smith"
type: person
para: people
created: 2026-01-01
updated: 2026-02-01
tags: [engineering, leadership]
---

# Jane Smith

Senior staff engineer and tech lead for the platform team. Recently promoted.
`);

    const result = await syncVectors({ dbPath });
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
  }, 30_000);

  test('deletes orphans when entity removed', async () => {
    await syncVectors({ dbPath });

    // Remove the entity
    rmSync(join(contextRoot, 'people', 'jane'), { recursive: true });

    const result = await syncVectors({ dbPath });
    expect(result.deleted).toBe(1); // removed summary
    expect(result.total).toBe(1);   // only the daily note remains
  }, 30_000);
});
