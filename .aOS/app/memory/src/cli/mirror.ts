import { syncCurrentSession, syncSession, getCurrentSessionId } from '../session/logger';
import { updateSession, loadState } from '../session/state';
import { hashContent } from '../utils/hash';
import { readFile } from 'node:fs/promises';
import { resolveSessionLogDir } from '../utils/paths';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appendPipelineEvent,
  normalizeHookTrigger,
  writeRunContext,
  type HookTrigger,
  type PipelineEvent,
  type PipelineRunContext,
} from '../pipeline/observability';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
};

interface MirrorDeps {
  readStdinFn?: () => Promise<string>;
  isStdinTtyFn?: () => boolean;
  syncCurrentSessionFn?: typeof syncCurrentSession;
  getCurrentSessionIdFn?: typeof getCurrentSessionId;
  syncSessionFn?: typeof syncSession;
  nowFn?: () => Date;
  randomIdFn?: () => string;
  appendPipelineEventFn?: (event: PipelineEvent) => Promise<void>;
  writeRunContextFn?: (context: PipelineRunContext) => Promise<string | void>;
}

const tryAppendEvent = async (
  appendEvent: (event: PipelineEvent) => Promise<void>,
  event: PipelineEvent,
): Promise<void> => {
  try {
    await appendEvent(event);
  } catch {
    // Observability must not break pipeline.
  }
};

/**
 * Mirror the current session log from Claude Code's native logs.
 *
 * Reads session_id from hook input (stdin JSON) if available,
 * otherwise falls back to the most recently modified session.
 *
 * Writes to .aOS/logs/sessions/{UUID}.jsonl (overwrites if exists).
 * Updates session-state.json with content hash metadata.
 */
export const runMirror = async (_args: string[], deps: MirrorDeps = {}): Promise<void> => {
  const readStdinFn = deps.readStdinFn ?? readStdin;
  const isStdinTtyFn = deps.isStdinTtyFn ?? (() => process.stdin.isTTY);
  const syncCurrentSessionFn = deps.syncCurrentSessionFn ?? syncCurrentSession;
  const getCurrentSessionIdFn = deps.getCurrentSessionIdFn ?? getCurrentSessionId;
  const syncSessionFn = deps.syncSessionFn ?? syncSession;
  const nowFn = deps.nowFn ?? (() => new Date());
  const randomIdFn = deps.randomIdFn ?? randomUUID;
  const appendPipelineEventFn = deps.appendPipelineEventFn ?? appendPipelineEvent;
  const writeRunContextFn = deps.writeRunContextFn ?? writeRunContext;

  const mirrorStartedAt = nowFn();
  const runId = randomIdFn();

  // Parse --trigger from CLI args (most reliable source — set in hook command)
  const triggerIdx = _args.indexOf('--trigger');
  const cliTrigger = triggerIdx >= 0 ? normalizeHookTrigger(_args[triggerIdx + 1]) : null;

  let trigger: HookTrigger = cliTrigger ?? (isStdinTtyFn() ? 'manual' : 'unknown');
  let hookSessionId: string | undefined;

  await tryAppendEvent(appendPipelineEventFn, {
    ts: mirrorStartedAt.toISOString(),
    level: 'info',
    runId,
    trigger,
    sessionId: null,
    event: 'mirror.start',
    stage: 'mirror',
  });

  try {
    // Try to read hook input from stdin.
    if (!isStdinTtyFn()) {
      try {
        const input = await readStdinFn();
        if (input.trim()) {
          const hookInput = JSON.parse(input) as Record<string, unknown>;
          if (typeof hookInput.session_id === 'string') {
            hookSessionId = hookInput.session_id;
          }
          if (!cliTrigger && typeof hookInput.hook_event_name === 'string') {
            trigger = normalizeHookTrigger(hookInput.hook_event_name);
          }
        }
      } catch {
        // stdin not available or not JSON — fall back to auto-detection
      }
    }

    let result: { id: string; path: string } | null;

    if (hookSessionId) {
      // Find the source path for this session ID
      const info = await getCurrentSessionIdFn();
      if (info && info.id === hookSessionId) {
        const path = await syncSessionFn(hookSessionId, info.sourcePath);
        result = { id: hookSessionId, path };
      } else {
        // Session ID from hook doesn't match most recent — try to sync most recent anyway
        result = await syncCurrentSessionFn();
      }
    } else {
      result = await syncCurrentSessionFn();
    }

    if (!result) {
      console.error('No session found to mirror');
      process.exitCode = 1;
      await tryAppendEvent(appendPipelineEventFn, {
        ts: nowFn().toISOString(),
        level: 'error',
        runId,
        trigger,
        sessionId: hookSessionId ?? null,
        event: 'mirror.end',
        stage: 'mirror',
        durationMs: nowFn().getTime() - mirrorStartedAt.getTime(),
        error: 'No session found to mirror',
      });
      return;
    }

    // Update session state, preserving digestedAt/digestedHash from prior entry
    const targetPath = join(resolveSessionLogDir(), `${result.id}.jsonl`);
    const content = await readFile(targetPath, 'utf8');
    const state = await loadState();
    const prev = state.sessions[targetPath];

    await updateSession(targetPath, {
      contentHash: hashContent(content),
      digestedAt: prev?.digestedAt ?? null,
      digestedHash: prev?.digestedHash ?? null,
      digestedMessageCount: prev?.digestedMessageCount ?? null,
      sessionSummary: prev?.sessionSummary ?? null,
    });

    const mirrorCompletedAt = nowFn();
    await writeRunContextFn({
      runId,
      trigger,
      sessionId: result.id,
      hookReceivedAt: mirrorStartedAt.toISOString(),
      mirrorStartedAt: mirrorStartedAt.toISOString(),
      mirrorCompletedAt: mirrorCompletedAt.toISOString(),
      mirrorDurationMs: mirrorCompletedAt.getTime() - mirrorStartedAt.getTime(),
      mirrorSuccess: true,
      mirrorError: null,
    });

    await tryAppendEvent(appendPipelineEventFn, {
      ts: mirrorCompletedAt.toISOString(),
      level: 'info',
      runId,
      trigger,
      sessionId: result.id,
      event: 'mirror.end',
      stage: 'mirror',
      durationMs: mirrorCompletedAt.getTime() - mirrorStartedAt.getTime(),
      meta: { success: true },
    });

    console.log(`Mirrored session ${result.id}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`Mirror failed: ${message}`);
    process.exitCode = 1;
    await tryAppendEvent(appendPipelineEventFn, {
      ts: nowFn().toISOString(),
      level: 'error',
      runId,
      trigger,
      sessionId: hookSessionId ?? null,
      event: 'mirror.end',
      stage: 'mirror',
      durationMs: nowFn().getTime() - mirrorStartedAt.getTime(),
      error: message,
      meta: { success: false },
    });
  }
};
