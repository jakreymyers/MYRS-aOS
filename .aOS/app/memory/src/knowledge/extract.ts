import type { SessionMessage } from '../types';
import type { ExtractionResult, ParaBucket } from './types';
import { isValidBucket } from './types';
import { listEntities, createEntity, entityExists } from './entities';
import { addFact } from './facts';
import { markEntityDirty } from './state';
import { appendDailyNote } from './daily-notes';
import { fillPrompt } from '../llm/prompts';

export type ExtractLlmCaller = (prompt: string) => Promise<string>;

/**
 * Parse an extraction response from the LLM.
 * Tries multiple strategies: direct parse → strip fences → regex extract → empty fallback.
 */
export const parseExtractionResponse = (raw: string): ExtractionResult => {
  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(raw.trim());
    return validateExtraction(parsed);
  } catch {
    // Continue
  }

  // Strategy 2: Strip markdown fences
  const stripped = raw.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    return validateExtraction(parsed);
  } catch {
    // Continue
  }

  // Strategy 3: Regex extract first JSON object
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateExtraction(parsed);
    } catch {
      // Continue
    }
  }

  // Strategy 4: Empty fallback
  return { facts: [], newEntities: [], sessionSummary: '' };
};

/**
 * Validate and normalize the parsed extraction result.
 */
const validateExtraction = (parsed: any): ExtractionResult => {
  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const newEntities = Array.isArray(parsed.newEntities) ? parsed.newEntities : [];
  const sessionSummary = typeof parsed.sessionSummary === 'string' ? parsed.sessionSummary : '';

  return {
    facts: facts.filter((f: any) =>
      typeof f.entityPath === 'string' &&
      typeof f.fact === 'string' &&
      f.fact.trim().length > 0 &&
      isValidBucket(f.entityPath.split('/')[0] ?? '')
    ).map((f: any) => ({
      entityPath: f.entityPath,
      fact: {
        fact: f.fact,
        category: f.category ?? 'context',
        timestamp: f.timestamp ?? new Date().toISOString().slice(0, 10),
        source: f.source ?? new Date().toISOString().slice(0, 10),
        status: f.status ?? 'active',
        supersededBy: f.supersededBy ?? null,
        relatedEntities: Array.isArray(f.relatedEntities) ? f.relatedEntities.filter(
          (r: any) => typeof r === 'string' && isValidBucket(r.split('/')[0] ?? '')
        ) : [],
      },
    })),
    newEntities: newEntities.filter((e: any) =>
      typeof e.path === 'string' &&
      typeof e.name === 'string' &&
      isValidBucket(e.path.split('/')[0] ?? '')
    ).map((e: any) => ({
      path: e.path,
      name: e.name,
      type: e.type ?? 'unknown',
      bucket: (e.bucket ?? e.path.split('/')[0] ?? 'resources') as ParaBucket,
      tags: Array.isArray(e.tags) ? e.tags : [],
    })),
    sessionSummary,
  };
};

/**
 * Core extraction from messages. No I/O — returns structured extraction result.
 */
export const extractFromMessages = async (options: {
  messages: SessionMessage[];
  entityList: string;
  date: string;
  sessionId: string;
  llmCaller: ExtractLlmCaller;
  systemPrompt: string;
  userPromptTemplate: string;
}): Promise<ExtractionResult> => {
  const { messages, entityList, date, sessionId, llmCaller, systemPrompt, userPromptTemplate } = options;

  const combined = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const userPrompt = fillPrompt(userPromptTemplate, {
    date,
    session_id: sessionId,
    entity_list: entityList || '(none)',
    messages: combined,
  });

  const prompt = `${systemPrompt}\n\n${userPrompt}`;
  const raw = await llmCaller(prompt);
  return parseExtractionResponse(raw);
};

/**
 * Full extraction orchestrator: list entities → call LLM → create entities → store facts → mark dirty → append daily note.
 */
export const runExtraction = async (options: {
  messages: SessionMessage[];
  date: string;
  sessionId: string;
  llmCaller: ExtractLlmCaller;
  systemPrompt: string;
  userPromptTemplate: string;
  contextRoot?: string;
  memoryRoot?: string;
}): Promise<ExtractionResult> => {
  const { messages, date, sessionId, llmCaller, systemPrompt, userPromptTemplate, contextRoot, memoryRoot } = options;

  // 1. Build entity list for context
  const entities = await listEntities({ contextRoot });
  const entityList = entities
    .map((e) => `${e.path} (${e.type}, ${e.factCount} facts)`)
    .join('\n');

  // 2. Extract via LLM
  const result = await extractFromMessages({
    messages,
    entityList,
    date,
    sessionId,
    llmCaller,
    systemPrompt,
    userPromptTemplate,
  });

  // 3. Create new entities
  for (const entity of result.newEntities) {
    const exists = await entityExists(entity.path, contextRoot);
    if (!exists) {
      await createEntity({ ...entity, contextRoot });
    }
  }

  // 4. Store facts into entity directories
  const { resolveEntityDir } = await import('./entities');
  const affectedEntities = new Set<string>();

  for (const { entityPath, fact } of result.facts) {
    const bucket = entityPath.split('/')[0] ?? '';
    if (!isValidBucket(bucket)) continue; // Skip invalid paths

    const exists = await entityExists(entityPath, contextRoot);
    if (!exists) {
      const name = entityPath.split('/').pop() ?? 'unknown';
      await createEntity({ path: entityPath, name, type: 'auto', bucket: bucket as ParaBucket, contextRoot });
    }

    const dir = resolveEntityDir(entityPath, contextRoot);
    await addFact(dir, fact);
    affectedEntities.add(entityPath);
  }

  // 5. Mark affected entities as dirty
  for (const path of affectedEntities) {
    await markEntityDirty(path, memoryRoot);
  }

  // 6. Append daily note
  if (result.sessionSummary || result.facts.length > 0) {
    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    await appendDailyNote({
      date,
      sessionId,
      time,
      summary: result.sessionSummary || '(No summary extracted)',
      factCount: result.facts.length,
      entityPaths: [...affectedEntities],
      ...(memoryRoot ? { dir: undefined } : {}),
    });
  }

  return result;
};
