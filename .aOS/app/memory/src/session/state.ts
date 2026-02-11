import { readFile, writeFile, mkdir, stat, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { resolveMemoryRoot } from '../utils/paths';
import type { SessionStateFile, SessionStateEntry } from '../types';

const resolveStatePath = (): string =>
  join(resolveMemoryRoot(), 'data', 'session-state.json');

const EMPTY_STATE: SessionStateFile = {
  sessions: {},
  lastDigest: null,
  lastCurate: null,
};

export const loadState = async (): Promise<SessionStateFile> => {
  const path = resolveStatePath();
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as SessionStateFile;
  } catch {
    return { ...EMPTY_STATE, sessions: {} };
  }
};

export const saveState = async (state: SessionStateFile): Promise<void> => {
  const path = resolveStatePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n');
};

export const updateSession = async (
  key: string,
  entry: SessionStateEntry
): Promise<void> => {
  const state = await loadState();
  state.sessions[key] = entry;
  await saveState(state);
};

// ============================================================================
// Digest Lock (mkdir-based atomic lock)
// ============================================================================

const LOCK_DIR = () => join(resolveMemoryRoot(), 'data', '.digest.lock');
const LOCK_MAX_AGE_MS = 120_000; // 2 minutes

export const acquireLock = async (): Promise<boolean> => {
  const lockPath = LOCK_DIR();
  try {
    await mkdir(lockPath, { recursive: false });
    return true;
  } catch {
    // Lock exists — check staleness
    try {
      const lockStat = await stat(lockPath);
      const age = Date.now() - lockStat.mtimeMs;
      if (age > LOCK_MAX_AGE_MS) {
        // Stale lock — remove and re-acquire
        await rmdir(lockPath);
        try {
          await mkdir(lockPath, { recursive: false });
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      // Lock was removed between our checks — try to acquire
      try {
        await mkdir(lockPath, { recursive: false });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};

export const releaseLock = async (): Promise<void> => {
  try {
    await rmdir(LOCK_DIR());
  } catch {
    // Already released or never existed
  }
};
