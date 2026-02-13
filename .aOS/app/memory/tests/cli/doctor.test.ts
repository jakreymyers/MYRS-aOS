import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDoctor } from '../../src/cli/doctor';

let root: string;
let contextRoot: string;
let memoryRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctor-test-'));
  contextRoot = join(root, 'context');
  memoryRoot = join(root, 'memory');

  process.env.CONTEXT_ROOT = contextRoot;
  process.env.MEMORY_ROOT = memoryRoot;

  await mkdir(join(contextRoot, 'people', 'jane'), { recursive: true });
  await mkdir(join(memoryRoot, 'data'), { recursive: true });

  await writeFile(join(contextRoot, 'people', 'jane', 'summary.md'), '# Jane\n');
  await writeFile(join(contextRoot, 'people', 'jane', 'items.json'), '{not-json\n');
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory doctor', () => {
  test('reports malformed items.json in json output', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runDoctor(['--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues.some((issue: { code?: unknown }) => issue.code === 'MALFORMED_ITEMS_JSON')).toBe(true);
  });

  test('reports dirty entities missing from context', async () => {
    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: null,
      lastExtraction: null,
      dirtyEntities: ['people/missing'],
      consolidationFailures: 0,
    }, null, 2) + '\n');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runDoctor(['--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.issues.some((issue: { code?: unknown }) => issue.code === 'GRAPH_DIRTY_ENTITY_MISSING')).toBe(true);
  });

  test('reports stale vector index when content is newer than vectors.db', async () => {
    await mkdir(join(memoryRoot, 'data'), { recursive: true });
    await writeFile(join(memoryRoot, 'data', 'vectors.db'), '');
    await writeFile(join(memoryRoot, 'MEMORY.md'), '# Working Memory\n');

    const vecPath = join(memoryRoot, 'data', 'vectors.db');
    const summaryPath = join(contextRoot, 'people', 'jane', 'summary.md');
    const oldTime = new Date('2026-02-01T00:00:00.000Z');
    const newTime = new Date('2026-02-10T00:00:00.000Z');
    await utimes(vecPath, oldTime, oldTime);
    await utimes(summaryPath, newTime, newTime);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runDoctor(['--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.issues.some((issue: { code?: unknown }) => issue.code === 'VECTOR_INDEX_STALE')).toBe(true);
  });
});
