import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEntity, entityExists, getEntity, listEntities, moveEntity, resolveEntityDir } from '../../src/knowledge/entities';

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'entities-test-'));
  // Create PARA bucket directories
  await mkdir(join(testRoot, 'projects'), { recursive: true });
  await mkdir(join(testRoot, 'areas', 'people'), { recursive: true });
  await mkdir(join(testRoot, 'areas', 'companies'), { recursive: true });
  await mkdir(join(testRoot, 'resources'), { recursive: true });
  await mkdir(join(testRoot, 'archives'), { recursive: true });
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe('createEntity', () => {
  test('creates directory with summary.md and items.json', async () => {
    const meta = await createEntity({
      path: 'areas/people/jane',
      name: 'Jane Smith',
      type: 'person',
      bucket: 'areas',
      tags: ['engineering', 'aps'],
      contextRoot: testRoot,
    });

    expect(meta.name).toBe('Jane Smith');
    expect(meta.type).toBe('person');
    expect(meta.bucket).toBe('areas');

    const dir = resolveEntityDir('areas/people/jane', testRoot);
    const summary = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('title: "Jane Smith"');
    expect(summary).toContain('type: person');
    expect(summary).toContain('# Jane Smith');

    const items = await readFile(join(dir, 'items.json'), 'utf8');
    expect(JSON.parse(items)).toEqual([]);
  });
});

describe('entityExists', () => {
  test('returns true for existing entity', async () => {
    await createEntity({
      path: 'areas/people/bob',
      name: 'Bob',
      type: 'person',
      bucket: 'areas',
      contextRoot: testRoot,
    });
    expect(await entityExists('areas/people/bob', testRoot)).toBe(true);
  });

  test('returns false for non-existent entity', async () => {
    expect(await entityExists('areas/people/nobody', testRoot)).toBe(false);
  });
});

describe('getEntity', () => {
  test('parses entity metadata from summary.md', async () => {
    await createEntity({
      path: 'projects/alpha',
      name: 'Project Alpha',
      type: 'project',
      bucket: 'projects',
      tags: ['q1', 'priority'],
      contextRoot: testRoot,
    });

    const entity = await getEntity('projects/alpha', testRoot);
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('Project Alpha');
    expect(entity!.type).toBe('project');
    expect(entity!.bucket).toBe('projects');
    expect(entity!.tags).toEqual(['q1', 'priority']);
  });

  test('returns null for non-existent entity', async () => {
    expect(await getEntity('projects/nope', testRoot)).toBeNull();
  });
});

describe('listEntities', () => {
  test('lists all entities across buckets', async () => {
    await createEntity({ path: 'areas/people/jane', name: 'Jane', type: 'person', bucket: 'areas', contextRoot: testRoot });
    await createEntity({ path: 'projects/alpha', name: 'Alpha', type: 'project', bucket: 'projects', contextRoot: testRoot });

    const all = await listEntities({ contextRoot: testRoot });
    expect(all).toHaveLength(2);
    expect(all.map(e => e.name).sort()).toEqual(['Alpha', 'Jane']);
    expect(all.every(e => e.factCount === 0)).toBe(true);
  });

  test('filters by bucket', async () => {
    await createEntity({ path: 'areas/people/jane', name: 'Jane', type: 'person', bucket: 'areas', contextRoot: testRoot });
    await createEntity({ path: 'projects/alpha', name: 'Alpha', type: 'project', bucket: 'projects', contextRoot: testRoot });

    const projects = await listEntities({ bucket: 'projects', contextRoot: testRoot });
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Alpha');
  });

  test('returns empty for no entities', async () => {
    const all = await listEntities({ contextRoot: testRoot });
    expect(all).toEqual([]);
  });
});

describe('moveEntity', () => {
  test('moves entity to new location', async () => {
    await createEntity({
      path: 'projects/beta',
      name: 'Beta',
      type: 'project',
      bucket: 'projects',
      contextRoot: testRoot,
    });

    const result = await moveEntity('projects/beta', 'archives/beta', testRoot);
    expect(result).toBe(true);

    expect(await entityExists('projects/beta', testRoot)).toBe(false);
    expect(await entityExists('archives/beta', testRoot)).toBe(true);

    const entity = await getEntity('archives/beta', testRoot);
    expect(entity).not.toBeNull();
  });

  test('returns false for non-existent source', async () => {
    const result = await moveEntity('projects/nope', 'archives/nope', testRoot);
    expect(result).toBe(false);
  });
});
