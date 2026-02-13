import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchNative } from '../../src/search/native';

let contextRoot: string;
let memoryRoot: string;

beforeEach(async () => {
  contextRoot = await mkdtemp(join(tmpdir(), 'search-ctx-'));
  memoryRoot = await mkdtemp(join(tmpdir(), 'search-mem-'));

  // Create an entity with summary and facts
  const entityDir = join(contextRoot, 'areas', 'people', 'jane');
  await mkdir(entityDir, { recursive: true });

  await writeFile(join(entityDir, 'summary.md'), `---
title: "Jane Smith"
type: person
---

# Jane Smith

Senior Software Engineer at APS. Leads the web platform team.

## Current
- Working on React migration
- Prefers async communication via Slack
`);

  await writeFile(join(entityDir, 'items.json'), JSON.stringify([
    {
      id: 'jane-001',
      fact: 'Senior Software Engineer at APS, leads web platform team',
      category: 'status',
      timestamp: '2026-01-15',
      source: '2026-01-15',
      status: 'active',
      supersededBy: null,
      relatedEntities: ['areas/companies/aps'],
      lastAccessed: '2026-02-07',
      accessCount: 5,
      importance: 2,
    },
    {
      id: 'jane-002',
      fact: 'Working on React migration project started January 2026',
      category: 'milestone',
      timestamp: '2026-01-20',
      source: '2026-01-20',
      status: 'active',
      supersededBy: null,
      relatedEntities: ['projects/react-migration'],
      lastAccessed: '2026-02-05',
      accessCount: 3,
      importance: 1,
    },
    {
      id: 'jane-003',
      fact: 'Approved platform budget sequencing for Q2 planning',
      category: 'decision',
      timestamp: '2026-02-01',
      source: '2026-02-01',
      status: 'active',
      supersededBy: null,
      relatedEntities: ['projects/react-migration'],
      lastAccessed: '2026-02-05',
      accessCount: 2,
      importance: 3,
    },
    {
      id: 'jane-004',
      fact: 'Legacy monolith ownership model from 2023',
      category: 'status',
      timestamp: '2023-01-01',
      source: '2023-01-01',
      status: 'superseded',
      supersededBy: 'jane-001',
      relatedEntities: [],
      lastAccessed: '2026-01-01',
      accessCount: 1,
      importance: 1,
    },
  ]));

  // Create a daily note
  const notesDir = join(memoryRoot, 'daily-notes');
  await mkdir(notesDir, { recursive: true });
  await writeFile(join(notesDir, '2026-02-07.md'), `# 2026-02-07

## Session abc12345 (14:30)

Reviewed the React migration timeline with Jane. Discussed API gateway concerns.

_3 facts → areas/people/jane, projects/react-migration_
`);
});

afterEach(async () => {
  await rm(contextRoot, { recursive: true, force: true });
  await rm(memoryRoot, { recursive: true, force: true });
});

describe('searchNative', () => {
  test('finds matches in entity summaries', async () => {
    const result = await searchNative({
      query: 'React migration',
      limit: 10,
      scope: 'entities',
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results[0].file).toContain('jane');
  });

  test('finds matches in atomic facts', async () => {
    const result = await searchNative({
      query: 'web platform team',
      limit: 10,
      scope: 'facts',
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results[0].snippet).toContain('web platform team');
    // Should collect matched fact refs
    expect(result.data.matchedFacts.length).toBeGreaterThan(0);
    expect(result.data.matchedFacts[0].factId).toBe('jane-001');
  });

  test('finds matches in daily notes', async () => {
    const result = await searchNative({
      query: 'API gateway',
      limit: 10,
      scope: 'notes',
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results[0].file).toContain('daily-notes');
  });

  test('searches all scopes by default', async () => {
    const result = await searchNative({
      query: 'React',
      limit: 10,
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Should find in summary, facts, and notes
    expect(result.data.results.length).toBeGreaterThanOrEqual(2);
  });

  test('returns empty for no matches', async () => {
    const result = await searchNative({
      query: 'xyznonexistent',
      limit: 10,
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results).toEqual([]);
    expect(result.data.matchedFacts).toEqual([]);
  });

  test('respects limit', async () => {
    const result = await searchNative({
      query: 'Jane',
      limit: 1,
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBeLessThanOrEqual(1);
  });

  test('sorts by score descending', async () => {
    const result = await searchNative({
      query: 'React migration',
      limit: 10,
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const { results } = result.data;
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  test('--category filters fact results', async () => {
    const result = await searchNative({
      query: 'platform',
      limit: 10,
      scope: 'facts',
      category: 'decision',
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results.every((row) => row.content.includes('[decision]'))).toBe(true);
  });

  test('superseded facts are excluded by default', async () => {
    const result = await searchNative({
      query: 'Legacy monolith ownership model',
      limit: 10,
      scope: 'facts',
      contextRoot,
      memoryRoot,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results).toEqual([]);
  });
});
