import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEntityCmd } from '../../src/cli/entity-cmd';

let root: string;
let contextRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'entity-cmd-test-'));
  contextRoot = join(root, 'context');
  process.env.CONTEXT_ROOT = contextRoot;

  const entityDir = join(contextRoot, 'people', 'jane');
  await mkdir(entityDir, { recursive: true });
  await writeFile(join(entityDir, 'summary.md'), `---\ntitle: "Jane Smith"\ntype: person\ncreated: 2026-02-12\nupdated: 2026-02-12\ntags: [engineering]\n---\n`);
  await writeFile(join(entityDir, 'items.json'), JSON.stringify([
    {
      id: 'jane-001',
      fact: 'Jane leads platform engineering',
      category: 'status',
      timestamp: '2026-02-12',
      source: 'seed',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
      lastAccessed: '2026-02-12',
      accessCount: 1,
      importance: 2,
    },
  ], null, 2) + '\n');

  const projectDir = join(contextRoot, 'projects', 'alpha');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'summary.md'), `---\ntitle: "Alpha"\ntype: project\ncreated: 2026-02-12\nupdated: 2026-02-12\ntags: [platform]\n---\n`);
  await writeFile(join(projectDir, 'items.json'), JSON.stringify([
    {
      id: 'alpha-001',
      fact: 'Alpha launched',
      category: 'milestone',
      timestamp: '2026-02-12',
      source: 'seed',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
      lastAccessed: '2026-02-12',
      accessCount: 1,
      importance: 2,
    },
  ], null, 2) + '\n');
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('entity list --json', () => {
  test('outputs manifest contract fields', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runEntityCmd(['list', '--json']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n')) as Array<{
      path: string;
      name: string;
      type: string;
      bucket: string;
      tags: string[];
      factCount: number;
      lastUpdated: string;
    }>;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(2);

    expect(payload.map((row) => row.path)).toEqual(['people/jane', 'projects/alpha']);

    const row = payload[0];
    expect(row.name).toBe('Jane Smith');
    expect(row.type).toBe('person');
    expect(row.bucket).toBe('people');
    expect(Array.isArray(row.tags)).toBe(true);
    expect(row.factCount).toBe(1);
    expect(typeof row.lastUpdated).toBe('string');
  });
});
