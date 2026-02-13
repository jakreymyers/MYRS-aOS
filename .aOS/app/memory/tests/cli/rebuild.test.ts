import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRebuild } from '../../src/cli/rebuild';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rebuild-cli-test-'));
});

afterEach(async () => {
  process.exitCode = 0;
  await rm(root, { recursive: true, force: true });
});

describe('memory rebuild', () => {
  test('manifest-diff outputs manifest delta json', async () => {
    const beforePath = join(root, 'before.json');
    const afterPath = join(root, 'after.json');
    await writeFile(beforePath, JSON.stringify([
      { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [], factCount: 5, lastUpdated: '2026-02-10' },
    ], null, 2));
    await writeFile(afterPath, JSON.stringify([
      { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [], factCount: 6, lastUpdated: '2026-02-12' },
      { path: 'projects/alpha', name: 'Alpha', type: 'project', bucket: 'projects', tags: [], factCount: 3, lastUpdated: '2026-02-12' },
    ], null, 2));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));
    try {
      await runRebuild(['manifest-diff', '--before', beforePath, '--after', afterPath, '--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.addedPaths).toEqual(['projects/alpha']);
    expect(payload.changedFactCounts).toEqual([{ path: 'people/jane', before: 5, after: 6, delta: 1 }]);
  });

  test('validate-staging detects invalid payload', async () => {
    const input = join(root, 'invalid-staging.json');
    await writeFile(input, JSON.stringify({
      entityPath: 'people/jane',
      facts: [{ fact: 'Test', category: 'status', importance: 1, timestamp: '2026-02-12', relatedEntities: [] }],
      generatedAt: '2026-02-12T10:00:00Z',
      generatedBy: 'swarm',
    }, null, 2));

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => errors.push(String(msg ?? ''));
    try {
      await runRebuild(['validate-staging', '--input', input]);
    } finally {
      console.error = originalError;
    }

    expect(errors.some((line) => line.includes('invalid staging payload'))).toBe(true);
    process.exitCode = 0;
  });

  test('provenance reports coverage over staging directory', async () => {
    const stagingDir = join(root, 'staging');
    await mkdir(stagingDir, { recursive: true });

    await writeFile(join(stagingDir, 'people-jane.json'), JSON.stringify({
      entityPath: 'people/jane',
      facts: [
        {
          fact: 'Jane leads platform engineering',
          category: 'status',
          importance: 2,
          timestamp: '2026-02-12T09:00',
          relatedEntities: [],
          provenance: { sourceType: 'gmail', sourceId: 'm-1', sourceDate: '2026-02-12T09:00:00Z' },
        },
      ],
      generatedAt: '2026-02-12T10:00:00Z',
      generatedBy: 'swarm',
    }, null, 2));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));
    try {
      await runRebuild(['provenance', '--dir', stagingDir, '--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.totalFacts).toBe(1);
    expect(payload.percent).toBe(100);
  });

  test('orchestrate runs swarm with injected runner and emits summary json', async () => {
    const manifestPath = join(root, 'manifest.json');
    const stagingDir = join(root, 'staging');
    await writeFile(manifestPath, JSON.stringify([
      { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [], factCount: 0, lastUpdated: '2026-02-12' },
    ], null, 2));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));
    try {
      await runRebuild(
        ['orchestrate', '--manifest', manifestPath, '--staging-dir', stagingDir, '--dry-run', '--json'],
        {
          swarmRunner: {
            runTask: async ({ entityPath }) => ({
              callCount: 2,
              payload: {
                entityPath,
                facts: [
                  {
                    fact: 'Jane leads platform engineering',
                    category: 'status',
                    importance: 2,
                    timestamp: '2026-02-12T09:00',
                    relatedEntities: [],
                    provenance: { sourceType: 'gmail', sourceId: 'm-1', sourceDate: '2026-02-12T09:00:00Z' },
                  },
                ],
                generatedAt: '2026-02-12T10:00:00Z',
                generatedBy: 'test-swarm',
              },
            }),
          },
        },
      );
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.summary.total).toBe(1);
    expect(payload.summary.succeeded).toBe(1);
  });
});
