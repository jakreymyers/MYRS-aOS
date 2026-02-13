import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadState, mutateSessionState, pruneSessions } from '../../src/session/state';

let root: string;
let memoryRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'session-state-test-'));
  memoryRoot = join(root, 'memory');
  process.env.MEMORY_ROOT = memoryRoot;
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('session/state pruning', () => {
  test('loadState migrates v2 schema to v3 defaults', async () => {
    await mkdir(join(memoryRoot, 'data'), { recursive: true });
    await writeFile(join(memoryRoot, 'data', 'session-state.json'), JSON.stringify({
      schemaVersion: 2,
      sessions: {
        '/sessions/a.jsonl': {
          contentHash: 'a',
          digestedAt: '2026-02-12T00:00:00.000Z',
          digestedHash: 'a',
        },
      },
      lastDigest: null,
      lastCurate: null,
    }, null, 2) + '\n');

    const state = await loadState();
    expect(state.schemaVersion).toBe(3);
    expect(state.sessions['/sessions/a.jsonl']?.digestedMessageCount).toBeNull();
    expect(state.sessions['/sessions/a.jsonl']?.sessionSummary).toBeNull();
  });

  test('pruneSessions removes entries for missing log files', async () => {
    await mutateSessionState(async (state) => {
      state.sessions['/sessions/a.jsonl'] = {
        contentHash: 'a',
        digestedAt: '2026-02-12T00:00:00.000Z',
        digestedHash: 'a',
        digestedMessageCount: 12,
        sessionSummary: 'Summary A',
      };
      state.sessions['/sessions/b.jsonl'] = {
        contentHash: 'b',
        digestedAt: '2026-02-12T00:00:00.000Z',
        digestedHash: 'b',
        digestedMessageCount: 8,
        sessionSummary: 'Summary B',
      };
      return state;
    });

    const removed = await pruneSessions(['/sessions/b.jsonl']);
    expect(removed).toBe(1);

    const state = await loadState();
    expect(Object.keys(state.sessions)).toEqual(['/sessions/b.jsonl']);
  });

  test('pruneSessions no-op when all tracked sessions still exist', async () => {
    await mutateSessionState(async (state) => {
      state.sessions['/sessions/a.jsonl'] = {
        contentHash: 'a',
        digestedAt: '2026-02-12T00:00:00.000Z',
        digestedHash: 'a',
        digestedMessageCount: 4,
        sessionSummary: 'Summary',
      };
      return state;
    });

    const removed = await pruneSessions(['/sessions/a.jsonl']);
    expect(removed).toBe(0);
  });
});
