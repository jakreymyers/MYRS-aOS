import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadState } from '../session/state';
import { resolveMemoryRoot, resolveMemoryMdPath } from '../utils/paths';
import { loadGraphState } from '../knowledge/state';

const REFRESH_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const parseLastPipelineRunMs = async (memoryRoot: string): Promise<number | null> => {
  const path = join(memoryRoot, 'data', 'pipeline-runs.jsonl');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      const ms = Date.parse(parsed?.completedAt ?? parsed?.startedAt ?? '');
      if (Number.isFinite(ms)) return ms;
    } catch {
      continue;
    }
  }

  return null;
};

/**
 * Session check: lightweight state check at session start.
 *
 * Returns additionalContext JSON if:
 * - Previous digest didn't complete (stale lock exists)
 * - MEMORY.md was updated since last session
 * - Graph summaries are stale (>24h + dirty entities)
 *
 * No LLM calls — just file stat checks. Must complete in <5s.
 */
export const runCheck = async (_args: string[]): Promise<void> => {
  const warnings: string[] = [];
  const memoryRoot = resolveMemoryRoot();

  // Check for stale digest lock
  const lockPath = join(memoryRoot, 'data', 'digest.lock');
  try {
    const lockStat = await stat(lockPath);
    const age = Date.now() - lockStat.mtimeMs;
    if (age > 60_000) {
      warnings.push('Previous session digest may not have completed (stale lock detected). Run `memory session-digest --force` to retry.');
    }
  } catch {
    // No lock — good
  }

  // Check session state for undigested sessions
  const state = await loadState();
  const undigested = Object.values(state.sessions).filter(s => !s.digestedAt);
  if (undigested.length > 0) {
    warnings.push(`${undigested.length} session(s) have not been digested yet.`);
  }

  // Check if MEMORY.md was updated since last curate
  if (state.lastCurate) {
    try {
      const memoryMdStat = await stat(resolveMemoryMdPath());
      const curateTime = new Date(state.lastCurate).getTime();
      if (memoryMdStat.mtimeMs > curateTime) {
        warnings.push('MEMORY.md was updated since last auto-curate.');
      }
    } catch {
      // MEMORY.md doesn't exist yet — not a warning
    }
  }

  // Check MEMORY.md age
  try {
    const memoryMdStat = await stat(resolveMemoryMdPath());
    if (Date.now() - memoryMdStat.mtimeMs > MEMORY_STALE_MS) {
      warnings.push('MEMORY.md is older than 7 days. Run `memory curate`.');
    }
  } catch {
    // Missing MEMORY.md warning handled by doctor.
  }

  // Check pipeline run freshness
  const lastPipelineRun = await parseLastPipelineRunMs(memoryRoot);
  if (lastPipelineRun == null) {
    warnings.push('No pipeline run history found. Run `memory session-digest`.');
  } else if (Date.now() - lastPipelineRun > REFRESH_STALE_MS) {
    warnings.push('Last pipeline run is older than 24h.');
  }

  // Check graph state: >24h since refresh + dirty entities → warning
  try {
    const graphState = await loadGraphState();
    if (graphState.dirtyEntities.length > 0) {
      const lastRefresh = graphState.lastSummaryRefresh
        ? new Date(graphState.lastSummaryRefresh).getTime()
        : 0;
      const stale = Date.now() - lastRefresh > REFRESH_STALE_MS;

      if (stale) {
        warnings.push(`${graphState.dirtyEntities.length} entity summaries need refresh (>24h stale). Run \`memory curate --summaries-only\` or \`memory decay refresh\`.`);
      }
    }

    if (graphState.consolidationFailures > 0) {
      warnings.push(`${graphState.consolidationFailures} consolidation failures recorded. Review pipeline logs with \`memory doctor --json\`.`);
    }
  } catch {
    // Graph state missing — not a warning for first run
  }

  if (warnings.length > 0) {
    const output = {
      additionalContext: warnings.join('\n'),
    };
    console.log(JSON.stringify(output));
  }
};
