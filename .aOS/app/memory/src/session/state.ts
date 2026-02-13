import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveMemoryRoot } from '../utils/paths';
import type { SessionStateFile, SessionStateEntry } from '../types';
import { mutateState } from '../utils/state';
import { acquirePidLock, releasePidLock } from '../utils/lock';

const resolveStatePath = (): string =>
  join(resolveMemoryRoot(), 'data', 'session-state.json');

const EMPTY_STATE: SessionStateFile = {
  schemaVersion: 3,
  sessions: {},
  lastDigest: null,
  lastCurate: null,
};

const toCount = (value: unknown): number | null => {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
};

const toSummary = (value: unknown): string | null =>
  (typeof value === 'string' && value.trim().length > 0) ? value : null;

const normalizeSessionEntry = (entry: unknown): SessionStateEntry => {
  const row = (entry && typeof entry === 'object')
    ? entry as Partial<SessionStateEntry>
    : {};

  return {
    contentHash: typeof row.contentHash === 'string' ? row.contentHash : '',
    digestedAt: typeof row.digestedAt === 'string' ? row.digestedAt : null,
    digestedHash: typeof row.digestedHash === 'string' ? row.digestedHash : null,
    digestedMessageCount: toCount(row.digestedMessageCount),
    sessionSummary: toSummary(row.sessionSummary),
  };
};

const normalizeState = (state: Partial<SessionStateFile> | null | undefined): SessionStateFile => ({
  schemaVersion: 3,
  sessions: Object.fromEntries(
    Object.entries(state?.sessions ?? {}).map(([path, entry]) => [path, normalizeSessionEntry(entry)]),
  ),
  lastDigest: typeof state?.lastDigest === 'string' ? state.lastDigest : null,
  lastCurate: typeof state?.lastCurate === 'string' ? state.lastCurate : null,
});

export const loadState = async (): Promise<SessionStateFile> => {
  const path = resolveStatePath();
  try {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as Partial<SessionStateFile>;
    return normalizeState(parsed);
  } catch {
    return { ...EMPTY_STATE, sessions: {} };
  }
};

export const saveState = async (state: SessionStateFile): Promise<void> => {
  await mutateState(resolveStatePath(), EMPTY_STATE, async () => normalizeState(state));
};

export const mutateSessionState = async (
  mutator: (state: SessionStateFile) => SessionStateFile | Promise<SessionStateFile>,
): Promise<SessionStateFile> =>
  mutateState(resolveStatePath(), EMPTY_STATE, async (state) => {
    const next = await mutator(normalizeState(state));
    return normalizeState(next);
  });

export const updateSession = async (
  key: string,
  entry: SessionStateEntry,
): Promise<void> => {
  await mutateSessionState(async (next) => {
    next.sessions[key] = entry;
    return next;
  });
};

export const pruneSessions = async (keepPaths: string[]): Promise<number> => {
  const keep = new Set(keepPaths);
  let removed = 0;

  await mutateSessionState(async (state) => {
    for (const key of Object.keys(state.sessions)) {
      if (!keep.has(key)) {
        delete state.sessions[key];
        removed++;
      }
    }
    return state;
  });

  return removed;
};

const LOCK_PATH = (): string => join(resolveMemoryRoot(), 'data', 'digest.lock');

export const acquireLock = async (): Promise<boolean> =>
  acquirePidLock(LOCK_PATH());

export const releaseLock = async (): Promise<void> =>
  releasePidLock(LOCK_PATH());
