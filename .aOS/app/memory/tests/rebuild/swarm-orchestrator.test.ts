import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  orchestrateSwarmRebuild,
  type SubagentRunner,
} from '../../src/rebuild/swarm';
import type { EntityManifestRow } from '../../src/rebuild/manifest';

let root: string;
let stagingDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'swarm-orchestrator-test-'));
  stagingDir = join(root, 'staging');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const manifest = (count: number): EntityManifestRow[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `people/person-${i + 1}`,
    name: `Person ${i + 1}`,
    type: 'person',
    bucket: 'people',
    tags: [],
    factCount: 0,
    lastUpdated: '2026-02-12',
  }));

describe('swarm orchestrator', () => {
  test('respects max concurrency and writes staging payloads', async () => {
    let active = 0;
    let maxActive = 0;

    const runner: SubagentRunner = {
      runTask: async ({ entityPath }) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;

        return {
          callCount: 2,
          payload: {
            entityPath,
            facts: [
              {
                fact: `${entityPath} fact`,
                category: 'status',
                importance: 1,
                timestamp: '2026-02-12T10:00',
                relatedEntities: [],
                provenance: {
                  sourceType: 'gmail',
                  sourceId: `${entityPath}-msg`,
                  sourceDate: '2026-02-12T10:00:00Z',
                },
              },
            ],
            generatedAt: '2026-02-12T10:00:00Z',
            generatedBy: 'test-runner',
          },
        };
      },
    };

    const result = await orchestrateSwarmRebuild({
      manifest: manifest(7),
      stagingDir,
      runner,
      maxConcurrent: 3,
      maxCallsPerEntity: 10,
      retryLimit: 0,
    });

    expect(maxActive <= 3).toBe(true);
    expect(result.summary.succeeded).toBe(7);
    expect(result.summary.failed).toBe(0);

    const files = (await readdir(stagingDir)).filter((name) => name.endsWith('.json'));
    expect(files.length).toBe(7);
  });

  test('retries transient failures and succeeds on retry', async () => {
    const attempts = new Map<string, number>();
    const runner: SubagentRunner = {
      runTask: async ({ entityPath }) => {
        const n = (attempts.get(entityPath) ?? 0) + 1;
        attempts.set(entityPath, n);
        if (entityPath.endsWith('person-2') && n === 1) {
          throw new Error('transient');
        }
        return {
          callCount: 3,
          payload: {
            entityPath,
            facts: [
              {
                fact: `${entityPath} fact`,
                category: 'status',
                importance: 1,
                timestamp: '2026-02-12T10:00',
                relatedEntities: [],
                provenance: {
                  sourceType: 'gmail',
                  sourceId: `${entityPath}-msg`,
                  sourceDate: '2026-02-12T10:00:00Z',
                },
              },
            ],
            generatedAt: '2026-02-12T10:00:00Z',
            generatedBy: 'test-runner',
          },
        };
      },
    };

    const result = await orchestrateSwarmRebuild({
      manifest: manifest(3),
      stagingDir,
      runner,
      maxConcurrent: 2,
      maxCallsPerEntity: 10,
      retryLimit: 1,
    });

    expect(result.summary.succeeded).toBe(3);
    expect(result.summary.retried).toBe(1);
    expect(result.results.find((r) => r.entityPath.endsWith('person-2'))?.attempts).toBe(2);
  });

  test('isolates failures and tracks budget-exceeded entities', async () => {
    const inputManifest = manifest(3);
    inputManifest[1].path = 'people/failing-entity';
    inputManifest[2].path = 'people/over-budget';

    const runner: SubagentRunner = {
      runTask: async ({ entityPath }) => {
        if (entityPath.endsWith('failing-entity')) {
          throw new Error('hard failure');
        }
        if (entityPath.endsWith('over-budget')) {
          return {
            callCount: 12,
            payload: {
              entityPath,
              facts: [],
              generatedAt: '2026-02-12T10:00:00Z',
              generatedBy: 'test-runner',
            },
          };
        }
        return {
          callCount: 2,
          payload: {
            entityPath,
            facts: [
              {
                fact: `${entityPath} fact`,
                category: 'status',
                importance: 1,
                timestamp: '2026-02-12T10:00',
                relatedEntities: [],
                provenance: {
                  sourceType: 'gmail',
                  sourceId: `${entityPath}-msg`,
                  sourceDate: '2026-02-12T10:00:00Z',
                },
              },
            ],
            generatedAt: '2026-02-12T10:00:00Z',
            generatedBy: 'test-runner',
          },
        };
      },
    };

    const result = await orchestrateSwarmRebuild({
      manifest: inputManifest,
      stagingDir,
      runner,
      maxConcurrent: 2,
      maxCallsPerEntity: 10,
      retryLimit: 0,
    });

    expect(result.summary.succeeded).toBe(1);
    expect(result.summary.failed).toBe(2);
    expect(result.summary.budgetExceeded).toBe(1);
    expect(result.results.find((r) => r.entityPath.endsWith('failing-entity'))?.status).toBe('failed');
    expect(result.results.find((r) => r.entityPath.endsWith('over-budget'))?.status).toBe('failed');

    const files = (await readdir(stagingDir)).filter((name) => name.endsWith('.json'));
    expect(files.length).toBe(1);
    const payload = JSON.parse(await readFile(join(stagingDir, files[0]), 'utf8'));
    expect(payload.entityPath).toBe('people/person-1');
  });
});
