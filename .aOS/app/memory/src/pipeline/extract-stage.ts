import { basename } from 'node:path';
import type { SessionMessage } from '../types';
import type { ExtractionResult } from '../knowledge/types';
import { readSessionMessages } from '../session/logs';
import { listEntities } from '../knowledge/entities';
import { extractFromMessages, type ExtractLlmCaller } from '../knowledge/extract';

export interface ExtractStageResult {
  sessionId: string;
  date: string;
  messages: SessionMessage[];
  extraction: ExtractionResult;
  extractionMode: 'full' | 'delta';
  totalMessages: number;
}

const isValidBoundary = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const runExtractStage = async (options: {
  sessionPath: string;
  llmCaller: ExtractLlmCaller;
  extractSystemPrompt: string;
  extractUserPromptTemplate: string;
  digestedMessageCount?: number | null;
  previousSummary?: string | null;
  force?: boolean;
  contextRoot?: string;
}): Promise<ExtractStageResult | null> => {
  const {
    sessionPath,
    llmCaller,
    extractSystemPrompt,
    extractUserPromptTemplate,
    digestedMessageCount = null,
    previousSummary = null,
    force = false,
    contextRoot,
  } = options;

  const sessionId = basename(sessionPath, '.jsonl');
  const allMessages = await readSessionMessages(sessionPath, sessionId);
  if (allMessages.length === 0) return null;

  let extractionMode: 'full' | 'delta' = 'full';
  let messages = allMessages;
  let previousSummaryForPrompt: string | null = null;

  if (!force && isValidBoundary(digestedMessageCount)) {
    if (digestedMessageCount >= allMessages.length) {
      // stale/rewritten boundary: full extraction fallback
      extractionMode = 'full';
      messages = allMessages;
      previousSummaryForPrompt = null;
    } else {
      extractionMode = 'delta';
      messages = allMessages.slice(digestedMessageCount);
      previousSummaryForPrompt = previousSummary;
    }
  }

  if (messages.length === 0) {
    return null;
  }

  const entities = await listEntities({ contextRoot });
  const entityList = entities
    .map((entity) => `${entity.path} (${entity.type}, ${entity.factCount} facts)`)
    .join('\n');

  const date = messages[0]?.timestamp
    ? new Date(messages[0].timestamp).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const transcriptLabel = extractionMode === 'delta'
    ? 'New messages since last extraction'
    : 'Session transcript';

  let extraction = await extractFromMessages({
    messages,
    entityList,
    date,
    sessionId,
    llmCaller,
    systemPrompt: extractSystemPrompt,
    userPromptTemplate: extractUserPromptTemplate,
    previousSummary: previousSummaryForPrompt,
    transcriptLabel,
  });

  // One bounded retry path: if mixed-role slice yields zero facts, retry user-only.
  if (extraction.facts.length === 0) {
    const userOnly = messages.filter((message) => message.role === 'user');
    const hasMixedRoles = userOnly.length > 0 && userOnly.length < messages.length;
    if (hasMixedRoles) {
      const retry = await extractFromMessages({
        messages: userOnly,
        entityList,
        date,
        sessionId,
        llmCaller,
        systemPrompt: extractSystemPrompt,
        userPromptTemplate: extractUserPromptTemplate,
        previousSummary: previousSummaryForPrompt,
        transcriptLabel: `${transcriptLabel} (user-only retry)`,
      });

      if (retry.facts.length > 0) {
        extraction = retry;
      }
    }
  }

  return {
    sessionId,
    date,
    messages,
    extraction,
    extractionMode,
    totalMessages: allMessages.length,
  };
};
