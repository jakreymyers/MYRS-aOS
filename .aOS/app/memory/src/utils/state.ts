import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWrite } from './atomic';

interface MutateStateOptions {
  lockTimeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 10;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const cloneDefault = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const acquireAdvisoryLock = async (
  lockPath: string,
  options?: MutateStateOptions,
): Promise<Awaited<ReturnType<typeof open>>> => {
  const timeoutMs = options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const startedAt = Date.now();

  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const fh = await open(lockPath, 'wx');
      await fh.writeFile(`${process.pid}\n`);
      return fh;
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if ((Date.now() - startedAt) >= timeoutMs) {
        throw new Error(`Timed out acquiring advisory lock: ${lockPath}`);
      }
      await sleep(retryDelayMs);
    }
  }
};

export async function mutateState<T>(
  path: string,
  defaultValue: T,
  mutator: (state: T) => T | Promise<T>,
  options?: MutateStateOptions,
): Promise<T> {
  const lockPath = `${path}.lock`;
  const lockHandle = await acquireAdvisoryLock(lockPath, options);

  try {
    let state: T;

    try {
      const content = await readFile(path, 'utf8');
      try {
        state = JSON.parse(content) as T;
      } catch {
        const stamp = new Date().toISOString().replace(/[.:]/g, '-');
        const backup = `${path}.corrupt-${stamp}`;
        await writeFile(backup, content);
        throw new Error(`Corrupt JSON state file: ${path}. Backup written: ${backup}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        state = cloneDefault(defaultValue);
      } else {
        throw error;
      }
    }

    const nextState = await mutator(state);
    await atomicWrite(path, JSON.stringify(nextState, null, 2) + '\n');
    return nextState;
  } finally {
    try {
      await lockHandle.close();
    } catch {
      // Best effort
    }

    try {
      await unlink(lockPath);
    } catch {
      // Best effort
    }
  }
}
