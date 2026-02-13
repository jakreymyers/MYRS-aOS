import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendHookRunSummary,
  appendPipelineEvent,
  claimRunContext,
  writeRunContext,
  type HookRunSummary,
  type PipelineEvent,
  type PipelineRunContext,
} from '../../src/pipeline/observability';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pipeline-observability-test-'));
  process.env.AOS_ROOT = root;
});

afterEach(async () => {
  delete process.env.AOS_ROOT;
  delete process.env.MEMORY_OBSERVABILITY_RETENTION_DAYS;
  delete process.env.MEMORY_OBSERVABILITY_MAX_FILE_BYTES;
  await rm(root, { recursive: true, force: true });
});

describe('pipeline/observability', () => {
  test('writes and claims run context from inbox', async () => {
    const now = new Date().toISOString();
    const context: PipelineRunContext = {
      runId: 'run-1',
      trigger: 'SessionEnd',
      sessionId: 'session-1',
      hookReceivedAt: now,
      mirrorStartedAt: now,
      mirrorCompletedAt: now,
      mirrorDurationMs: 0,
      mirrorSuccess: true,
      mirrorError: null,
    };

    await writeRunContext(context);
    const claimed = await claimRunContext();

    expect(claimed).not.toBeNull();
    expect(claimed?.context.runId).toBe('run-1');
    expect(claimed?.context.trigger).toBe('SessionEnd');
  });

  test('skips stale context files', async () => {
    const stale: PipelineRunContext = {
      runId: 'run-stale',
      trigger: 'SessionStart',
      sessionId: 'session-stale',
      hookReceivedAt: '2026-02-12T00:00:00.000Z',
      mirrorStartedAt: '2026-02-12T00:00:00.000Z',
      mirrorCompletedAt: '2026-02-12T00:00:01.000Z',
      mirrorDurationMs: 1000,
      mirrorSuccess: true,
      mirrorError: null,
    };

    await writeRunContext(stale);
    const claimed = await claimRunContext({ nowMs: Date.parse('2026-02-12T00:10:00.000Z'), maxAgeMs: 60_000 });
    expect(claimed).toBeNull();
  });

  test('appends events and hook summaries as JSONL', async () => {
    const event: PipelineEvent = {
      ts: '2026-02-12T10:00:00.000Z',
      level: 'info',
      runId: 'run-1',
      trigger: 'SessionEnd',
      sessionId: 'session-1',
      event: 'digest.start',
      stage: 'digest',
    };

    const summary: HookRunSummary = {
      runId: 'run-1',
      trigger: 'SessionEnd',
      sessionId: 'session-1',
      startedAt: '2026-02-12T10:00:00.000Z',
      completedAt: '2026-02-12T10:00:03.000Z',
      durationMs: 3000,
      status: 'success',
      skipReason: null,
      mirror: { durationMs: 100, success: true, error: null },
      digest: {
        sessionsScanned: 1,
        sessionsProcessed: 1,
        sessionsLocked: 0,
        totalFacts: 2,
        totalEntities: 1,
        durationMs: 1500,
      },
      vectorSync: {
        attempted: true,
        durationMs: 200,
        added: 1,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        error: null,
      },
      curate: {
        attempted: true,
        durationMs: 300,
        dirtyEntities: 1,
        refreshed: 1,
        memoryUpdated: true,
        error: null,
      },
      warnings: [],
      errors: [],
    };

    await appendPipelineEvent(event);
    await appendHookRunSummary(summary);

    const eventsPath = join(root, '.aOS', 'logs', 'pipeline', 'events.jsonl');
    const summaryPath = join(root, '.aOS', 'logs', 'pipeline', 'hook-runs.jsonl');

    const eventLines = (await readFile(eventsPath, 'utf8')).trim().split('\n');
    const summaryLines = (await readFile(summaryPath, 'utf8')).trim().split('\n');

    expect(eventLines).toHaveLength(1);
    expect(summaryLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0]).event).toBe('digest.start');
    expect(JSON.parse(summaryLines[0]).status).toBe('success');
  });

  test('rotates events log by size limit', async () => {
    process.env.MEMORY_OBSERVABILITY_MAX_FILE_BYTES = '350';

    await appendPipelineEvent({
      ts: '2026-02-12T10:00:00.000Z',
      level: 'info',
      runId: 'run-size-1',
      trigger: 'SessionEnd',
      sessionId: 'session-size',
      event: 'digest.start',
      stage: 'digest',
      message: 'x'.repeat(280),
    });

    await appendPipelineEvent({
      ts: '2026-02-12T10:00:01.000Z',
      level: 'info',
      runId: 'run-size-2',
      trigger: 'SessionEnd',
      sessionId: 'session-size',
      event: 'digest.end',
      stage: 'digest',
      message: 'y'.repeat(280),
    });

    const logDir = join(root, '.aOS', 'logs', 'pipeline');
    const names = await readdir(logDir);
    const rotated = names.filter((name) => /^events\..+\.jsonl$/.test(name));
    expect(rotated.length).toBeGreaterThan(0);

    const current = await readFile(join(logDir, 'events.jsonl'), 'utf8');
    expect(current).toContain('run-size-2');
  });

  test('rotates aged current log and deletes rotated files older than retention', async () => {
    process.env.MEMORY_OBSERVABILITY_RETENTION_DAYS = '1';
    process.env.MEMORY_OBSERVABILITY_MAX_FILE_BYTES = '9999999';

    const logDir = join(root, '.aOS', 'logs', 'pipeline');
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, 'events.jsonl'), '{"old":"current"}\n');
    await writeFile(join(logDir, 'events.legacy.jsonl'), '{"old":"rotated"}\n');

    const oldDate = new Date('2025-01-01T00:00:00.000Z');
    await utimes(join(logDir, 'events.jsonl'), oldDate, oldDate);
    await utimes(join(logDir, 'events.legacy.jsonl'), oldDate, oldDate);

    await appendPipelineEvent({
      ts: '2026-02-12T10:00:02.000Z',
      level: 'info',
      runId: 'run-age-1',
      trigger: 'SessionEnd',
      sessionId: 'session-age',
      event: 'digest.start',
      stage: 'digest',
    });

    const names = await readdir(logDir);
    expect(names.includes('events.legacy.jsonl')).toBe(false);
    expect(names.some((name) => /^events\..+\.jsonl$/.test(name))).toBe(true);

    const current = await readFile(join(logDir, 'events.jsonl'), 'utf8');
    expect(current).toContain('run-age-1');
    expect(current).not.toContain('old');
  });

  test('applies same size rotation policy to hook-run summaries', async () => {
    process.env.MEMORY_OBSERVABILITY_MAX_FILE_BYTES = '650';

    const makeSummary = (runId: string): HookRunSummary => ({
      runId,
      trigger: 'SessionEnd',
      sessionId: 'session-summary',
      startedAt: '2026-02-12T10:00:00.000Z',
      completedAt: '2026-02-12T10:00:03.000Z',
      durationMs: 3000,
      status: 'success',
      skipReason: null,
      mirror: { durationMs: 10, success: true, error: null },
      digest: {
        sessionsScanned: 1,
        sessionsProcessed: 1,
        sessionsLocked: 0,
        totalFacts: 3,
        totalEntities: 1,
        durationMs: 1200,
      },
      vectorSync: {
        attempted: true,
        durationMs: 100,
        added: 1,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        error: null,
      },
      curate: {
        attempted: true,
        durationMs: 100,
        dirtyEntities: 1,
        refreshed: 1,
        memoryUpdated: true,
        error: null,
      },
      warnings: ['w'.repeat(260)],
      errors: [],
    });

    await appendHookRunSummary(makeSummary('run-summary-1'));
    await appendHookRunSummary(makeSummary('run-summary-2'));

    const logDir = join(root, '.aOS', 'logs', 'pipeline');
    const names = await readdir(logDir);
    const rotated = names.filter((name) => /^hook-runs\..+\.jsonl$/.test(name));
    expect(rotated.length).toBeGreaterThan(0);
  });
});
