import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { runExtraction } from '../knowledge/extract';
import { readSessionMessages } from '../session/logs';
import { resolveSessionLogDir } from '../utils/paths';
import { loadState } from '../session/state';
import { runExtractPrompt } from '../llm/claude';
import { EXTRACT_SYSTEM_PROMPT, EXTRACT_USER_PROMPT } from '../llm/prompts';

/**
 * CLI: memory extract [session-id] | memory extract --backfill
 *
 * Extract atomic facts from session logs into the knowledge graph.
 */
export const runExtractCmd = async (args: string[]): Promise<void> => {
  const backfill = args.includes('--backfill');
  const sessionId = args.find((a) => !a.startsWith('-'));

  if (backfill) {
    await runBackfill();
    return;
  }

  if (sessionId) {
    await extractSession(sessionId);
    return;
  }

  // Default: extract all undigested sessions
  await extractUndigested();
};

const extractSession = async (sessionId: string): Promise<void> => {
  const sessionDir = resolveSessionLogDir();
  const filePath = join(sessionDir, `${sessionId}.jsonl`);

  try {
    const messages = await readSessionMessages(filePath, sessionId);
    if (messages.length === 0) {
      console.log(`No messages found in session ${sessionId}`);
      return;
    }

    const date = messages[0].timestamp
      ? new Date(messages[0].timestamp).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const result = await runExtraction({
      messages,
      date,
      sessionId,
      llmCaller: runExtractPrompt,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userPromptTemplate: EXTRACT_USER_PROMPT,
    });

    console.log(`Extracted ${result.facts.length} facts, ${result.newEntities.length} new entities from session ${sessionId.slice(0, 8)}`);
  } catch (error: any) {
    console.error(`Extract failed: ${error?.message ?? 'unknown error'}`);
    process.exitCode = 1;
  }
};

const extractUndigested = async (): Promise<void> => {
  const state = await loadState();
  const undigested = Object.entries(state.sessions)
    .filter(([, s]) => !s.digestedAt)
    .map(([path]) => basename(path, '.jsonl'));

  if (undigested.length === 0) {
    console.log('No undigested sessions');
    return;
  }

  let totalFacts = 0;
  let totalEntities = 0;

  for (const sid of undigested) {
    try {
      const filePath = join(resolveSessionLogDir(), `${sid}.jsonl`);
      const messages = await readSessionMessages(filePath, sid);
      if (messages.length === 0) continue;

      const date = messages[0].timestamp
        ? new Date(messages[0].timestamp).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const result = await runExtraction({
        messages,
        date,
        sessionId: sid,
        llmCaller: runExtractPrompt,
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        userPromptTemplate: EXTRACT_USER_PROMPT,
      });

      totalFacts += result.facts.length;
      totalEntities += result.newEntities.length;
    } catch (error: any) {
      console.error(`Failed to extract session ${sid.slice(0, 8)}: ${error?.message ?? 'unknown'}`);
    }
  }

  console.log(`Extracted ${totalFacts} facts, ${totalEntities} new entities from ${undigested.length} session(s)`);
};

const runBackfill = async (): Promise<void> => {
  const sessionDir = resolveSessionLogDir();
  let files: string[];
  try {
    const entries = await readdir(sessionDir);
    files = entries.filter((f) => f.endsWith('.jsonl'));
  } catch {
    console.log('No session logs to backfill');
    return;
  }

  let totalFacts = 0;
  let totalEntities = 0;

  for (const file of files) {
    const sid = basename(file, '.jsonl');
    try {
      const filePath = join(sessionDir, file);
      const messages = await readSessionMessages(filePath, sid);
      if (messages.length === 0) continue;

      const date = messages[0].timestamp
        ? new Date(messages[0].timestamp).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const result = await runExtraction({
        messages,
        date,
        sessionId: sid,
        llmCaller: runExtractPrompt,
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        userPromptTemplate: EXTRACT_USER_PROMPT,
      });

      totalFacts += result.facts.length;
      totalEntities += result.newEntities.length;
    } catch (error: any) {
      console.error(`Failed to backfill ${sid.slice(0, 8)}: ${error?.message ?? 'unknown'}`);
    }
  }

  console.log(`Backfill: extracted ${totalFacts} facts, ${totalEntities} new entities from ${files.length} session(s)`);
};
