import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { runExtractPrompt } from '../llm/claude';
import {
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_USER_PROMPT,
  CONSOLIDATE_SYSTEM_PROMPT,
  CONSOLIDATE_USER_PROMPT,
} from '../llm/prompts';
import { resolveSessionLogDir, resolveMemoryRoot } from '../utils/paths';
import { runPipeline, type RunPipelineOptions } from '../pipeline/orchestrate';
import { loadGraphState } from '../knowledge/state';
import { pruneSessions } from '../session/state';
import { syncVectors } from '../vector/sync';
import { disposeEmbedder } from '../vector/embed';
import { acquirePidLock, releasePidLock } from '../utils/lock';
import {
  appendHookRunSummary,
  appendPipelineEvent,
  claimRunContext,
  releaseClaimedContext,
  type ClaimedRunContext,
  type HookRunSummary,
  type PipelineEvent,
  type PipelineRunContext,
  type RunStatus,
  type SkipReason,
} from '../pipeline/observability';
import type { CurateResult } from './curate';

export interface DigestCliArgs {
  force: boolean;
  noCurate: boolean;
  noConsolidate: boolean;
}

export const parseDigestArgs = (args: string[]): DigestCliArgs => {
  if (args.includes('--full')) {
    throw new Error('`--full` has been removed. session-digest now auto-detects content changes.');
  }

  return {
    force: args.includes('--force'),
    noCurate: args.includes('--no-curate'),
    noConsolidate: args.includes('--no-consolidate'),
  };
};

interface DigestDeps {
  orchestrateSession?: (options: RunPipelineOptions) => Promise<{
    processed: boolean;
    reason?: 'unchanged' | 'empty' | 'locked';
    createdFacts: number;
    createdEntities: number;
  }>;
  syncVectorsFn?: typeof syncVectors;
  runCurateFn?: (args: string[]) => Promise<CurateResult>;
  claimRunContextFn?: () => Promise<ClaimedRunContext | null>;
  releaseClaimedContextFn?: (claimedPath?: string | null) => Promise<void>;
  appendPipelineEventFn?: (event: PipelineEvent) => Promise<void>;
  appendHookRunSummaryFn?: (summary: HookRunSummary) => Promise<void>;
  nowFn?: () => Date;
  randomIdFn?: () => string;
}

const tryAppendEvent = async (
  appendFn: (event: PipelineEvent) => Promise<void>,
  event: PipelineEvent,
): Promise<void> => {
  try {
    await appendFn(event);
  } catch {
    // Observability must not break pipeline execution.
  }
};

const tryAppendSummary = async (
  appendFn: (summary: HookRunSummary) => Promise<void>,
  summary: HookRunSummary,
): Promise<void> => {
  try {
    await appendFn(summary);
  } catch {
    // Best effort only.
  }
};

/**
 * Session digest (v4.2): thin wrapper around staged orchestrator.
 */
export const runDigest = async (args: string[], deps: DigestDeps = {}): Promise<void> => {
  const parsed = parseDigestArgs(args);
  const orchestrateSession = deps.orchestrateSession ?? runPipeline;
  const syncVectorsFn = deps.syncVectorsFn ?? syncVectors;
  const claimRunContextFn = deps.claimRunContextFn ?? claimRunContext;
  const releaseClaimedContextFn = deps.releaseClaimedContextFn ?? releaseClaimedContext;
  const appendPipelineEventFn = deps.appendPipelineEventFn ?? appendPipelineEvent;
  const appendHookRunSummaryFn = deps.appendHookRunSummaryFn ?? appendHookRunSummary;
  const nowFn = deps.nowFn ?? (() => new Date());
  const randomIdFn = deps.randomIdFn ?? randomUUID;
  const runCurateFn = deps.runCurateFn ?? (async (curateArgs: string[]) => {
    const { runCurate } = await import('./curate');
    return runCurate(curateArgs);
  });

  let claimedPath: string | null = null;
  let claimed: ClaimedRunContext | null = null;
  try {
    claimed = await claimRunContextFn();
  } catch {
    claimed = null;
  }
  if (claimed) {
    claimedPath = claimed.claimedPath;
  }
  const context: PipelineRunContext = claimed?.context ?? {
    runId: randomIdFn(),
    trigger: 'manual',
    sessionId: null,
    hookReceivedAt: nowFn().toISOString(),
    mirrorStartedAt: nowFn().toISOString(),
    mirrorCompletedAt: nowFn().toISOString(),
    mirrorDurationMs: 0,
    mirrorSuccess: false,
    mirrorError: null,
  };

  const startedAt = context.mirrorStartedAt;
  const warnings: string[] = [];
  const errors: string[] = [];
  let status: RunStatus = 'failed';
  let skipReason: SkipReason = null;

  const summary: HookRunSummary = {
    runId: context.runId,
    trigger: context.trigger,
    sessionId: context.sessionId,
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    status: 'failed',
    skipReason: null,
    mirror: {
      durationMs: context.mirrorDurationMs,
      success: context.mirrorSuccess,
      error: context.mirrorError,
    },
    digest: {
      sessionsScanned: 0,
      sessionsProcessed: 0,
      sessionsLocked: 0,
      totalFacts: 0,
      totalEntities: 0,
      durationMs: 0,
    },
    vectorSync: {
      attempted: false,
      durationMs: null,
      added: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      error: null,
    },
    curate: {
      attempted: false,
      durationMs: null,
      dirtyEntities: 0,
      refreshed: 0,
      memoryUpdated: false,
      error: null,
    },
    warnings,
    errors,
  };

  await tryAppendEvent(appendPipelineEventFn, {
    ts: nowFn().toISOString(),
    level: 'info',
    runId: context.runId,
    trigger: context.trigger,
    sessionId: context.sessionId,
    event: 'digest.start',
    stage: 'digest',
  });

  let gotRunLock = false;
  // Exclusive lock: only one digest process runs at a time.
  // Prevents concurrent digests from re-extracting and duplicating facts.
  const digestRunLockPath = join(resolveMemoryRoot(), 'data', 'digest-run.lock');
  const digestStageStartedAt = Date.now();
  try {
    gotRunLock = await acquirePidLock(digestRunLockPath);
    if (!gotRunLock) {
      console.log('Another digest is running — skipping');
      status = 'skipped';
      skipReason = 'run_lock_held';
      return;
    }

    const sessionDir = resolveSessionLogDir();
    const scanStartedAt = Date.now();
    let entries: Dirent[] = [];
    try {
      entries = await readdir(sessionDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const sessionFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(sessionDir, entry.name))
      .sort();

    await pruneSessions(sessionFiles);
    summary.digest.sessionsScanned = sessionFiles.length;

    await tryAppendEvent(appendPipelineEventFn, {
      ts: nowFn().toISOString(),
      level: 'info',
      runId: context.runId,
      trigger: context.trigger,
      sessionId: context.sessionId,
      event: 'digest.stage.end',
      stage: 'digest',
      durationMs: Date.now() - scanStartedAt,
      meta: {
        stage: 'scan_sessions',
        sessionsScanned: sessionFiles.length,
      },
    });

    if (sessionFiles.length === 0) {
      console.log('No session logs directory');
      status = 'skipped';
      skipReason = 'no_sessions';
      summary.digest.durationMs = Date.now() - digestStageStartedAt;
      return;
    }

    let processedCount = summary.digest.sessionsProcessed;
    let totalFacts = summary.digest.totalFacts;
    let totalEntities = summary.digest.totalEntities;
    let lockedCount = summary.digest.sessionsLocked;
    const digestSessionsStartedAt = Date.now();

    for (const sessionPath of sessionFiles) {
      try {
        const result = await orchestrateSession({
          sessionPath,
          llmCaller: runExtractPrompt,
          extractSystemPrompt: EXTRACT_SYSTEM_PROMPT,
          extractUserPromptTemplate: EXTRACT_USER_PROMPT,
          consolidateSystemPrompt: CONSOLIDATE_SYSTEM_PROMPT,
          consolidateUserPromptTemplate: CONSOLIDATE_USER_PROMPT,
          noConsolidate: parsed.noConsolidate,
          force: parsed.force,
        });

        if (!result.processed) {
          if (result.reason === 'locked') lockedCount++;
          continue;
        }

        processedCount++;
        totalFacts += result.createdFacts;
        totalEntities += result.createdEntities;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        console.error(`Failed to digest ${sessionPath}: ${message}`);
        errors.push(`digest-session-failed:${message}`);
      }
    }

    summary.digest.sessionsProcessed = processedCount;
    summary.digest.totalFacts = totalFacts;
    summary.digest.totalEntities = totalEntities;
    summary.digest.sessionsLocked = lockedCount;

    await tryAppendEvent(appendPipelineEventFn, {
      ts: nowFn().toISOString(),
      level: 'info',
      runId: context.runId,
      trigger: context.trigger,
      sessionId: context.sessionId,
      event: 'digest.stage.end',
      stage: 'digest',
      durationMs: Date.now() - digestSessionsStartedAt,
      meta: {
        stage: 'digest_sessions',
        sessionsProcessed: processedCount,
        sessionsLocked: lockedCount,
        totalFacts,
        totalEntities,
      },
    });

    if (lockedCount > 0 && processedCount === 0) {
      console.log('All sessions locked — skipping');
      status = 'skipped';
      skipReason = 'all_locked';
      summary.digest.durationMs = Date.now() - digestStageStartedAt;
      return;
    }

    if (processedCount === 0) {
      console.log('No changes to digest');
      status = 'skipped';
      skipReason = 'no_changes';
      summary.digest.durationMs = Date.now() - digestStageStartedAt;
      return;
    }

    console.log(`Extracted ${totalFacts} facts, ${totalEntities} new entities from ${processedCount} session(s)`);

    const vectorStartedAt = Date.now();
    summary.vectorSync.attempted = true;
    try {
      const vec = await syncVectorsFn({ force: false, verbose: false });
      summary.vectorSync.added = vec.added;
      summary.vectorSync.updated = vec.updated;
      summary.vectorSync.deleted = vec.deleted;
      summary.vectorSync.unchanged = vec.unchanged;
      console.log(`Vector index synced (${vec.added} added, ${vec.updated} updated)`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`Vector sync warning: ${message}`);
      summary.vectorSync.error = message;
      warnings.push(`vector-sync:${message}`);
    } finally {
      summary.vectorSync.durationMs = Date.now() - vectorStartedAt;
      try {
        await disposeEmbedder();
      } catch {
        // Best effort.
      }
      await tryAppendEvent(appendPipelineEventFn, {
        ts: nowFn().toISOString(),
        level: summary.vectorSync.error ? 'warn' : 'info',
        runId: context.runId,
        trigger: context.trigger,
        sessionId: context.sessionId,
        event: 'digest.stage.end',
        stage: 'vector',
        durationMs: summary.vectorSync.durationMs,
        meta: {
          stage: 'vector_sync',
          attempted: true,
          added: summary.vectorSync.added,
          updated: summary.vectorSync.updated,
          deleted: summary.vectorSync.deleted,
          unchanged: summary.vectorSync.unchanged,
        },
        ...(summary.vectorSync.error ? { error: summary.vectorSync.error } : {}),
      });
    }

    if (!parsed.noCurate) {
      const curateStartedAt = Date.now();
      summary.curate.attempted = true;
      try {
        const graph = await loadGraphState();
        summary.curate.dirtyEntities = graph.dirtyEntities.length;

        if (graph.dirtyEntities.length > 0) {
          const curateResult = await runCurateFn([]);
          summary.curate.refreshed = curateResult.phase1?.refreshed ?? 0;
          summary.curate.memoryUpdated = curateResult.phase2?.updated ?? false;
          summary.curate.error = curateResult.phase1?.error ?? curateResult.phase2?.error ?? null;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        summary.curate.error = message;
        console.error(`Curate warning: ${message}`);
      } finally {
        summary.curate.durationMs = Date.now() - curateStartedAt;
        if (summary.curate.error) warnings.push(`curate:${summary.curate.error}`);
        await tryAppendEvent(appendPipelineEventFn, {
          ts: nowFn().toISOString(),
          level: summary.curate.error ? 'warn' : 'info',
          runId: context.runId,
          trigger: context.trigger,
          sessionId: context.sessionId,
          event: 'digest.stage.end',
          stage: 'curate',
          durationMs: summary.curate.durationMs,
          meta: {
            stage: 'curate',
            attempted: true,
            dirtyEntities: summary.curate.dirtyEntities,
            refreshed: summary.curate.refreshed,
            memoryUpdated: summary.curate.memoryUpdated,
          },
          ...(summary.curate.error ? { error: summary.curate.error } : {}),
        });
      }
    }

    summary.digest.durationMs = Date.now() - digestStageStartedAt;
    status = warnings.length > 0 || errors.length > 0 ? 'partial' : 'success';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    errors.push(message);
    status = 'failed';
    await tryAppendEvent(appendPipelineEventFn, {
      ts: nowFn().toISOString(),
      level: 'error',
      runId: context.runId,
      trigger: context.trigger,
      sessionId: context.sessionId,
      event: 'digest.error',
      stage: 'digest',
      error: message,
    });
    throw error;
  } finally {
    if (gotRunLock) {
      await releasePidLock(digestRunLockPath);
    }

    summary.status = status;
    summary.skipReason = skipReason;
    summary.completedAt = nowFn().toISOString();
    summary.durationMs = Date.parse(summary.completedAt) - Date.parse(summary.startedAt);

    if (status === 'skipped') {
      await tryAppendEvent(appendPipelineEventFn, {
        ts: nowFn().toISOString(),
        level: 'info',
        runId: context.runId,
        trigger: context.trigger,
        sessionId: context.sessionId,
        event: 'digest.skip',
        stage: 'digest',
        meta: { skipReason: skipReason ?? 'unknown' },
      });
    } else {
      await tryAppendEvent(appendPipelineEventFn, {
        ts: nowFn().toISOString(),
        level: status === 'failed' ? 'error' : (status === 'partial' ? 'warn' : 'info'),
        runId: context.runId,
        trigger: context.trigger,
        sessionId: context.sessionId,
        event: 'digest.end',
        stage: 'digest',
        durationMs: summary.durationMs,
        meta: { status },
      });
    }

    await tryAppendSummary(appendHookRunSummaryFn, summary);
    try {
      await releaseClaimedContextFn(claimedPath);
    } catch {
      // Best effort cleanup.
    }
  }
};
