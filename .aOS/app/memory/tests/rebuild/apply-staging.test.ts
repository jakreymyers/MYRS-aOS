import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyStaging, filenameToEntityPath } from '../../src/rebuild/apply-staging';
import type { StagedEntityPayload } from '../../src/rebuild/staging';
import type { AtomicFact } from '../../src/knowledge/types';

let root: string;
let stagingDir: string;
let contextRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'apply-staging-test-'));
  stagingDir = join(root, 'staging');
  contextRoot = join(root, 'context');
  await mkdir(stagingDir, { recursive: true });
  await mkdir(join(root, 'memory', 'data'), { recursive: true });
  process.env.MEMORY_ROOT = join(root, 'memory');
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

const makePayload = (entityPath: string, factCount: number): StagedEntityPayload => ({
  entityPath,
  facts: Array.from({ length: factCount }, (_, i) => ({
    fact: `Fact number ${i + 1} about ${entityPath} with enough detail to pass validation`,
    category: 'status' as const,
    importance: 2 as const,
    timestamp: '2026-02-12T10:00',
    relatedEntities: [],
    provenance: {
      sourceType: 'gmail' as const,
      sourceId: `msg-${i + 1}`,
      sourceDate: '2026-02-12T10:00:00Z',
    },
  })),
  generatedAt: '2026-02-12T20:00:00Z',
  generatedBy: 'gog-swarm',
});

const writePayload = async (payload: StagedEntityPayload): Promise<void> => {
  const filename = payload.entityPath.replaceAll('/', '__') + '.json';
  await writeFile(join(stagingDir, filename), JSON.stringify(payload, null, 2));
};

const ensureEntityDir = async (entityPath: string): Promise<void> => {
  const dir = join(contextRoot, entityPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'summary.md'), `---\ntitle: "Test"\ntype: test\npara: ${entityPath.split('/')[0]}\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags: []\n---\n\n# Test\n`);
  await writeFile(join(dir, 'items.json'), '[]\n');
};

const loadFacts = async (entityPath: string): Promise<AtomicFact[]> => {
  const content = await readFile(join(contextRoot, entityPath, 'items.json'), 'utf8');
  return JSON.parse(content) as AtomicFact[];
};

describe('apply-staging', () => {
  test('applies 5 staged facts to empty entity with correct IDs and metadata', async () => {
    const payload = makePayload('people/jak-myers', 5);
    await writePayload(payload);
    await ensureEntityDir('people/jak-myers');

    const result = await applyStaging({ stagingDir, contextRoot });

    expect(result.entitiesApplied).toBe(1);
    expect(result.factsWritten).toBe(5);
    expect(result.skipped).toHaveLength(0);

    const facts = await loadFacts('people/jak-myers');
    expect(facts).toHaveLength(5);

    // Check ID format: slug-001, slug-002, ...
    expect(facts[0].id).toBe('jak-myers-001');
    expect(facts[4].id).toBe('jak-myers-005');

    // Check source encodes generatedBy
    expect(facts[0].source).toBe('rebuild:gog-swarm');

    // Check status and metadata
    expect(facts[0].status).toBe('active');
    expect(facts[0].supersededBy).toBeNull();
    expect(facts[0].accessCount).toBe(1);

    // Check category and importance preserved
    expect(facts[0].category).toBe('status');
    expect(facts[0].importance).toBe(2);
  });

  test('converts filename double-underscores to path slashes', () => {
    expect(filenameToEntityPath('people__jak-myers.json')).toBe('people/jak-myers');
    expect(filenameToEntityPath('areas__companies__aps.json')).toBe('areas/companies/aps');
    expect(filenameToEntityPath('projects__agentic-os.json')).toBe('projects/agentic-os');
  });

  test('skips invalid payloads without corrupting other entities', async () => {
    // Valid payload
    const valid = makePayload('people/good-entity', 2);
    await writePayload(valid);
    await ensureEntityDir('people/good-entity');

    // Invalid payload (bad entityPath)
    const invalidFilename = 'invalid__entity.json';
    await writeFile(join(stagingDir, invalidFilename), JSON.stringify({
      entityPath: 'nope/bad',
      facts: [],
      generatedAt: '2026-02-12T20:00:00Z',
      generatedBy: 'test',
    }));

    const result = await applyStaging({ stagingDir, contextRoot });

    // Invalid was skipped (either validation failure or no facts)
    expect(result.skipped.length).toBeGreaterThan(0);

    // Valid still applied
    expect(result.entitiesApplied).toBe(1);
    const facts = await loadFacts('people/good-entity');
    expect(facts).toHaveLength(2);
  });

  test('dry run writes no files', async () => {
    const payload = makePayload('people/dry-test', 3);
    await writePayload(payload);
    await ensureEntityDir('people/dry-test');

    const result = await applyStaging({ stagingDir, dryRun: true, contextRoot });

    expect(result.entitiesApplied).toBe(1);
    expect(result.factsWritten).toBe(3);

    // items.json should still be empty
    const facts = await loadFacts('people/dry-test');
    expect(facts).toHaveLength(0);
  });

  test('applies multiple entities from staging directory', async () => {
    const entities = ['people/alice', 'people/bob', 'projects/alpha'];
    for (const ep of entities) {
      await writePayload(makePayload(ep, 3));
      await ensureEntityDir(ep);
    }

    const result = await applyStaging({ stagingDir, contextRoot });

    expect(result.entitiesApplied).toBe(3);
    expect(result.factsWritten).toBe(9);
    expect(result.applied).toHaveLength(3);

    for (const ep of entities) {
      const facts = await loadFacts(ep);
      expect(facts).toHaveLength(3);
    }
  });

  test('skips payloads with zero facts', async () => {
    const payload = makePayload('people/empty', 0);
    await writePayload(payload);
    await ensureEntityDir('people/empty');

    const result = await applyStaging({ stagingDir, contextRoot });

    expect(result.entitiesApplied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('no facts');
  });

  test('preserves provenance in source field', async () => {
    const payload = makePayload('people/prov-test', 1);
    payload.generatedBy = 'google-workspace-swarm-v2';
    await writePayload(payload);
    await ensureEntityDir('people/prov-test');

    const result = await applyStaging({ stagingDir, contextRoot });
    const facts = await loadFacts('people/prov-test');

    expect(facts[0].source).toBe('rebuild:google-workspace-swarm-v2');
  });
});
