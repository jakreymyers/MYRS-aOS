import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDigestArgs, runDigest } from '../../src/cli/digest';
import { acquirePidLock, releasePidLock } from '../../src/utils/lock';

let root: string;
let sessionDir: string;
let memoryRoot: string;

const curateResult = () => ({
  phase1: {
    dirtyEntities: 0,
    refreshed: 0,
    refreshedPaths: [],
    durationMs: 0,
    error: null,
  },
  phase2: {
    updated: false,
    dailyNotesUsed: 0,
    changedEntitiesUsed: 0,
    previousSizeBytes: 0,
    newSizeBytes: 0,
    shrinkWarning: false,
    durationMs: 0,
    error: null,
  },
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-cli-test-'));
  sessionDir = join(root, 'sessions');
  memoryRoot = join(root, 'memory');
  process.env.SESSION_LOG_DIR = sessionDir;
  process.env.MEMORY_ROOT = memoryRoot;
  await mkdir(sessionDir, { recursive: true });
  await mkdir(join(memoryRoot, 'data'), { recursive: true });
});

afterEach(async () => {
  delete process.env.SESSION_LOG_DIR;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('parseDigestArgs', () => {
  test('--full is rejected (legacy mode removed)', () => {
    expect(() => parseDigestArgs(['--full'])).toThrow('--full');
  });

  test('parses --force, --no-curate, --no-consolidate', () => {
    const parsed = parseDigestArgs(['--force', '--no-curate', '--no-consolidate']);
    expect(parsed.force).toBe(true);
    expect(parsed.noCurate).toBe(true);
    expect(parsed.noConsolidate).toBe(true);
  });
});

describe('runDigest', () => {
  test('passes --no-consolidate to pipeline orchestrator for discovered sessions', async () => {
    await writeFile(join(sessionDir, 'session-a.jsonl'), JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const seen: Array<{ path: string; noConsolidate: boolean }> = [];

    await runDigest(['--no-consolidate'], {
      orchestrateSession: async (input) => {
        seen.push({ path: input.sessionPath, noConsolidate: input.noConsolidate === true });
        return { processed: true, createdFacts: 0, createdEntities: 0 };
      },
      syncVectorsFn: async () => ({ added: 0, updated: 0, deleted: 0, unchanged: 0, total: 0 }),
      runCurateFn: async () => curateResult(),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].path.endsWith('session-a.jsonl')).toBe(true);
    expect(seen[0].noConsolidate).toBe(true);
  });

  test('skips entirely when digest-run lock is already held', async () => {
    await writeFile(join(sessionDir, 'session-b.jsonl'), JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const lockPath = join(memoryRoot, 'data', 'digest-run.lock');
    const acquired = await acquirePidLock(lockPath);
    expect(acquired).toBe(true);

    const seen: string[] = [];

    try {
      await runDigest([], {
        orchestrateSession: async (input) => {
          seen.push(input.sessionPath);
          return { processed: true, createdFacts: 0, createdEntities: 0 };
        },
        syncVectorsFn: async () => ({ added: 0, updated: 0, deleted: 0, unchanged: 0, total: 0 }),
        runCurateFn: async () => curateResult(),
      });
    } finally {
      await releasePidLock(lockPath);
    }

    // Orchestrator should never have been called
    expect(seen).toHaveLength(0);
  });

  test('concurrent digest calls — only one processes sessions', async () => {
    await writeFile(join(sessionDir, 'session-c.jsonl'), JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    let orchestrateCalls = 0;

    const deps = {
      orchestrateSession: async () => {
        orchestrateCalls++;
        // Simulate some processing time so both digests overlap
        await new Promise((r) => setTimeout(r, 50));
        return { processed: true, createdFacts: 1, createdEntities: 0 };
      },
      syncVectorsFn: async () => ({ added: 0, updated: 0, deleted: 0, unchanged: 0, total: 0 }),
      runCurateFn: async () => curateResult(),
    };

    await Promise.all([
      runDigest([], deps),
      runDigest([], deps),
    ]);

    // Only one digest process should have called the orchestrator
    expect(orchestrateCalls).toBe(1);
  });

  test('emits skipped summary when run lock is already held', async () => {
    const lockPath = join(memoryRoot, 'data', 'digest-run.lock');
    const acquired = await acquirePidLock(lockPath);
    expect(acquired).toBe(true);

    const summaries: Array<{ status: string; skipReason: string | null }> = [];
    const events: string[] = [];

    try {
      await runDigest([], {
        appendHookRunSummaryFn: async (summary) => {
          summaries.push({ status: summary.status, skipReason: summary.skipReason });
        },
        appendPipelineEventFn: async (event) => {
          events.push(event.event);
        },
        claimRunContextFn: async () => ({
          context: {
            runId: 'run-ctx-lock',
            trigger: 'SessionEnd',
            sessionId: 'session-lock',
            hookReceivedAt: new Date().toISOString(),
            mirrorStartedAt: new Date().toISOString(),
            mirrorCompletedAt: new Date().toISOString(),
            mirrorDurationMs: 1,
            mirrorSuccess: true,
            mirrorError: null,
          },
          claimedPath: '/tmp/claimed.json',
        }),
        releaseClaimedContextFn: async () => {},
      });
    } finally {
      await releasePidLock(lockPath);
    }

    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe('skipped');
    expect(summaries[0].skipReason).toBe('run_lock_held');
    expect(events.includes('digest.skip')).toBe(true);
  });

  test('emits no_changes skip summary when all sessions are unchanged', async () => {
    await writeFile(join(sessionDir, 'session-no-change.jsonl'), JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'no-op' },
    }) + '\n');

    const summaries: Array<{ status: string; skipReason: string | null }> = [];
    await runDigest([], {
      orchestrateSession: async () => ({ processed: false, reason: 'unchanged', createdFacts: 0, createdEntities: 0 }),
      syncVectorsFn: async () => ({ added: 0, updated: 0, deleted: 0, unchanged: 0, total: 0 }),
      runCurateFn: async () => curateResult(),
      appendHookRunSummaryFn: async (summary) => {
        summaries.push({ status: summary.status, skipReason: summary.skipReason });
      },
      appendPipelineEventFn: async () => {},
      releaseClaimedContextFn: async () => {},
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe('skipped');
    expect(summaries[0].skipReason).toBe('no_changes');
  });

  test('marks run partial when vector sync fails', async () => {
    await writeFile(join(sessionDir, 'session-partial.jsonl'), JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'some changes' },
    }) + '\n');

    await writeFile(join(memoryRoot, 'data', 'graph-state.json'), JSON.stringify({
      lastSummaryRefresh: null,
      lastExtraction: null,
      dirtyEntities: [],
      consolidationFailures: 0,
    }, null, 2) + '\n');

    const summaries: Array<{ status: string; vectorError: string | null }> = [];
    await runDigest([], {
      orchestrateSession: async () => ({ processed: true, createdFacts: 1, createdEntities: 0 }),
      syncVectorsFn: async () => {
        throw new Error('vec failure');
      },
      runCurateFn: async () => curateResult(),
      appendHookRunSummaryFn: async (summary) => {
        summaries.push({ status: summary.status, vectorError: summary.vectorSync.error });
      },
      appendPipelineEventFn: async () => {},
      releaseClaimedContextFn: async () => {},
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe('partial');
    expect(String(summaries[0].vectorError)).toContain('vec failure');
  });
});
