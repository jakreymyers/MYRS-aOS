import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, utimes } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import {
  resolvePipelineClaimedDir,
  resolvePipelineInboxDir,
  resolvePipelineLogDir,
} from '../utils/paths';
import { atomicWrite } from '../utils/atomic';

export type HookTrigger = 'SessionStart' | 'SessionEnd' | 'PreCompact' | 'manual' | 'unknown';
export type RunStatus = 'success' | 'partial' | 'skipped' | 'failed';
export type SkipReason = 'run_lock_held' | 'no_sessions' | 'no_changes' | 'all_locked' | null;

export interface PipelineRunContext {
  runId: string;
  trigger: HookTrigger;
  sessionId: string | null;
  hookReceivedAt: string;
  mirrorStartedAt: string;
  mirrorCompletedAt: string;
  mirrorDurationMs: number;
  mirrorSuccess: boolean;
  mirrorError: string | null;
}

export interface PipelineEvent {
  ts: string;
  level: 'info' | 'warn' | 'error';
  runId: string;
  trigger: HookTrigger;
  sessionId: string | null;
  event: string;
  stage?: 'mirror' | 'digest' | 'vector' | 'curate';
  durationMs?: number;
  message?: string;
  error?: string;
  meta?: Record<string, number | string | boolean | null>;
}

export interface HookRunSummary {
  runId: string;
  trigger: HookTrigger;
  sessionId: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: RunStatus;
  skipReason: SkipReason;
  mirror: { durationMs: number; success: boolean; error: string | null };
  digest: {
    sessionsScanned: number;
    sessionsProcessed: number;
    sessionsLocked: number;
    totalFacts: number;
    totalEntities: number;
    durationMs: number;
  };
  vectorSync: {
    attempted: boolean;
    durationMs: number | null;
    added: number;
    updated: number;
    deleted: number;
    unchanged: number;
    error: string | null;
  };
  curate: {
    attempted: boolean;
    durationMs: number | null;
    dirtyEntities: number;
    refreshed: number;
    memoryUpdated: boolean;
    error: string | null;
  };
  warnings: string[];
  errors: string[];
}

export interface ClaimedRunContext {
  context: PipelineRunContext;
  claimedPath: string;
}

interface ClaimRunContextOptions {
  maxAgeMs?: number;
  nowMs?: number;
}

const DEFAULT_CONTEXT_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_LOG_RETENTION_DAYS = 30;
const DEFAULT_LOG_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const safeTs = (iso: string): string =>
  iso.replace(/[:.]/g, '-');

const isHookTrigger = (value: unknown): value is HookTrigger =>
  value === 'SessionStart'
  || value === 'SessionEnd'
  || value === 'PreCompact'
  || value === 'manual'
  || value === 'unknown';

export const normalizeHookTrigger = (value: unknown): HookTrigger => {
  if (isHookTrigger(value)) return value;
  return 'unknown';
};

const parseContext = (raw: string): PipelineRunContext | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<PipelineRunContext>;
    if (typeof parsed?.runId !== 'string') return null;
    if (!isHookTrigger(parsed?.trigger)) return null;
    if (parsed?.sessionId != null && typeof parsed.sessionId !== 'string') return null;
    if (typeof parsed?.hookReceivedAt !== 'string') return null;
    if (typeof parsed?.mirrorStartedAt !== 'string') return null;
    if (typeof parsed?.mirrorCompletedAt !== 'string') return null;
    if (typeof parsed?.mirrorDurationMs !== 'number') return null;
    if (typeof parsed?.mirrorSuccess !== 'boolean') return null;
    if (parsed?.mirrorError != null && typeof parsed.mirrorError !== 'string') return null;
    return {
      runId: parsed.runId,
      trigger: parsed.trigger,
      sessionId: parsed.sessionId ?? null,
      hookReceivedAt: parsed.hookReceivedAt,
      mirrorStartedAt: parsed.mirrorStartedAt,
      mirrorCompletedAt: parsed.mirrorCompletedAt,
      mirrorDurationMs: parsed.mirrorDurationMs,
      mirrorSuccess: parsed.mirrorSuccess,
      mirrorError: parsed.mirrorError ?? null,
    };
  } catch {
    return null;
  }
};

const safeIsoTs = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, '-');

const toPositiveNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const getLogRetentionMs = (): number => {
  const days = toPositiveNumber(process.env.MEMORY_OBSERVABILITY_RETENTION_DAYS, DEFAULT_LOG_RETENTION_DAYS);
  return days * 24 * 60 * 60 * 1000;
};

const getLogMaxBytes = (): number =>
  toPositiveNumber(process.env.MEMORY_OBSERVABILITY_MAX_FILE_BYTES, DEFAULT_LOG_MAX_FILE_BYTES);

const resolveRotatedPath = (path: string, now: Date): string => {
  const ext = extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  return `${stem}.${safeIsoTs(now)}-${process.pid}${ext || '.jsonl'}`;
};

const isRotatedVariant = (entryName: string, basePath: string): boolean => {
  const base = basename(basePath); // e.g. events.jsonl
  if (!entryName.endsWith('.jsonl')) return false;
  if (entryName === base) return false;
  const ext = extname(base); // .jsonl
  const stem = ext ? base.slice(0, -ext.length) : base; // events
  return entryName.startsWith(`${stem}.`);
};

const cleanupRotatedLogs = async (path: string, nowMs: number, retentionMs: number): Promise<void> => {
  const dir = dirname(path);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!isRotatedVariant(name, path)) continue;
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if ((nowMs - s.mtimeMs) > retentionMs) {
        await unlink(full);
      }
    } catch {
      // Best effort.
    }
  }
};

const maybeRotateCurrentLog = async (path: string, lineByteLength: number, now: Date): Promise<void> => {
  let s;
  try {
    s = await stat(path);
  } catch {
    return;
  }

  const nowMs = now.getTime();
  const retentionMs = getLogRetentionMs();
  const maxBytes = getLogMaxBytes();
  const byAge = (nowMs - s.mtimeMs) > retentionMs;
  const bySize = (s.size + lineByteLength) > maxBytes;

  if (!byAge && !bySize) return;

  const rotatedPath = resolveRotatedPath(path, now);
  try {
    await rename(path, rotatedPath);
    await utimes(rotatedPath, now, now);
  } catch {
    // Another process may have rotated first.
  }
};

const appendJsonLine = async (path: string, line: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const now = new Date();
  const retentionMs = getLogRetentionMs();

  await maybeRotateCurrentLog(path, Buffer.byteLength(line), now);
  await appendFile(path, line, 'utf8');
  await cleanupRotatedLogs(path, now.getTime(), retentionMs);
};

const resolveEventsPath = (): string =>
  join(resolvePipelineLogDir(), 'events.jsonl');

const resolveHookRunsPath = (): string =>
  join(resolvePipelineLogDir(), 'hook-runs.jsonl');

export const writeRunContext = async (context: PipelineRunContext): Promise<string> => {
  const inboxDir = resolvePipelineInboxDir();
  await mkdir(inboxDir, { recursive: true });

  const file = `${safeTs(context.hookReceivedAt)}-${context.runId}.json`;
  const path = join(inboxDir, file);
  await atomicWrite(path, JSON.stringify(context, null, 2) + '\n');
  return path;
};

export const claimRunContext = async (options: ClaimRunContextOptions = {}): Promise<ClaimedRunContext | null> => {
  const inboxDir = resolvePipelineInboxDir();
  const claimedDir = resolvePipelineClaimedDir();
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_CONTEXT_MAX_AGE_MS;

  await mkdir(inboxDir, { recursive: true });
  await mkdir(claimedDir, { recursive: true });

  let names: string[] = [];
  try {
    names = (await readdir(inboxDir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return null;
  }

  for (const name of names) {
    const src = join(inboxDir, name);
    const dst = join(claimedDir, name);

    try {
      await rename(src, dst);
    } catch {
      continue;
    }

    let context: PipelineRunContext | null = null;
    try {
      const raw = await readFile(dst, 'utf8');
      context = parseContext(raw);
    } catch {
      context = null;
    }

    if (!context) {
      try {
        await unlink(dst);
      } catch {
        // Best effort.
      }
      continue;
    }

    const createdAt = Date.parse(context.hookReceivedAt);
    const ageMs = Number.isFinite(createdAt) ? nowMs - createdAt : Number.MAX_SAFE_INTEGER;
    if (ageMs > maxAgeMs) {
      try {
        await unlink(dst);
      } catch {
        // Best effort.
      }
      continue;
    }

    return {
      context,
      claimedPath: dst,
    };
  }

  return null;
};

export const releaseClaimedContext = async (
  claimedPath?: string | null,
  mode: 'delete' | 'archive' = 'delete',
): Promise<void> => {
  if (!claimedPath) return;
  if (mode === 'archive') return;
  try {
    await unlink(claimedPath);
  } catch {
    // Best effort.
  }
};

export const appendPipelineEvent = async (event: PipelineEvent): Promise<void> => {
  await appendJsonLine(resolveEventsPath(), JSON.stringify(event) + '\n');
};

export const appendHookRunSummary = async (summary: HookRunSummary): Promise<void> => {
  await appendJsonLine(resolveHookRunsPath(), JSON.stringify(summary) + '\n');
};
