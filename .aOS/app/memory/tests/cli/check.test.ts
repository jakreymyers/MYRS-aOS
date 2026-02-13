import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCheck } from '../../src/cli/check';

let root: string;
let memoryRoot: string;
let contextRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'check-cli-test-'));
  memoryRoot = join(root, 'memory');
  contextRoot = join(root, 'context');

  process.env.MEMORY_ROOT = memoryRoot;
  process.env.CONTEXT_ROOT = contextRoot;

  await mkdir(join(memoryRoot, 'data'), { recursive: true });
  await mkdir(contextRoot, { recursive: true });
  await writeFile(join(memoryRoot, 'data', 'session-state.json'), JSON.stringify({
    schemaVersion: 3,
    sessions: {},
    lastDigest: null,
    lastCurate: null,
  }, null, 2) + '\n');
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  delete process.env.CONTEXT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory session-check', () => {
  test('warns when pipeline history is missing and consolidation failures are present', async () => {
    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: null,
      lastExtraction: null,
      dirtyEntities: [],
      consolidationFailures: 2,
    }, null, 2) + '\n');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runCheck([]);
    } finally {
      console.log = originalLog;
    }

    expect(logs.length).toBe(1);
    const payload = JSON.parse(logs[0]);
    expect(payload.additionalContext).toContain('No pipeline run history found');
    expect(payload.additionalContext).toContain('2 consolidation failures recorded');
  });

  test('warns when MEMORY.md is stale', async () => {
    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: new Date().toISOString(),
      lastExtraction: new Date().toISOString(),
      dirtyEntities: [],
      consolidationFailures: 0,
    }, null, 2) + '\n');
    await writeFile(join(memoryRoot, 'data', 'pipeline-runs.jsonl'), JSON.stringify({
      runId: 'run-1',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
    }) + '\n');

    const memoryMd = join(memoryRoot, 'MEMORY.md');
    await writeFile(memoryMd, '# Working Memory\n');
    const old = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000));
    await utimes(memoryMd, old, old);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runCheck([]);
    } finally {
      console.log = originalLog;
    }

    expect(logs.length).toBe(1);
    const payload = JSON.parse(logs[0]);
    expect(payload.additionalContext).toContain('MEMORY.md is older than 7 days');
  });
});
