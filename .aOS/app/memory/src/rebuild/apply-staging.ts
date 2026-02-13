import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AtomicFact } from '../knowledge/types';
import { resolveEntityDir, entityExists } from '../knowledge/entities';
import { saveFacts } from '../knowledge/facts';
import { markEntityDirty } from '../knowledge/state';
import { validateStagingPayload, type StagedEntityPayload, type StagedFactCandidate } from './staging';

export interface ApplyStagingResult {
  entitiesApplied: number;
  factsWritten: number;
  skipped: Array<{ file: string; reason: string }>;
  applied: Array<{ entityPath: string; factCount: number }>;
}

/**
 * Convert staging filename back to entity path.
 * `people__jak-myers.json` → `people/jak-myers`
 * `areas__companies__aps.json` → `areas/companies/aps`
 */
export const filenameToEntityPath = (filename: string): string =>
  filename.replace(/\.json$/, '').replaceAll('__', '/');

/**
 * Derive an entity slug from the entity path (last segment).
 */
const entitySlug = (entityPath: string): string => {
  const parts = entityPath.split('/');
  return parts[parts.length - 1] ?? 'unknown';
};

/**
 * Convert a StagedFactCandidate into an AtomicFact.
 * IDs are generated sequentially: slug-001, slug-002, etc.
 */
const toAtomicFact = (
  candidate: StagedFactCandidate,
  slug: string,
  index: number,
  generatedBy: string,
): AtomicFact => {
  const now = new Date().toISOString().slice(0, 16);
  return {
    id: `${slug}-${String(index + 1).padStart(3, '0')}`,
    fact: candidate.fact,
    category: candidate.category,
    timestamp: candidate.timestamp,
    source: `rebuild:${generatedBy}`,
    status: 'active',
    supersededBy: null,
    relatedEntities: candidate.relatedEntities,
    lastAccessed: now,
    accessCount: 1,
    importance: candidate.importance,
  };
};

/**
 * Apply validated staging payloads from a directory to entity items.json files.
 *
 * - Reads all .json files from stagingDir
 * - Validates each via validateStagingPayload()
 * - Converts StagedFactCandidate → AtomicFact
 * - Writes all facts per entity in one saveFacts() call
 * - Marks each touched entity dirty
 */
export const applyStaging = async (options: {
  stagingDir: string;
  dryRun?: boolean;
  contextRoot?: string;
}): Promise<ApplyStagingResult> => {
  const { stagingDir, dryRun = false, contextRoot } = options;

  const result: ApplyStagingResult = {
    entitiesApplied: 0,
    factsWritten: 0,
    skipped: [],
    applied: [],
  };

  let entries: string[];
  try {
    entries = (await readdir(stagingDir)).filter((name) => name.endsWith('.json')).sort();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    result.skipped.push({ file: stagingDir, reason: `unable to read staging dir: ${message}` });
    return result;
  }

  for (const filename of entries) {
    const filePath = join(stagingDir, filename);
    let raw: unknown;

    try {
      const content = await readFile(filePath, 'utf8');
      raw = JSON.parse(content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'parse error';
      result.skipped.push({ file: filename, reason: message });
      continue;
    }

    const validation = validateStagingPayload(raw);
    if (!validation.valid) {
      result.skipped.push({ file: filename, reason: `validation failed: ${validation.errors.join('; ')}` });
      continue;
    }

    const payload = raw as StagedEntityPayload;
    if (payload.facts.length === 0) {
      result.skipped.push({ file: filename, reason: 'no facts in payload' });
      continue;
    }

    const slug = entitySlug(payload.entityPath);
    const facts: AtomicFact[] = payload.facts.map((candidate, i) =>
      toAtomicFact(candidate, slug, i, payload.generatedBy),
    );

    if (!dryRun) {
      const entityDir = resolveEntityDir(payload.entityPath, contextRoot);
      await saveFacts(entityDir, facts);
      await markEntityDirty(payload.entityPath);
    }

    result.entitiesApplied++;
    result.factsWritten += facts.length;
    result.applied.push({ entityPath: payload.entityPath, factCount: facts.length });
  }

  return result;
};
