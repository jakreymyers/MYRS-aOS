import type { SessionMessage } from '../types';
import type { ExtractionResult, FactCategory, ParaBucket } from './types';
import { isValidBucket, isValidCategory } from './types';
import { fillPrompt } from '../llm/prompts';

export type ExtractLlmCaller = (prompt: string) => Promise<string>;

const KEBAB_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Derive entity type from PARA path when LLM provides unknown/auto/missing. */
const inferTypeFromPath = (path: string): string => {
  const parts = path.split('/');
  if (parts[0] === 'people') return 'person';
  if (parts[0] === 'projects') return 'project';
  if (parts[0] === 'resources') return 'topic';
  if (parts[0] === 'archives') return 'archive';
  if (parts[0] === 'areas') {
    if (parts[1] === 'companies') return 'company';
    if (parts[1] === 'departments') return 'department';
    if (parts[1] === 'teams') return 'team';
    return 'area';
  }
  return 'unknown';
};

const isValidEntityPath = (path: string): boolean => {
  const parts = path.split('/');
  if (parts.length < 2 || parts.length > 3) return false;
  if (parts.some((part) => part.length === 0)) return false;
  if (!isValidBucket(parts[0] ?? '')) return false;
  if (!parts.slice(1).every((part) => KEBAB_SEGMENT.test(part))) return false;
  if (parts[0] === 'people' && parts.length !== 2) return false;
  if (parts[0] === 'areas' && parts[1] === 'people') return false;
  return true;
};

const parseImportance = (value: unknown): 1 | 2 | 3 =>
  value === 2 || value === 3 ? value : 1;

const asRecord = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object') ? value as Record<string, unknown> : {};

const truncateWords = (input: string, maxWords: number): string => {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return input.trim();
  return `${words.slice(0, maxWords).join(' ')} ...`;
};

/**
 * Parse an extraction response from the LLM.
 * Tries multiple strategies: direct parse -> strip fences -> regex extract -> empty fallback.
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
  return { facts: [], newEntities: [], sessionSummary: '', decisions: [], lessons: [] };
};

/**
 * Validate and normalize the parsed extraction result.
 */
const validateExtraction = (parsed: unknown): ExtractionResult => {
  const row = asRecord(parsed);
  const facts = Array.isArray(row.facts) ? row.facts : [];
  const newEntities = Array.isArray(row.newEntities) ? row.newEntities : [];
  const sessionSummary = typeof row.sessionSummary === 'string' ? row.sessionSummary : '';
  const decisions = Array.isArray(row.decisions)
    ? row.decisions.filter((d: unknown): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];
  const lessons = Array.isArray(row.lessons)
    ? row.lessons.filter((l: unknown): l is string => typeof l === 'string' && l.trim().length > 0)
    : [];

  return {
    facts: facts
      .map((item) => asRecord(item))
      .filter((f) =>
        typeof f.entityPath === 'string'
        && typeof f.fact === 'string'
        && f.fact.trim().length > 0
        && isValidEntityPath(f.entityPath)
      ).map((f) => ({
        entityPath: String(f.entityPath),
        fact: {
          fact: String(f.fact),
          category: isValidCategory(String(f.category ?? '')) ? String(f.category) as FactCategory : 'context',
          importance: parseImportance(f.importance),
          timestamp: typeof f.timestamp === 'string' ? f.timestamp : new Date().toISOString().slice(0, 16),
          source: typeof f.source === 'string' ? f.source : new Date().toISOString().slice(0, 16),
          status: (f.status === 'active' || f.status === 'superseded') ? f.status : 'active',
          supersededBy: null,
          relatedEntities: Array.isArray(f.relatedEntities)
            ? f.relatedEntities.filter((r: unknown): r is string => typeof r === 'string' && isValidEntityPath(r))
            : [],
        },
      })),
    newEntities: newEntities
      .map((item) => asRecord(item))
      .filter((e) =>
        typeof e.path === 'string'
        && typeof e.name === 'string'
        && isValidEntityPath(e.path)
      ).map((e) => {
        const path = String(e.path);
        const rawType = typeof e.type === 'string' ? e.type : '';
        const type = (rawType && rawType !== 'unknown' && rawType !== 'auto') ? rawType : inferTypeFromPath(path);
        return {
          path,
          name: String(e.name),
          type,
          bucket: (typeof e.bucket === 'string' ? e.bucket : path.split('/')[0] ?? 'resources') as ParaBucket,
          tags: Array.isArray(e.tags) ? e.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
        };
      }),
    sessionSummary,
    decisions,
    lessons,
  };
};

/**
 * Core extraction from messages. No I/O - returns structured extraction result.
 */
export const extractFromMessages = async (options: {
  messages: SessionMessage[];
  entityList: string;
  date: string;
  sessionId: string;
  llmCaller: ExtractLlmCaller;
  systemPrompt: string;
  userPromptTemplate: string;
  previousSummary?: string | null;
  transcriptLabel?: string;
}): Promise<ExtractionResult> => {
  const {
    messages,
    entityList,
    date,
    sessionId,
    llmCaller,
    systemPrompt,
    userPromptTemplate,
    previousSummary = null,
    transcriptLabel = 'Session transcript',
  } = options;

  const combined = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const summaryForPrompt = previousSummary && previousSummary.trim().length > 0
    ? truncateWords(previousSummary, 500)
    : '(none - first extraction for this session)';

  const userPrompt = fillPrompt(userPromptTemplate, {
    date,
    session_id: sessionId,
    entity_list: entityList || '(none)',
    previous_summary: summaryForPrompt,
    transcript_label: transcriptLabel,
    messages: combined,
  });

  const prompt = `${systemPrompt}\n\n${userPrompt}`;
  const raw = await llmCaller(prompt);
  const result = parseExtractionResponse(raw);

  // Post-parse normalization: source -> session UUID
  for (const entry of result.facts) {
    entry.fact.source = sessionId;
    entry.fact.supersededBy = null;
  }

  return result;
};
