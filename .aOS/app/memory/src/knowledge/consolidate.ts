import type { AtomicFact, FactCategory } from './types';
import { fillPrompt } from '../llm/prompts';
import { tierFacts } from './decay';

export interface CandidateFact {
  fact: string;
  category: FactCategory;
  importance: 1 | 2 | 3;
  timestamp: string;
  relatedEntities: string[];
}

export type ConsolidationDecision =
  | { candidateIndex: number; action: 'create' }
  | { candidateIndex: number; action: 'drop'; reason?: string }
  | { candidateIndex: number; action: 'supersede'; targetFactId: string }
  | {
      candidateIndex: number;
      action: 'merge';
      targetFactId: string;
      fact: string;
      importance?: 1 | 2 | 3;
    };

export interface ConsolidationResult {
  decisions: ConsolidationDecision[];
  fallbackMode: 'none' | 'parse-fallback';
  invalidDecisions: number;
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

const textualSimilarity = (left: string, right: string): number => {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }

  return overlap / Math.max(a.size, b.size);
};

export const preFilterFacts = (
  existingFacts: AtomicFact[],
  candidates: CandidateFact[],
  today: string,
): AtomicFact[] => {
  if (existingFacts.length <= 100) return existingFacts;

  const tiered = tierFacts(existingFacts, today);
  const hotWarm = tiered.filter((fact) => fact.tier !== 'cold');
  if (hotWarm.length >= 100) return hotWarm.slice(0, 100);

  const cold = tiered.filter((fact) => fact.tier === 'cold');
  const scoredCold = cold
    .map((fact) => ({
      fact,
      score: candidates.reduce((best, candidate) =>
        Math.max(best, textualSimilarity(fact.fact, candidate.fact)), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.fact);

  return [...hotWarm, ...scoredCold].slice(0, 100);
};

const normalizeImportance = (value: unknown): 1 | 2 | 3 | undefined =>
  value === 2 || value === 3 || value === 1 ? value : undefined;

const createAll = (candidateCount: number): ConsolidationDecision[] =>
  Array.from({ length: candidateCount }, (_, i) => ({ candidateIndex: i, action: 'create' }));

const safeJsonParse = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw.trim());
  } catch {
    // Continue
  }

  const stripped = raw.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Continue
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // Continue
    }
  }

  return null;
};

export const parseConsolidationResponse = (
  raw: string,
  candidateCount: number,
  existingFacts: AtomicFact[],
): { decisions: ConsolidationDecision[]; invalidDecisions: number; parseError: boolean } => {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      decisions: createAll(candidateCount),
      invalidDecisions: candidateCount,
      parseError: true,
    };
  }

  const parsedObj = parsed as Record<string, unknown>;
  const rawDecisions = parsedObj.decisions;
  if (!Array.isArray(rawDecisions)) {
    return {
      decisions: createAll(candidateCount),
      invalidDecisions: candidateCount,
      parseError: true,
    };
  }

  const existingIds = new Set(existingFacts.map((f) => f.id));
  const byCandidate = new Map<number, ConsolidationDecision>();
  let invalidDecisions = 0;

  for (const rawDecision of rawDecisions) {
    if (!rawDecision || typeof rawDecision !== 'object') {
      invalidDecisions++;
      continue;
    }
    const row = rawDecision as Record<string, unknown>;
    const index = Number(row.candidateIndex);
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      invalidDecisions++;
      continue;
    }

    if (byCandidate.has(index)) {
      invalidDecisions++;
      continue;
    }

    const action = row.action;

    if (action === 'create') {
      byCandidate.set(index, { candidateIndex: index, action: 'create' });
      continue;
    }

    if (action === 'drop') {
      byCandidate.set(index, {
        candidateIndex: index,
        action: 'drop',
        ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
      });
      continue;
    }

    if (action === 'supersede') {
      if (typeof row.targetFactId !== 'string' || !existingIds.has(row.targetFactId)) {
        invalidDecisions++;
        byCandidate.set(index, { candidateIndex: index, action: 'create' });
        continue;
      }

      byCandidate.set(index, {
        candidateIndex: index,
        action: 'supersede',
        targetFactId: row.targetFactId,
      });
      continue;
    }

    if (action === 'merge') {
      if (typeof row.targetFactId !== 'string' || !existingIds.has(row.targetFactId)) {
        invalidDecisions++;
        byCandidate.set(index, { candidateIndex: index, action: 'create' });
        continue;
      }

      const mergedFact = typeof row.mergedFact === 'string'
        ? row.mergedFact
        : (typeof row.fact === 'string' ? row.fact : '');

      if (!mergedFact.trim()) {
        invalidDecisions++;
        byCandidate.set(index, { candidateIndex: index, action: 'create' });
        continue;
      }

      byCandidate.set(index, {
        candidateIndex: index,
        action: 'merge',
        targetFactId: row.targetFactId,
        fact: mergedFact.trim(),
        ...(normalizeImportance(row.importance) ? { importance: normalizeImportance(row.importance)! } : {}),
      });
      continue;
    }

    invalidDecisions++;
    byCandidate.set(index, { candidateIndex: index, action: 'create' });
  }

  for (let i = 0; i < candidateCount; i++) {
    if (!byCandidate.has(i)) {
      invalidDecisions++;
      byCandidate.set(i, { candidateIndex: i, action: 'create' });
    }
  }

  return {
    decisions: [...byCandidate.values()].sort((a, b) => a.candidateIndex - b.candidateIndex),
    invalidDecisions,
    parseError: false,
  };
};

const buildExistingFactsBlock = (existing: AtomicFact[]): string =>
  existing
    .map((fact) =>
      `[${fact.id}] "${fact.fact}" (${fact.category}, importance=${fact.importance}, ${fact.timestamp})`,
    )
    .join('\n');

const buildCandidatesBlock = (candidates: CandidateFact[]): string =>
  candidates
    .map((candidate, index) =>
      `[C${index}] "${candidate.fact}" (${candidate.category}, importance=${candidate.importance})`,
    )
    .join('\n');

export const consolidateEntity = async (options: {
  entityPath: string;
  existingFacts: AtomicFact[];
  candidates: CandidateFact[];
  llmCaller: (prompt: string) => Promise<string>;
  systemPrompt: string;
  userPromptTemplate: string;
  today?: string;
}): Promise<ConsolidationResult> => {
  const {
    entityPath,
    existingFacts,
    candidates,
    llmCaller,
    systemPrompt,
    userPromptTemplate,
    today,
  } = options;

  if (candidates.length === 0) {
    return { decisions: [], fallbackMode: 'none', invalidDecisions: 0 };
  }

  const todayDate = today ?? new Date().toISOString().slice(0, 10);
  const filteredExisting = preFilterFacts(existingFacts, candidates, todayDate);

  const userPrompt = fillPrompt(userPromptTemplate, {
    entity_path: entityPath,
    existing_count: String(filteredExisting.length),
    existing_facts_block: buildExistingFactsBlock(filteredExisting),
    candidate_count: String(candidates.length),
    candidates_block: buildCandidatesBlock(candidates),
  });

  const prompt = `${systemPrompt}\n\n${userPrompt}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llmCaller(prompt);
    const parsed = parseConsolidationResponse(raw, candidates.length, existingFacts);
    if (!parsed.parseError) {
      return {
        decisions: parsed.decisions,
        fallbackMode: 'none',
        invalidDecisions: parsed.invalidDecisions,
      };
    }
  }

  return {
    decisions: createAll(candidates.length),
    fallbackMode: 'parse-fallback',
    invalidDecisions: candidates.length,
  };
};
