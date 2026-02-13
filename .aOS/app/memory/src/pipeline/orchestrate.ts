import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { hashContent } from '../utils/hash';
import { loadState, mutateSessionState, acquireLock, releaseLock } from '../session/state';
import { runExtractStage } from './extract-stage';
import { runConsolidateStage } from './consolidate-stage';
import { runApplyStage } from './apply-stage';
import { appendPipelineLog } from './log';
import type { ExtractLlmCaller } from '../knowledge/extract';
import { mutateGraphState } from '../knowledge/state';

export interface PipelineRunResult {
  processed: boolean;
  reason?: 'unchanged' | 'empty' | 'locked';
  createdFacts: number;
  createdEntities: number;
  invalidDecisions?: number;
  fallbackCount?: number;
}

export interface PipelineRunHooks {
  afterApply?: () => Promise<void> | void;
}

export interface RunPipelineOptions {
  sessionPath: string;
  llmCaller: ExtractLlmCaller;
  consolidateCaller?: ExtractLlmCaller;
  extractSystemPrompt: string;
  extractUserPromptTemplate: string;
  consolidateSystemPrompt?: string;
  consolidateUserPromptTemplate?: string;
  noConsolidate?: boolean;
  force?: boolean;
  contextRoot?: string;
  memoryRoot?: string;
  hooks?: PipelineRunHooks;
}

export const runPipeline = async (options: RunPipelineOptions): Promise<PipelineRunResult> => {
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const MAX_PIPELINE_MS = 100_000;
  const runId = `${basename(options.sessionPath, '.jsonl')}-${Date.now()}`;
  const stages: Array<{ name: string; ms: number; ok: boolean }> = [];
  const errors: string[] = [];
  let success = false;
  let fallbackMode: string | null = null;
  let droppedFacts = 0;
  let invalidDecisions = 0;
  let result: PipelineRunResult = {
    processed: false,
    reason: 'unchanged',
    createdFacts: 0,
    createdEntities: 0,
  };

  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if ((Date.now() - startedAtMs) > MAX_PIPELINE_MS) {
      throw new Error(`pipeline deadline exceeded before stage: ${name}`);
    }
    const t0 = Date.now();
    try {
      const out = await fn();
      stages.push({ name, ms: Date.now() - t0, ok: true });
      return out;
    } catch (error: unknown) {
      stages.push({ name, ms: Date.now() - t0, ok: false });
      throw error;
    }
  };

  try {
    const content = await stage('load-session', async () => readFile(options.sessionPath, 'utf8'));
    const contentHash = hashContent(content);
    const state = await stage('load-state', async () => loadState());
    const prev = state.sessions[options.sessionPath];

    if (!options.force && prev?.digestedHash === contentHash) {
      result = { processed: false, reason: 'unchanged', createdFacts: 0, createdEntities: 0 };
      success = true;
      return result;
    }

    const extracted = await stage('extract', async () => runExtractStage({
      sessionPath: options.sessionPath,
      llmCaller: options.llmCaller,
      extractSystemPrompt: options.extractSystemPrompt,
      extractUserPromptTemplate: options.extractUserPromptTemplate,
      digestedMessageCount: prev?.digestedMessageCount ?? null,
      previousSummary: prev?.sessionSummary ?? null,
      force: options.force,
      contextRoot: options.contextRoot,
    }));

    if (!extracted) {
      result = { processed: false, reason: 'empty', createdFacts: 0, createdEntities: 0 };
      success = true;
      return result;
    }

    const consolidated = await stage('consolidate', async () => runConsolidateStage({
      extraction: extracted.extraction,
      sessionDate: extracted.date,
      llmCaller: options.consolidateCaller ?? options.llmCaller,
      consolidateSystemPrompt: options.consolidateSystemPrompt,
      consolidateUserPromptTemplate: options.consolidateUserPromptTemplate,
      noConsolidate: options.noConsolidate,
      contextRoot: options.contextRoot,
    }));

    invalidDecisions = consolidated.invalidDecisions;
    fallbackMode = consolidated.fallbackCount > 0 ? 'parse-fallback' : 'none';

    const locked = await stage('acquire-lock', async () => acquireLock());
    if (!locked) {
      result = { processed: false, reason: 'locked', createdFacts: 0, createdEntities: 0 };
      success = true;
      return result;
    }

    try {
      // Double-check hash under lock: another process may have already digested
      // this session while we were extracting/consolidating without the lock.
      const recheckState = await loadState();
      const recheckPrev = recheckState.sessions[options.sessionPath];
      if (!options.force && recheckPrev?.digestedHash === contentHash) {
        result = { processed: false, reason: 'unchanged', createdFacts: 0, createdEntities: 0 };
        success = true;
        return result;
      }

      const applied = await stage('apply', async () => runApplyStage({
        extraction: extracted.extraction,
        plans: consolidated.plans,
        sessionId: extracted.sessionId,
        sessionDate: extracted.date,
        contextRoot: options.contextRoot,
        memoryRoot: options.memoryRoot,
      }));

      droppedFacts = Math.max(0, extracted.extraction.facts.length - applied.createdFacts);

      if (options.hooks?.afterApply) {
        await options.hooks.afterApply();
      }

      const nextSummary = extracted.extraction.sessionSummary.trim().length > 0
        ? extracted.extraction.sessionSummary.trim()
        : (recheckPrev?.sessionSummary ?? prev?.sessionSummary ?? null);

      const now = new Date().toISOString();
      await stage('update-session-state', async () => mutateSessionState(async (next) => {
        next.sessions[options.sessionPath] = {
          contentHash,
          digestedAt: now,
          digestedHash: contentHash,
          digestedMessageCount: extracted.totalMessages,
          sessionSummary: nextSummary,
        };
        next.lastDigest = now;
        return next;
      }));

      await stage('update-graph-state', async () => mutateGraphState(async (next) => {
        next.lastExtraction = now;
        if (consolidated.fallbackCount > 0) {
          next.consolidationFailures += consolidated.fallbackCount;
        }
        return next;
      }, options.memoryRoot));

      result = {
        processed: true,
        createdFacts: applied.createdFacts,
        createdEntities: applied.createdEntities,
        invalidDecisions: consolidated.invalidDecisions,
        fallbackCount: consolidated.fallbackCount,
      };
      success = true;
      return result;
    } finally {
      await stage('release-lock', async () => releaseLock());
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    errors.push(message);
    throw error;
  } finally {
    await appendPipelineLog({
      runId,
      sessionPath: options.sessionPath,
      stages,
      errors,
      fallbackMode,
      droppedFacts,
      invalidDecisions,
      retryCount: 0,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      success,
    });
  }
};
