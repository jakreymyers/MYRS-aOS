import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFacts, saveFacts, addFact, supersedeFact, getActiveFacts, touchFact, getFactsByCategory, deleteFactsByIds } from '../../src/knowledge/facts';
import { loadGraphState } from '../../src/knowledge/state';
import type { AtomicFact } from '../../src/knowledge/types';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'facts-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('loadFacts / saveFacts', () => {
  test('returns empty array for missing directory', async () => {
    const facts = await loadFacts(join(testDir, 'nonexistent'));
    expect(facts).toEqual([]);
  });

  test('round-trips facts through save/load', async () => {
    const facts: AtomicFact[] = [{
      id: 'test-001',
      fact: 'Test fact',
      category: 'status',
      timestamp: '2026-01-15',
      source: '2026-01-15',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
      lastAccessed: '2026-02-07',
      accessCount: 3,
      importance: 2,
    }];

    await saveFacts(testDir, facts);
    const loaded = await loadFacts(testDir);
    expect(loaded).toEqual(facts);
  });

  test('backward-compat defaults importance to 1 when missing', async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, 'items.json'), JSON.stringify([
      {
        id: 'legacy-001',
        fact: 'Legacy fact with no importance',
        category: 'status',
        timestamp: '2026-01-01',
        source: 'legacy',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-01-01',
        accessCount: 1,
      },
    ]) + '\n');

    const loaded = await loadFacts(testDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].importance).toBe(1);
    expect(loaded[0].mergedFrom).toBeUndefined();
  });
});

describe('addFact', () => {
  test('adds fact with auto-generated ID', async () => {
    const result = await addFact(testDir, {
      fact: 'First fact',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    // ID should use directory slug
    const slug = testDir.split('/').pop()!;
    expect(result.id).toMatch(new RegExp(`^${slug}-001$`));
    expect(result.accessCount).toBe(1);
    expect(result.lastAccessed).toBeTruthy();

    // Should persist
    const facts = await loadFacts(testDir);
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe('First fact');
  });

  test('increments ID for subsequent facts', async () => {
    await addFact(testDir, {
      fact: 'First',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const second = await addFact(testDir, {
      fact: 'Second',
      category: 'milestone',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const slug = testDir.split('/').pop()!;
    expect(second.id).toBe(`${slug}-002`);

    const facts = await loadFacts(testDir);
    expect(facts).toHaveLength(2);
  });
});

describe('supersedeFact', () => {
  test('marks old fact superseded and adds replacement', async () => {
    const original = await addFact(testDir, {
      fact: 'Original role',
      category: 'status',
      timestamp: '2026-01-15',
      source: '2026-01-15',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const replacement = await supersedeFact(testDir, original.id, {
      fact: 'Updated role',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    expect(replacement).not.toBeNull();

    const facts = await loadFacts(testDir);
    expect(facts).toHaveLength(2);

    const old = facts.find(f => f.id === original.id)!;
    expect(old.status).toBe('superseded');
    expect(old.supersededBy).toBe(replacement!.id);

    const newFact = facts.find(f => f.id === replacement!.id)!;
    expect(newFact.status).toBe('active');
    expect(newFact.fact).toBe('Updated role');
  });

  test('returns null for non-existent fact', async () => {
    const result = await supersedeFact(testDir, 'nonexistent-999', {
      fact: 'Nope',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });
    expect(result).toBeNull();
  });
});

describe('getActiveFacts', () => {
  test('filters out superseded facts', async () => {
    const original = await addFact(testDir, {
      fact: 'Old',
      category: 'status',
      timestamp: '2026-01-15',
      source: '2026-01-15',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    await supersedeFact(testDir, original.id, {
      fact: 'New',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const active = await getActiveFacts(testDir);
    expect(active).toHaveLength(1);
    expect(active[0].fact).toBe('New');
  });
});

describe('touchFact', () => {
  test('increments access count', async () => {
    const fact = await addFact(testDir, {
      fact: 'Touch me',
      category: 'context',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    expect(fact.accessCount).toBe(1);

    const result = await touchFact(testDir, fact.id);
    expect(result).toBe(true);

    const facts = await loadFacts(testDir);
    expect(facts[0].accessCount).toBe(2);
  });

  test('returns false for missing fact', async () => {
    expect(await touchFact(testDir, 'nope-999')).toBe(false);
  });
});

describe('getFactsByCategory', () => {
  test('filters by category', async () => {
    await addFact(testDir, {
      fact: 'A milestone',
      category: 'milestone',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    await addFact(testDir, {
      fact: 'A status',
      category: 'status',
      timestamp: '2026-02-07',
      source: '2026-02-07',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const milestones = await getFactsByCategory(testDir, 'milestone');
    expect(milestones).toHaveLength(1);
    expect(milestones[0].fact).toBe('A milestone');

    const statuses = await getFactsByCategory(testDir, 'status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].fact).toBe('A status');
  });
});

describe('saveFacts dirty-marking', () => {
  test('marks entity dirty by default when under context root', async () => {
    // Set up a temp context root + memory root so dirty-marking actually writes
    const tmpRoot = await mkdtemp(join(tmpdir(), 'dirty-test-'));
    const contextRoot = join(tmpRoot, 'context');
    const memoryRoot = join(tmpRoot, 'memory');
    const entityDir = join(contextRoot, 'projects', 'test-proj');
    await mkdir(entityDir, { recursive: true });
    await mkdir(join(memoryRoot, 'data'), { recursive: true });

    const origContext = process.env.CONTEXT_ROOT;
    const origMemory = process.env.MEMORY_ROOT;
    process.env.CONTEXT_ROOT = contextRoot;
    process.env.MEMORY_ROOT = memoryRoot;

    try {
      const facts: AtomicFact[] = [{
        id: 'test-proj-001',
        fact: 'Test fact',
        category: 'status',
        timestamp: '2026-02-09',
        source: '2026-02-09',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-02-09',
        accessCount: 1,
        importance: 1,
      }];

      await saveFacts(entityDir, facts);

      const graphState = await loadGraphState(memoryRoot);
      expect(graphState.dirtyEntities).toContain('projects/test-proj');
    } finally {
      if (origContext !== undefined) process.env.CONTEXT_ROOT = origContext;
      else delete process.env.CONTEXT_ROOT;
      if (origMemory !== undefined) process.env.MEMORY_ROOT = origMemory;
      else delete process.env.MEMORY_ROOT;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  test('skips dirty-marking when markDirty: false (saveFacts)', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'dirty-test-'));
    const contextRoot = join(tmpRoot, 'context');
    const memoryRoot = join(tmpRoot, 'memory');
    const entityDir = join(contextRoot, 'projects', 'test-proj');
    await mkdir(entityDir, { recursive: true });
    await mkdir(join(memoryRoot, 'data'), { recursive: true });

    const origContext = process.env.CONTEXT_ROOT;
    const origMemory = process.env.MEMORY_ROOT;
    process.env.CONTEXT_ROOT = contextRoot;
    process.env.MEMORY_ROOT = memoryRoot;

    try {
      const facts: AtomicFact[] = [{
        id: 'test-proj-001',
        fact: 'Test fact',
        category: 'status',
        timestamp: '2026-02-09',
        source: '2026-02-09',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-02-09',
        accessCount: 1,
        importance: 1,
      }];

      await saveFacts(entityDir, facts, { markDirty: false });

      const graphState = await loadGraphState(memoryRoot);
      expect(graphState.dirtyEntities).toEqual([]);
    } finally {
      if (origContext !== undefined) process.env.CONTEXT_ROOT = origContext;
      else delete process.env.CONTEXT_ROOT;
      if (origMemory !== undefined) process.env.MEMORY_ROOT = origMemory;
      else delete process.env.MEMORY_ROOT;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('deleteFactsByIds', () => {
  test('removes specified facts and keeps others', async () => {
    const a = await addFact(testDir, {
      fact: 'Fact A',
      category: 'status',
      timestamp: '2026-02-10',
      source: 'test-session',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const b = await addFact(testDir, {
      fact: 'Fact B',
      category: 'milestone',
      timestamp: '2026-02-10',
      source: 'test-session',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const c = await addFact(testDir, {
      fact: 'Fact C',
      category: 'context',
      timestamp: '2026-02-10',
      source: 'test-session',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const removed = await deleteFactsByIds(testDir, [a.id, c.id]);
    expect(removed).toBe(2);

    const remaining = await loadFacts(testDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });

  test('returns 0 for non-existent IDs', async () => {
    await addFact(testDir, {
      fact: 'Existing',
      category: 'status',
      timestamp: '2026-02-10',
      source: 'test-session',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const removed = await deleteFactsByIds(testDir, ['nonexistent-999', 'also-fake-001']);
    expect(removed).toBe(0);

    const remaining = await loadFacts(testDir);
    expect(remaining).toHaveLength(1);
  });

  test('handles empty ID list (no-op)', async () => {
    await addFact(testDir, {
      fact: 'Should remain',
      category: 'status',
      timestamp: '2026-02-10',
      source: 'test-session',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
    });

    const removed = await deleteFactsByIds(testDir, []);
    expect(removed).toBe(0);

    const remaining = await loadFacts(testDir);
    expect(remaining).toHaveLength(1);
  });
});
