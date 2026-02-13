import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCurate } from '../../src/cli/curate';
import { createEntity } from '../../src/knowledge/entities';

let root: string;
let contextRoot: string;
let memoryRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'curate-cli-test-'));
  contextRoot = join(root, 'context');
  memoryRoot = join(root, 'memory');

  process.env.CONTEXT_ROOT = contextRoot;
  process.env.MEMORY_ROOT = memoryRoot;

  await mkdir(join(memoryRoot, 'data'), { recursive: true });
  await mkdir(join(memoryRoot, 'daily-notes'), { recursive: true });

  await createEntity({
    path: 'people/jane',
    name: 'Jane',
    type: 'person',
    bucket: 'people',
    tags: [],
    contextRoot,
  });
  await createEntity({
    path: 'people/bob',
    name: 'Bob',
    type: 'person',
    bucket: 'people',
    tags: [],
    contextRoot,
  });
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory curate diff input', () => {
  test('passes only changed entities and new daily reports to prompt', async () => {
    const lastCurate = new Date('2026-02-12T10:00:00.000Z');
    await writeFile(join(memoryRoot, 'data', 'session-state.json'), JSON.stringify({
      schemaVersion: 3,
      sessions: {},
      lastDigest: null,
      lastCurate: lastCurate.toISOString(),
    }, null, 2) + '\n');
    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: null,
      lastExtraction: null,
      dirtyEntities: ['people/jane'],
      consolidationFailures: 0,
    }, null, 2) + '\n');
    await writeFile(join(memoryRoot, 'MEMORY.md'), '# Working Memory\n\nOld context.\n');

    const oldNotePath = join(memoryRoot, 'daily-notes', '2026-02-11.md');
    const newNotePath = join(memoryRoot, 'daily-notes', '2026-02-12.md');
    await writeFile(oldNotePath, '# 2026-02-11\n\nOld note\n');
    await writeFile(newNotePath, '# 2026-02-12\n\nNew note\n');

    const oldTime = new Date('2026-02-12T09:00:00.000Z');
    const newTime = new Date('2026-02-12T12:00:00.000Z');
    await utimes(oldNotePath, oldTime, oldTime);
    await utimes(newNotePath, newTime, newTime);

    let prompt = '';
    const result = await runCurate([], {
      summarizeEntityFn: async () => true,
      runPromptFn: async (input) => {
        prompt = input;
        return '# Working Memory\n\nUpdated.\n';
      },
      nowFn: () => new Date('2026-02-12T15:00:00.000Z'),
    });

    expect(result.phase1).not.toBeNull();
    expect(result.phase1?.dirtyEntities).toBe(1);
    expect(result.phase1?.refreshed).toBe(1);
    expect(result.phase2).not.toBeNull();
    expect(result.phase2?.updated).toBe(true);
    expect(result.phase2?.dailyNotesUsed).toBe(1);
    expect(result.phase2?.changedEntitiesUsed).toBe(1);

    expect(prompt).toContain('Changed entities (1):');
    expect(prompt).toContain('people/jane');
    expect(prompt).not.toContain('people/bob');
    expect(prompt).toContain('New/updated daily reports since last curate (1):');
    expect(prompt).toContain('2026-02-12.md');
    expect(prompt).not.toContain('2026-02-11.md');

    const memory = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf8');
    expect(memory).toContain('Updated.');
  });

  test('skips MEMORY refresh when there are no entity or note diffs', async () => {
    const lastCurate = new Date('2026-02-12T10:00:00.000Z');
    await writeFile(join(memoryRoot, 'data', 'session-state.json'), JSON.stringify({
      schemaVersion: 3,
      sessions: {},
      lastDigest: null,
      lastCurate: lastCurate.toISOString(),
    }, null, 2) + '\n');
    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: null,
      lastExtraction: null,
      dirtyEntities: [],
      consolidationFailures: 0,
    }, null, 2) + '\n');
    await writeFile(join(memoryRoot, 'MEMORY.md'), '# Working Memory\n\nOld context.\n');

    const notePath = join(memoryRoot, 'daily-notes', '2026-02-12.md');
    await writeFile(notePath, '# 2026-02-12\n\nNote\n');
    const oldTime = new Date('2026-02-12T09:00:00.000Z');
    await utimes(notePath, oldTime, oldTime);

    let promptCalls = 0;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));
    try {
      const result = await runCurate([], {
        summarizeEntityFn: async () => true,
        runPromptFn: async () => {
          promptCalls++;
          return '# Working Memory\n\nShould not run.\n';
        },
        nowFn: () => new Date('2026-02-12T15:00:00.000Z'),
      });
      expect(result.phase1).not.toBeNull();
      expect(result.phase2).not.toBeNull();
      expect(result.phase2?.updated).toBe(false);
    } finally {
      console.log = originalLog;
    }

    expect(promptCalls).toBe(0);
    expect(logs.some((line) => line.includes('No entity or daily note changes'))).toBe(true);
  });
});
