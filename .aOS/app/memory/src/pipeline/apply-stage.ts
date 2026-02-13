import { appendDailyNote, resolveDailyNotesDir } from '../knowledge/daily-notes';
import {
  createEntity,
  entityExists,
  resolveEntityDir,
} from '../knowledge/entities';
import { applyPlan } from '../knowledge/apply';
import { markEntityDirty } from '../knowledge/state';
import { isValidBucket, type ExtractionResult, type ParaBucket } from '../knowledge/types';

import type { EntityConsolidationPlan } from './consolidate-stage';

export interface ApplyStageResult {
  createdFacts: number;
  createdEntities: number;
  createdFactIds: Array<{ entityPath: string; factId: string }>;
}

const inferEntityName = (entityPath: string): string =>
  entityPath.split('/').pop() ?? 'unknown';

const inferBucket = (entityPath: string): ParaBucket =>
  (entityPath.split('/')[0] ?? 'resources') as ParaBucket;

export const runApplyStage = async (options: {
  extraction: ExtractionResult;
  plans: EntityConsolidationPlan[];
  sessionId: string;
  sessionDate: string;
  memoryRoot?: string;
  contextRoot?: string;
}): Promise<ApplyStageResult> => {
  const {
    extraction,
    plans,
    sessionId,
    sessionDate,
    memoryRoot,
    contextRoot,
  } = options;

  let createdEntities = 0;
  let createdFacts = 0;
  const createdFactIds: Array<{ entityPath: string; factId: string }> = [];
  const touchedEntities = new Set<string>();

  for (const entity of extraction.newEntities) {
    const exists = await entityExists(entity.path, contextRoot);
    if (exists) continue;
    await createEntity({ ...entity, contextRoot });
    createdEntities++;
  }

  for (const plan of plans) {
    const bucket = plan.entityPath.split('/')[0] ?? '';
    if (!isValidBucket(bucket)) continue;

    const exists = await entityExists(plan.entityPath, contextRoot);
    if (!exists) {
      await createEntity({
        path: plan.entityPath,
        name: inferEntityName(plan.entityPath),
        type: 'auto',
        bucket: inferBucket(plan.entityPath),
        contextRoot,
      });
      createdEntities++;
    }

    const entityDir = resolveEntityDir(plan.entityPath, contextRoot);
    const applied = await applyPlan({
      entityDir,
      entityPath: plan.entityPath,
      source: sessionId,
      candidates: plan.candidates,
      decisions: plan.decisions,
    });

    createdFacts += applied.newFactIds.length;
    for (const factId of applied.newFactIds) {
      createdFactIds.push({ entityPath: plan.entityPath, factId });
    }
    touchedEntities.add(plan.entityPath);
  }

  for (const entityPath of touchedEntities) {
    await markEntityDirty(entityPath, memoryRoot);
  }

  if (extraction.sessionSummary || extraction.facts.length > 0) {
    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const entityFactCounts: Record<string, number> = {};
    for (const { entityPath } of createdFactIds) {
      entityFactCounts[entityPath] = (entityFactCounts[entityPath] ?? 0) + 1;
    }

    await appendDailyNote({
      ...(memoryRoot ? { dir: resolveDailyNotesDir(memoryRoot) } : {}),
      date: sessionDate,
      sessionId,
      time,
      summary: extraction.sessionSummary || '(No summary extracted)',
      factCount: extraction.facts.length,
      entityPaths: [...touchedEntities],
      entityFactCounts,
      decisions: extraction.decisions,
      lessons: extraction.lessons,
    });
  }

  return {
    createdEntities,
    createdFacts,
    createdFactIds,
  };
};
