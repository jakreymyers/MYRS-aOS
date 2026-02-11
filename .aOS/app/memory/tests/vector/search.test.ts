import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { syncVectors } from '../../src/vector/sync';
import { searchVec } from '../../src/vector/search';
import { disposeEmbedder } from '../../src/vector/embed';

// These tests require the embedding model — skip if not available
const modelAvailable = await (async () => {
  try {
    const { resolveModelFile } = await import('node-llama-cpp');
    await resolveModelFile('hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf', { download: false, cli: false });
    return true;
  } catch { return false; }
})();

const describeWithModel = modelAvailable ? describe : describe.skip;

describeWithModel('vector/search', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `search-test-${Date.now()}`);
    const contextRoot = join(tmpDir, 'context');
    const memoryRoot = join(tmpDir, 'memory');
    dbPath = join(memoryRoot, 'data', 'vectors.db');

    // Create test entities
    const entities = [
      { path: 'people/sandy-weldon', name: 'Sandy Weldon', text: 'Director of Finance at APS. Manages 13 staff in the finance department.' },
      { path: 'people/alex-chen', name: 'Alex Chen', text: 'Director of Information Systems. Manages engineering, product, and CX teams.' },
      { path: 'areas/departments/marketing', name: 'Marketing Department', text: 'Handles brand strategy, events, and member communications.' },
    ];

    for (const e of entities) {
      const dir = join(contextRoot, e.path);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'summary.md'), `---
title: "${e.name}"
type: person
para: ${e.path.split('/')[0]}
created: 2026-01-01
updated: 2026-01-01
tags: []
---

# ${e.name}

${e.text}
`);
      writeFileSync(join(dir, 'items.json'), '[]');
    }

    process.env.CONTEXT_ROOT = contextRoot;
    process.env.MEMORY_ROOT = memoryRoot;

    await syncVectors({ dbPath });
  }, 60_000);

  afterAll(async () => {
    await disposeEmbedder();
    delete process.env.CONTEXT_ROOT;
    delete process.env.MEMORY_ROOT;
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  test('finds relevant results for name query', async () => {
    const result = await searchVec({ query: 'Sandy Weldon', limit: 5, dbPath });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].file).toBe('people/sandy-weldon');
  }, 30_000);

  test('conceptual query ranks correctly', async () => {
    const result = await searchVec({ query: 'who manages finance', limit: 5, dbPath });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.length).toBeGreaterThan(0);
    // Sandy Weldon (finance director) should rank above Alex Chen
    const sandyIdx = result.data.findIndex(r => r.file === 'people/sandy-weldon');
    const alexIdx = result.data.findIndex(r => r.file === 'people/alex-chen');
    expect(sandyIdx).toBeLessThan(alexIdx);
  }, 30_000);

  test('returns scores between 0 and 1', async () => {
    const result = await searchVec({ query: 'engineering team', limit: 5, dbPath });
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const item of result.data) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  }, 30_000);

  test('respects limit parameter', async () => {
    const result = await searchVec({ query: 'APS', limit: 1, dbPath });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.length).toBeLessThanOrEqual(1);
  }, 30_000);
});
