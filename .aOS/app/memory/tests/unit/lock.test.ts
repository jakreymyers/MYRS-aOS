import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquirePidLock, releasePidLock, readPidLockFile } from '../../src/utils/lock';

let root: string;
let lockPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lock-test-'));
  lockPath = join(root, 'digest.lock');
});

afterEach(async () => {
  await releasePidLock(lockPath);
  await rm(root, { recursive: true, force: true });
});

describe('acquirePidLock', () => {
  test('concurrent acquisition allows only one owner', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        acquirePidLock(lockPath, { heartbeatMs: 1000, staleMs: 30_000 }),
      ),
    );

    const successCount = attempts.filter(Boolean).length;
    expect(successCount).toBe(1);
  });

  test('stale lock with dead pid can be recovered', async () => {
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999,
        startedAt: '2026-01-01T00:00:00.000Z',
        lastHeartbeat: '2026-01-01T00:00:00.000Z',
      }) + '\n',
    );

    const acquired = await acquirePidLock(lockPath, {
      pid: 424242,
      staleMs: 30_000,
      isProcessAlive: () => false,
    });

    expect(acquired).toBe(true);

    const lock = await readPidLockFile(lockPath);
    expect(lock?.pid).toBe(424242);
  });

  test('alive owner with recent heartbeat is not stolen', async () => {
    const now = new Date().toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 12345, startedAt: now, lastHeartbeat: now }) + '\n',
    );

    const acquired = await acquirePidLock(lockPath, {
      pid: 22222,
      staleMs: 1,
      isProcessAlive: () => true,
    });

    expect(acquired).toBe(false);

    const content = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(content.pid).toBe(12345);
  });

  test('heartbeat updates lock while owner is alive', async () => {
    const acquired = await acquirePidLock(lockPath, {
      pid: 11111,
      heartbeatMs: 20,
      staleMs: 30_000,
    });
    expect(acquired).toBe(true);

    const first = await readPidLockFile(lockPath);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await readPidLockFile(lockPath);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(new Date(second!.lastHeartbeat).getTime()).toBeGreaterThan(
      new Date(first!.lastHeartbeat).getTime(),
    );
  });

  test('release removes lock file', async () => {
    expect(await acquirePidLock(lockPath, { pid: 33333 })).toBe(true);
    await releasePidLock(lockPath);
    const after = await readPidLockFile(lockPath);
    expect(after).toBeNull();
  });
});
