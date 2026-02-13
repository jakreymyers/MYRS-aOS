import { loadFacts, saveFacts } from './facts';
import type { AtomicFact } from './types';
import type { CandidateFact, ConsolidationDecision } from './consolidate';

const normalizeImportance = (value: unknown): 1 | 2 | 3 =>
  value === 2 || value === 3 ? value : 1;

const nextFactId = (facts: AtomicFact[], slug: string): string => {
  const maxNum = facts.reduce((max, f) => {
    const match = f.id.match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${slug}-${String(maxNum + 1).padStart(3, '0')}`;
};

const factSlugFromPath = (entityPath: string): string =>
  entityPath.split('/').pop() ?? 'fact';

const makeFact = (options: {
  id: string;
  source: string;
  candidate: CandidateFact;
  importance: 1 | 2 | 3;
  factText?: string;
  mergedFrom?: string[];
}): AtomicFact => ({
  id: options.id,
  fact: options.factText ?? options.candidate.fact,
  category: options.candidate.category,
  timestamp: options.candidate.timestamp,
  source: options.source,
  status: 'active',
  supersededBy: null,
  relatedEntities: options.candidate.relatedEntities,
  lastAccessed: new Date().toISOString().slice(0, 16),
  accessCount: 1,
  importance: options.importance,
  ...(options.mergedFrom ? { mergedFrom: options.mergedFrom } : {}),
});

export const applyPlan = async (options: {
  entityDir: string;
  entityPath: string;
  source: string;
  candidates: CandidateFact[];
  decisions: ConsolidationDecision[];
}): Promise<{ created: number; merged: number; superseded: number; dropped: number; newFactIds: string[] }> => {
  const { entityDir, entityPath, source, candidates, decisions } = options;

  const facts = await loadFacts(entityDir);
  const slug = factSlugFromPath(entityPath);

  let created = 0;
  let merged = 0;
  let superseded = 0;
  let dropped = 0;
  const newFactIds: string[] = [];

  const sorted = [...decisions].sort((a, b) => a.candidateIndex - b.candidateIndex);

  for (const decision of sorted) {
    const candidate = candidates[decision.candidateIndex];
    if (!candidate) continue;

    if (decision.action === 'drop') {
      dropped++;
      continue;
    }

    if (decision.action === 'create') {
      const id = nextFactId(facts, slug);
      facts.push(makeFact({
        id,
        source,
        candidate,
        importance: normalizeImportance(candidate.importance),
      }));
      created++;
      newFactIds.push(id);
      continue;
    }

    const target = facts.find((fact) => fact.id === decision.targetFactId);
    if (!target) {
      const id = nextFactId(facts, slug);
      facts.push(makeFact({
        id,
        source,
        candidate,
        importance: normalizeImportance(candidate.importance),
      }));
      created++;
      newFactIds.push(id);
      continue;
    }

    const replacementId = nextFactId(facts, slug);
    target.status = 'superseded';
    target.supersededBy = replacementId;

    if (decision.action === 'supersede') {
      const importance = Math.max(
        normalizeImportance(target.importance),
        normalizeImportance(candidate.importance),
      ) as 1 | 2 | 3;

      facts.push(makeFact({
        id: replacementId,
        source,
        candidate,
        importance,
      }));

      superseded++;
      newFactIds.push(replacementId);
      continue;
    }

    const importance = Math.max(
      normalizeImportance(target.importance),
      normalizeImportance(candidate.importance),
      normalizeImportance(decision.importance),
    ) as 1 | 2 | 3;

    facts.push(makeFact({
      id: replacementId,
      source,
      candidate,
      importance,
      factText: decision.fact,
      mergedFrom: [target.id],
    }));

    merged++;
    newFactIds.push(replacementId);
  }

  await saveFacts(entityDir, facts);

  return { created, merged, superseded, dropped, newFactIds };
};
