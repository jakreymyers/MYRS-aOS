import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyPlan } from '../../src/knowledge/apply';
import type { CandidateFact } from '../../src/knowledge/consolidate';
import type { AtomicFact } from '../../src/knowledge/types';

let root: string;
let entityDir: string;

const seedItems = async (items: AtomicFact[]): Promise<void> => {
  await mkdir(entityDir, { recursive: true });
  await writeFile(join(entityDir, 'items.json'), JSON.stringify(items, null, 2) + '\n');
};

const readItems = async (): Promise<AtomicFact[]> =>
  JSON.parse(await readFile(join(entityDir, 'items.json'), 'utf8')) as AtomicFact[];

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  return value as T;
};

const candidate = (fact: string, overrides: Partial<CandidateFact> = {}): CandidateFact => ({
  fact,
  category: 'status',
  importance: 2,
  timestamp: '2026-02-12T09:00',
  relatedEntities: [],
  ...overrides,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'apply-plan-test-'));
  entityDir = join(root, 'people', 'jak-myers');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('applyPlan', () => {
  test('create adds a new active fact', async () => {
    await seedItems([]);

    const result = await applyPlan({
      entityDir,
      entityPath: 'people/jak-myers',
      source: 'session-1',
      candidates: [candidate('Jak leads IS')],
      decisions: [{ candidateIndex: 0, action: 'create' }],
    });

    expect(result.created).toBe(1);

    const items = await readItems();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('active');
    expect(items[0].importance).toBe(2);
  });

  test('supersede marks old fact and creates replacement', async () => {
    await seedItems([
      {
        id: 'jak-001',
        fact: 'Jak is Director of IS',
        category: 'status',
        timestamp: '2026-01-01',
        source: 'seed',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-02-10',
        accessCount: 1,
        importance: 2,
      },
    ]);

    await applyPlan({
      entityDir,
      entityPath: 'people/jak-myers',
      source: 'session-2',
      candidates: [candidate('Jak is Vice President of IS', { importance: 3 })],
      decisions: [{ candidateIndex: 0, action: 'supersede', targetFactId: 'jak-001' }],
    });

    const items = await readItems();
    expect(items).toHaveLength(2);

    const oldFact = expectDefined(items.find((f) => f.id === 'jak-001'));
    const newFact = expectDefined(items.find((f) => f.id !== 'jak-001'));

    expect(oldFact.status).toBe('superseded');
    expect(oldFact.supersededBy).toBe(newFact.id);
    expect(newFact.importance).toBe(3);
  });

  test('merge creates merged fact with mergedFrom provenance', async () => {
    await seedItems([
      {
        id: 'jak-001',
        fact: 'Jak leads IS',
        category: 'status',
        timestamp: '2026-01-01',
        source: 'seed',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-02-10',
        accessCount: 1,
        importance: 2,
      },
    ]);

    await applyPlan({
      entityDir,
      entityPath: 'people/jak-myers',
      source: 'session-3',
      candidates: [candidate('Jak leads IS and oversees platform strategy', { importance: 3 })],
      decisions: [
        {
          candidateIndex: 0,
          action: 'merge',
          targetFactId: 'jak-001',
          fact: 'Jak leads IS and oversees platform strategy',
          importance: 3,
        },
      ],
    });

    const items = await readItems();
    const merged = expectDefined(items.find((f) => f.id !== 'jak-001'));
    expect(merged.mergedFrom).toEqual(['jak-001']);
    expect(merged.importance).toBe(3);
  });

  test('drop does not mutate existing facts', async () => {
    await seedItems([
      {
        id: 'jak-001',
        fact: 'Jak leads IS',
        category: 'status',
        timestamp: '2026-01-01',
        source: 'seed',
        status: 'active',
        supersededBy: null,
        relatedEntities: [],
        lastAccessed: '2026-02-10',
        accessCount: 1,
        importance: 2,
      },
    ]);

    const result = await applyPlan({
      entityDir,
      entityPath: 'people/jak-myers',
      source: 'session-4',
      candidates: [candidate('duplicate text')],
      decisions: [{ candidateIndex: 0, action: 'drop', reason: 'duplicate' }],
    });

    expect(result.dropped).toBe(1);

    const items = await readItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('jak-001');
    expect(items[0].status).toBe('active');
  });
});
