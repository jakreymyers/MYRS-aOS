import type { ExtractionResult } from '../knowledge/types';
import { isValidBucket } from '../knowledge/types';
import { resolveEntityDir } from '../knowledge/entities';
import { entityExists } from '../knowledge/entities';
import { getActiveFacts } from '../knowledge/facts';
import {
  consolidateEntity,
  type CandidateFact,
  type ConsolidationDecision,
} from '../knowledge/consolidate';

export interface EntityConsolidationPlan {
  entityPath: string;
  candidates: CandidateFact[];
  decisions: ConsolidationDecision[];
  fallbackMode: 'none' | 'parse-fallback';
  invalidDecisions: number;
}

export interface ConsolidateStageResult {
  plans: EntityConsolidationPlan[];
  affectedEntities: string[];
  invalidDecisions: number;
  fallbackCount: number;
}

export const runConsolidateStage = async (options: {
  extraction: ExtractionResult;
  sessionDate: string;
  llmCaller: (prompt: string) => Promise<string>;
  consolidateSystemPrompt?: string;
  consolidateUserPromptTemplate?: string;
  noConsolidate?: boolean;
  contextRoot?: string;
}): Promise<ConsolidateStageResult> => {
  const {
    extraction,
    sessionDate,
    llmCaller,
    consolidateSystemPrompt,
    consolidateUserPromptTemplate,
    noConsolidate = false,
    contextRoot,
  } = options;

  const grouped = new Map<string, CandidateFact[]>();

  for (const row of extraction.facts) {
    const bucket = row.entityPath.split('/')[0] ?? '';
    if (!isValidBucket(bucket)) continue;

    const arr = grouped.get(row.entityPath) ?? [];
    arr.push({
      fact: row.fact.fact,
      category: row.fact.category,
      importance: row.fact.importance,
      timestamp: row.fact.timestamp,
      relatedEntities: row.fact.relatedEntities,
    });
    grouped.set(row.entityPath, arr);
  }

  const plans: EntityConsolidationPlan[] = [];
  let invalidDecisions = 0;
  let fallbackCount = 0;

  for (const [entityPath, candidates] of grouped) {
    if (noConsolidate || !consolidateSystemPrompt || !consolidateUserPromptTemplate) {
      plans.push({
        entityPath,
        candidates,
        decisions: candidates.map((_, candidateIndex) => ({ candidateIndex, action: 'create' as const })),
        fallbackMode: 'none',
        invalidDecisions: 0,
      });
      continue;
    }

    const dir = resolveEntityDir(entityPath, contextRoot);
    const exists = await entityExists(entityPath, contextRoot);
    const existingFacts = exists ? await getActiveFacts(dir) : [];

    const consolidated = await consolidateEntity({
      entityPath,
      existingFacts,
      candidates,
      llmCaller,
      systemPrompt: consolidateSystemPrompt,
      userPromptTemplate: consolidateUserPromptTemplate,
      today: sessionDate,
    });

    plans.push({
      entityPath,
      candidates,
      decisions: consolidated.decisions,
      fallbackMode: consolidated.fallbackMode,
      invalidDecisions: consolidated.invalidDecisions,
    });
    invalidDecisions += consolidated.invalidDecisions;
    if (consolidated.fallbackMode !== 'none') fallbackCount++;
  }

  return {
    plans,
    affectedEntities: [...grouped.keys()],
    invalidDecisions,
    fallbackCount,
  };
};
