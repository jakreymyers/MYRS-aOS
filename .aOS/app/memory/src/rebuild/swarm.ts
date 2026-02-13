import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../utils/atomic';
import type { EntityManifestRow } from './manifest';
import { validateStagingPayload, type StagedEntityPayload } from './staging';

export interface SubagentTask {
  entity: EntityManifestRow;
  entityPath: string;
  entityType: string;
  attempt: number;
  maxCalls: number;
  knownEntityPaths?: string[];
}

export interface SubagentTaskResult {
  callCount: number;
  payload: StagedEntityPayload;
}

export interface SubagentRunner {
  runTask(task: SubagentTask): Promise<SubagentTaskResult>;
}

export interface SwarmEntityResult {
  entityPath: string;
  status: 'ok' | 'failed';
  attempts: number;
  stagingFile?: string;
  error?: string;
}

export interface SwarmSummary {
  total: number;
  succeeded: number;
  failed: number;
  retried: number;
  invalidPayloads: number;
  budgetExceeded: number;
}

export interface SwarmRunResult {
  summary: SwarmSummary;
  results: SwarmEntityResult[];
}

const fileNameForEntityPath = (entityPath: string): string =>
  `${entityPath.replaceAll('/', '__')}.json`;

const classifyEntityType = (entity: EntityManifestRow): string =>
  entity.bucket === 'people' ? 'people'
    : entity.bucket === 'projects' ? 'project'
    : entity.bucket === 'areas' ? 'area'
    : entity.bucket === 'resources' ? 'resource'
    : 'archive';

const processEntity = async (options: {
  entity: EntityManifestRow;
  knownEntityPaths: string[];
  stagingDir: string;
  runner: SubagentRunner;
  maxCallsPerEntity: number;
  retryLimit: number;
  dryRun: boolean;
}): Promise<SwarmEntityResult & { retried: number; invalidPayload: boolean; budgetExceeded: boolean }> => {
  const {
    entity,
    knownEntityPaths,
    stagingDir,
    runner,
    maxCallsPerEntity,
    retryLimit,
    dryRun,
  } = options;

  let attempts = 0;
  let retried = 0;
  let invalidPayload = false;
  let budgetExceeded = false;
  let lastError = 'unknown error';

  while (attempts <= retryLimit) {
    attempts++;
    try {
      const out = await runner.runTask({
        entity,
        entityPath: entity.path,
        entityType: classifyEntityType(entity),
        attempt: attempts,
        maxCalls: maxCallsPerEntity,
        knownEntityPaths,
      });

      if (out.callCount > maxCallsPerEntity) {
        budgetExceeded = true;
        throw new Error(`call budget exceeded (${out.callCount} > ${maxCallsPerEntity})`);
      }

      if (out.payload.entityPath !== entity.path) {
        invalidPayload = true;
        throw new Error(`payload entityPath mismatch (${out.payload.entityPath} != ${entity.path})`);
      }

      const validation = validateStagingPayload(out.payload);
      if (!validation.valid) {
        invalidPayload = true;
        throw new Error(`invalid staging payload: ${validation.errors.join('; ')}`);
      }

      const stagingFile = join(stagingDir, fileNameForEntityPath(entity.path));
      if (!dryRun) {
        await atomicWrite(stagingFile, JSON.stringify(out.payload, null, 2) + '\n');
      }

      return {
        entityPath: entity.path,
        status: 'ok',
        attempts,
        stagingFile,
        retried,
        invalidPayload,
        budgetExceeded,
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : 'unknown error';
      if (attempts <= retryLimit) {
        retried++;
        continue;
      }
      break;
    }
  }

  return {
    entityPath: entity.path,
    status: 'failed',
    attempts,
    error: lastError,
    retried,
    invalidPayload,
    budgetExceeded,
  };
};

export const orchestrateSwarmRebuild = async (options: {
  manifest: EntityManifestRow[];
  stagingDir: string;
  runner: SubagentRunner;
  maxConcurrent?: number;
  maxCallsPerEntity?: number;
  retryLimit?: number;
  dryRun?: boolean;
}): Promise<SwarmRunResult> => {
  const {
    manifest,
    stagingDir,
    runner,
    maxConcurrent = 3,
    maxCallsPerEntity = 10,
    retryLimit = 1,
    dryRun = false,
  } = options;

  if (!dryRun) {
    await mkdir(stagingDir, { recursive: true });
  }

  const sorted = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  const knownEntityPaths = sorted.map((row) => row.path);
  const results: SwarmEntityResult[] = new Array(sorted.length);

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrent, sorted.length || 1));
  let retried = 0;
  let invalidPayloads = 0;
  let budgetExceeded = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= sorted.length) break;

      const row = await processEntity({
        entity: sorted[index],
        knownEntityPaths,
        stagingDir,
        runner,
        maxCallsPerEntity,
        retryLimit,
        dryRun,
      });

      retried += row.retried;
      if (row.invalidPayload) invalidPayloads++;
      if (row.budgetExceeded) budgetExceeded++;
      results[index] = {
        entityPath: row.entityPath,
        status: row.status,
        attempts: row.attempts,
        ...(row.stagingFile ? { stagingFile: row.stagingFile } : {}),
        ...(row.error ? { error: row.error } : {}),
      };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, async () => worker()));

  const succeeded = results.filter((row) => row.status === 'ok').length;
  const failed = results.length - succeeded;

  return {
    summary: {
      total: results.length,
      succeeded,
      failed,
      retried,
      invalidPayloads,
      budgetExceeded,
    },
    results,
  };
};
