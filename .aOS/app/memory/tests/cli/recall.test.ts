import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRecall } from '../../src/cli/recall';

let root: string;
let contextRoot: string;
let memoryRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'recall-cli-test-'));
  contextRoot = join(root, 'context');
  memoryRoot = join(root, 'memory');

  process.env.CONTEXT_ROOT = contextRoot;
  process.env.MEMORY_ROOT = memoryRoot;

  const entityDir = join(contextRoot, 'people', 'jane');
  await mkdir(entityDir, { recursive: true });

  await writeFile(join(entityDir, 'summary.md'), '# Jane\n\nJane leads the platform team.\n');
  await writeFile(join(entityDir, 'items.json'), JSON.stringify([
    {
      id: 'jane-001',
      fact: 'Jane leads platform engineering',
      category: 'status',
      timestamp: '2026-02-12T09:00',
      source: 'seed',
      status: 'active',
      supersededBy: null,
      relatedEntities: ['projects/platform'],
      lastAccessed: '2026-02-12',
      accessCount: 1,
      importance: 2,
    },
  ], null, 2) + '\n');

  await mkdir(join(memoryRoot, 'daily-notes'), { recursive: true });
  await writeFile(join(memoryRoot, 'daily-notes', '2026-02-12.md'), '# 2026-02-12\n\nDiscussed platform roadmap with Jane.\n');
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory recall CLI', () => {
  test('--json returns entity-expanded payload', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runRecall(['jane platform', '--json'], {
        searchFn: async () => ({
          success: true,
          data: {
            results: [
              {
                content: 'Jane leads platform engineering',
                snippet: 'Jane leads platform engineering',
                score: 0.9,
                file: 'people/jane',
              },
            ],
            matchedFacts: [],
          },
        }),
      });
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.query).toBe('jane platform');
    expect(payload.entities.length).toBe(1);
    expect(payload.entities[0].path).toBe('people/jane');
    expect(payload.entities[0].summary).toContain('platform team');
    expect(payload.entities[0].facts.length).toBe(1);
    expect(payload.entities[0].facts[0].category).toBe('status');
  });
});
