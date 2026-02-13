import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMirror } from '../../src/cli/mirror';

let root: string;
let memoryRoot: string;
let sessionDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mirror-cli-test-'));
  memoryRoot = join(root, 'memory');
  sessionDir = join(root, '.aOS', 'logs', 'sessions');

  process.env.AOS_ROOT = root;
  process.env.MEMORY_ROOT = memoryRoot;

  await mkdir(join(memoryRoot, 'data'), { recursive: true });
  await mkdir(sessionDir, { recursive: true });
});

afterEach(async () => {
  delete process.env.AOS_ROOT;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory session-mirror observability', () => {
  test('captures hook trigger and writes run context', async () => {
    const sessionId = 'session-mirror-1';
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const contexts: Array<{ trigger: string; sessionId: string | null; mirrorSuccess: boolean }> = [];
    const events: string[] = [];

    await runMirror([], {
      isStdinTtyFn: () => false,
      readStdinFn: async () => JSON.stringify({
        session_id: sessionId,
        hook_event_name: 'SessionEnd',
      }),
      getCurrentSessionIdFn: async () => ({ id: sessionId, sourcePath: '/tmp/native.jsonl' }),
      syncSessionFn: async () => sessionPath,
      writeRunContextFn: async (context) => {
        contexts.push({
          trigger: context.trigger,
          sessionId: context.sessionId,
          mirrorSuccess: context.mirrorSuccess,
        });
      },
      appendPipelineEventFn: async (event) => {
        events.push(event.event);
      },
      randomIdFn: () => 'run-mirror-1',
      nowFn: () => new Date('2026-02-12T10:00:00.000Z'),
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].trigger).toBe('SessionEnd');
    expect(contexts[0].sessionId).toBe(sessionId);
    expect(contexts[0].mirrorSuccess).toBe(true);
    expect(events).toContain('mirror.start');
    expect(events).toContain('mirror.end');
  });

  test('--trigger flag takes precedence over stdin', async () => {
    const sessionId = 'session-mirror-flag';
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const contexts: Array<{ trigger: string; sessionId: string | null }> = [];

    await runMirror(['--trigger', 'PreCompact'], {
      isStdinTtyFn: () => false,
      readStdinFn: async () => JSON.stringify({
        session_id: sessionId,
        hook_event_name: 'SessionStart',
      }),
      getCurrentSessionIdFn: async () => ({ id: sessionId, sourcePath: '/tmp/native.jsonl' }),
      syncSessionFn: async () => sessionPath,
      writeRunContextFn: async (context) => {
        contexts.push({ trigger: context.trigger, sessionId: context.sessionId });
      },
      appendPipelineEventFn: async () => {},
      randomIdFn: () => 'run-mirror-flag',
      nowFn: () => new Date('2026-02-12T10:00:00.000Z'),
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].trigger).toBe('PreCompact');
    expect(contexts[0].sessionId).toBe(sessionId);
  });

  test('--trigger flag works without stdin', async () => {
    const sessionId = 'session-mirror-tty';
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const contexts: Array<{ trigger: string }> = [];

    await runMirror(['--trigger', 'SessionEnd'], {
      isStdinTtyFn: () => true,
      syncCurrentSessionFn: async () => ({ id: sessionId, path: sessionPath }),
      writeRunContextFn: async (context) => {
        contexts.push({ trigger: context.trigger });
      },
      appendPipelineEventFn: async () => {},
      randomIdFn: () => 'run-mirror-tty',
      nowFn: () => new Date('2026-02-12T10:00:00.000Z'),
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].trigger).toBe('SessionEnd');
  });

  test('handles invalid stdin JSON gracefully and still mirrors', async () => {
    const sessionId = 'session-mirror-2';
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    }) + '\n');

    const contexts: Array<{ trigger: string; sessionId: string | null }> = [];

    await runMirror([], {
      isStdinTtyFn: () => false,
      readStdinFn: async () => 'not-json',
      syncCurrentSessionFn: async () => ({ id: sessionId, path: sessionPath }),
      writeRunContextFn: async (context) => {
        contexts.push({ trigger: context.trigger, sessionId: context.sessionId });
      },
      appendPipelineEventFn: async () => {},
      randomIdFn: () => 'run-mirror-2',
      nowFn: () => new Date('2026-02-12T10:00:00.000Z'),
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].sessionId).toBe(sessionId);
  });
});
