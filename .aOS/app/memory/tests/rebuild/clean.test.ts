import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanGraph } from '../../src/rebuild/clean';
import type { AtomicFact, GraphState } from '../../src/knowledge/types';
import type { SessionStateFile } from '../../src/types';

let root: string;
let contextRoot: string;
let memoryRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clean-test-'));
  contextRoot = join(root, 'context');
  memoryRoot = join(root, 'memory');

  // Set env vars so resolvers find our temp dirs
  process.env.CONTEXT_ROOT = contextRoot;
  process.env.MEMORY_ROOT = memoryRoot;

  await mkdir(join(memoryRoot, 'data'), { recursive: true });
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

const createEntity = async (entityPath: string, facts: AtomicFact[]): Promise<void> => {
  const dir = join(contextRoot, entityPath);
  await mkdir(dir, { recursive: true });
  const bucket = entityPath.split('/')[0];
  await writeFile(join(dir, 'summary.md'), `---\ntitle: "Test"\ntype: test\npara: ${bucket}\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags: []\n---\n\n# Test\n`);
  await writeFile(join(dir, 'items.json'), JSON.stringify(facts, null, 2) + '\n');
};

const makeFact = (id: string): AtomicFact => ({
  id,
  fact: `Fact ${id}`,
  category: 'status',
  timestamp: '2026-02-01',
  source: 'test-session',
  status: 'active',
  supersededBy: null,
  relatedEntities: [],
  lastAccessed: '2026-02-01T10:00',
  accessCount: 3,
  importance: 2,
});

describe('clean', () => {
  test('clears all items.json to empty arrays', async () => {
    await createEntity('people/alice', [makeFact('alice-001'), makeFact('alice-002')]);
    await createEntity('people/bob', [makeFact('bob-001')]);
    await createEntity('projects/alpha', [makeFact('alpha-001'), makeFact('alpha-002'), makeFact('alpha-003')]);

    const result = await cleanGraph({ contextRoot, memoryRoot });

    expect(result.entitiesCleared).toBe(3);

    for (const ep of ['people/alice', 'people/bob', 'projects/alpha']) {
      const content = await readFile(join(contextRoot, ep, 'items.json'), 'utf8');
      expect(JSON.parse(content)).toEqual([]);
    }
  });

  test('preserves summary.md files', async () => {
    const summaryContent = `---\ntitle: "Alice"\ntype: person\npara: people\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags: [engineering]\n---\n\n# Alice\n\nAlice is a software engineer.\n`;
    const dir = join(contextRoot, 'people/alice');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'summary.md'), summaryContent);
    await writeFile(join(dir, 'items.json'), JSON.stringify([makeFact('alice-001')]) + '\n');

    await cleanGraph({ contextRoot, memoryRoot });

    const preserved = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(preserved).toBe(summaryContent);
  });

  test('resets session state to empty schema v3', async () => {
    const existingState: SessionStateFile = {
      schemaVersion: 3,
      sessions: {
        '/path/to/session.jsonl': {
          contentHash: 'abc123',
          digestedAt: '2026-02-01T10:00:00Z',
          digestedHash: 'abc123',
          digestedMessageCount: 1,
          sessionSummary: 'legacy summary',
        },
      },
      lastDigest: '2026-02-01T10:00:00Z',
      lastCurate: '2026-02-01T11:00:00Z',
    };
    await writeFile(
      join(memoryRoot, 'data', 'session-state.json'),
      JSON.stringify(existingState, null, 2) + '\n',
    );

    await cleanGraph({ contextRoot, memoryRoot });

    const content = await readFile(join(memoryRoot, 'data', 'session-state.json'), 'utf8');
    const state = JSON.parse(content) as SessionStateFile;
    expect(state.schemaVersion).toBe(3);
    expect(state.sessions).toEqual({});
    expect(state.lastDigest).toBeNull();
    expect(state.lastCurate).toBeNull();
  });

  test('resets graph state', async () => {
    const existingGraphState: GraphState = {
      lastSummaryRefresh: '2026-02-01T10:00:00Z',
      lastExtraction: '2026-02-01T09:00:00Z',
      dirtyEntities: ['people/alice', 'projects/alpha'],
      consolidationFailures: 5,
    };
    await writeFile(
      join(memoryRoot, 'data', 'graph-state.json'),
      JSON.stringify(existingGraphState, null, 2) + '\n',
    );

    await cleanGraph({ contextRoot, memoryRoot });

    const content = await readFile(join(memoryRoot, 'data', 'graph-state.json'), 'utf8');
    const state = JSON.parse(content) as GraphState;
    expect(state.lastSummaryRefresh).toBeNull();
    expect(state.lastExtraction).toBeNull();
    expect(state.dirtyEntities).toEqual([]);
    expect(state.consolidationFailures).toBe(0);
  });

  test('truncates pipeline-runs.jsonl', async () => {
    const existingLogs = '{"runId":"run-1","success":true}\n{"runId":"run-2","success":false}\n';
    await writeFile(join(memoryRoot, 'data', 'pipeline-runs.jsonl'), existingLogs);

    await cleanGraph({ contextRoot, memoryRoot });

    const content = await readFile(join(memoryRoot, 'data', 'pipeline-runs.jsonl'), 'utf8');
    expect(content).toBe('');
  });

  test('handles empty context (no entities)', async () => {
    // No entities created — context root is empty
    await mkdir(contextRoot, { recursive: true });

    const result = await cleanGraph({ contextRoot, memoryRoot });

    expect(result.entitiesCleared).toBe(0);
    expect(result.sessionStateReset).toBe(true);
    expect(result.graphStateReset).toBe(true);
    expect(result.pipelineRunsTruncated).toBe(true);
  });
});
