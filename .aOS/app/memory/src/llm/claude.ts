import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface PromptCallOptions {
  timeoutMs?: number;
  deadlineAtMs?: number;
}

export interface StageBudget {
  deadlineAtMs: number;
}

export const createStageBudget = (totalMs: number): StageBudget => ({
  deadlineAtMs: Date.now() + totalMs,
});

const getEffectiveTimeout = (options?: PromptCallOptions): number => {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!options?.deadlineAtMs) return timeoutMs;
  const remaining = options.deadlineAtMs - Date.now();
  return Math.max(1, Math.min(timeoutMs, remaining));
};

const runPromptWithTimeout = async (
  prompt: string,
  model: string,
  options?: PromptCallOptions,
): Promise<string> => {
  const timeoutMs = getEffectiveTimeout(options);
  if (timeoutMs <= 0) throw new Error('LLM deadline exceeded before request start');

  const request = unstable_v2_prompt(prompt, { model });
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const result = await Promise.race([request, timeout]);
  if ('result' in result) {
    return result.result?.toString() ?? '';
  }
  return '';
};

/**
 * Run an LLM prompt and return the result string.
 * Used by the curate command for MEMORY.md generation (Sonnet).
 */
export const runPrompt = async (prompt: string, options?: PromptCallOptions): Promise<string> =>
  runPromptWithTimeout(prompt, process.env.CLAUDE_MODEL ?? DEFAULT_MODEL, options);

/**
 * Run an extraction/summarization prompt using Haiku for speed/cost.
 * Used by the knowledge graph extraction pipeline.
 */
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const runExtractPrompt = async (prompt: string, options?: PromptCallOptions): Promise<string> => {
  const model = process.env.EXTRACT_MODEL ?? HAIKU_MODEL;
  return runPromptWithTimeout(prompt, model, options);
};
