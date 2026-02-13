import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { unlinkSync } from 'node:fs';

export interface LockFile {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
}

interface AcquirePidLockOptions {
  staleMs?: number;
  heartbeatMs?: number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 10_000;

const HEARTBEATS = new Map<string, ReturnType<typeof setInterval>>();
const OWNED_LOCKS = new Set<string>();
let signalHandlersInstalled = false;

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const installSignalHandlers = (): void => {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const cleanup = (): void => {
    for (const lockPath of OWNED_LOCKS) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Best effort
      }
    }
  };

  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
};

const writeLockFile = async (lockPath: string, lock: LockFile): Promise<void> => {
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
};

export const readPidLockFile = async (lockPath: string): Promise<LockFile | null> => {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.pid === 'number'
      && typeof parsed?.startedAt === 'string'
      && typeof parsed?.lastHeartbeat === 'string'
    ) {
      return parsed as LockFile;
    }
    return null;
  } catch {
    return null;
  }
};

const tryCreateLock = async (lockPath: string, lock: LockFile): Promise<boolean> => {
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    const fh = await open(lockPath, 'wx');
    try {
      await fh.writeFile(JSON.stringify(lock, null, 2) + '\n');
    } finally {
      await fh.close();
    }
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
};

const startHeartbeat = (lockPath: string, lock: LockFile, heartbeatMs: number): void => {
  if (HEARTBEATS.has(lockPath)) return;

  const interval = setInterval(async () => {
    if (!OWNED_LOCKS.has(lockPath)) return;
    const updated: LockFile = {
      ...lock,
      lastHeartbeat: new Date().toISOString(),
    };
    try {
      await writeLockFile(lockPath, updated);
    } catch {
      // Best effort; lock ownership is still based on file + PID checks.
    }
  }, heartbeatMs);

  interval.unref?.();
  HEARTBEATS.set(lockPath, interval);
};

export const acquirePidLock = async (
  lockPath: string,
  options?: AcquirePidLockOptions,
): Promise<boolean> => {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const heartbeatMs = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const pid = options?.pid ?? process.pid;
  const isProcessAlive = options?.isProcessAlive ?? defaultIsProcessAlive;

  const nowIso = new Date().toISOString();
  const candidate: LockFile = {
    pid,
    startedAt: nowIso,
    lastHeartbeat: nowIso,
  };

  if (await tryCreateLock(lockPath, candidate)) {
    OWNED_LOCKS.add(lockPath);
    installSignalHandlers();
    startHeartbeat(lockPath, candidate, heartbeatMs);
    return true;
  }

  const existing = await readPidLockFile(lockPath);

  if (!existing) {
    // Treat unreadable/malformed lock as owned by another process.
    // This avoids false double-acquire during lock file creation races.
    return false;
  }

  const heartbeatAt = Date.parse(existing.lastHeartbeat || existing.startedAt);
  const ageMs = Number.isFinite(heartbeatAt) ? (Date.now() - heartbeatAt) : Number.MAX_SAFE_INTEGER;
  const alive = isProcessAlive(existing.pid);

  if (!alive && ageMs > staleMs) {
    try {
      await unlink(lockPath);
    } catch {
      return false;
    }

    if (await tryCreateLock(lockPath, candidate)) {
      OWNED_LOCKS.add(lockPath);
      installSignalHandlers();
      startHeartbeat(lockPath, candidate, heartbeatMs);
      return true;
    }
  }

  return false;
};

export const releasePidLock = async (lockPath: string): Promise<void> => {
  const interval = HEARTBEATS.get(lockPath);
  if (interval) {
    clearInterval(interval);
    HEARTBEATS.delete(lockPath);
  }

  OWNED_LOCKS.delete(lockPath);

  try {
    await unlink(lockPath);
  } catch {
    // Already removed or never acquired.
  }
};
