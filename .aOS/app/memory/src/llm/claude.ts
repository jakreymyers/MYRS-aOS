import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Run an LLM prompt and return the result string.
 * Used by the curate command for MEMORY.md generation (Sonnet).
 */
export const runPrompt = async (prompt: string): Promise<string> => {
  const result = await unstable_v2_prompt(prompt, {
    model: process.env.CLAUDE_MODEL ?? DEFAULT_MODEL,
  });

  if ('result' in result) {
    return result.result?.toString() ?? '';
  }
  return '';
};

/**
 * Run an extraction/summarization prompt using Haiku for speed/cost.
 * Used by the knowledge graph extraction pipeline.
 */
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const runExtractPrompt = async (prompt: string): Promise<string> => {
  const model = process.env.EXTRACT_MODEL ?? HAIKU_MODEL;
  const result = await unstable_v2_prompt(prompt, { model });

  if ('result' in result) {
    return result.result?.toString() ?? '';
  }
  return '';
};
