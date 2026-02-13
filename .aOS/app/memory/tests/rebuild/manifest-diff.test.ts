import { describe, expect, test } from 'bun:test';
import { diffEntityManifests } from '../../src/rebuild/manifest';
import type { EntityManifestRow } from '../../src/rebuild/manifest';

describe('rebuild manifest diff', () => {
  test('computes added, removed, and changed entities', () => {
    const before: EntityManifestRow[] = [
      { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [], factCount: 5, lastUpdated: '2026-02-10' },
      { path: 'projects/alpha', name: 'Alpha', type: 'project', bucket: 'projects', tags: [], factCount: 8, lastUpdated: '2026-02-10' },
    ];
    const after: EntityManifestRow[] = [
      { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [], factCount: 7, lastUpdated: '2026-02-12' },
      { path: 'projects/beta', name: 'Beta', type: 'project', bucket: 'projects', tags: [], factCount: 3, lastUpdated: '2026-02-12' },
    ];

    const diff = diffEntityManifests(before, after);
    expect(diff.removedPaths).toEqual(['projects/alpha']);
    expect(diff.addedPaths).toEqual(['projects/beta']);
    expect(diff.changedFactCounts).toEqual([
      { path: 'people/jane', before: 5, after: 7, delta: 2 },
    ]);
    expect(diff.beforeEntityCount).toBe(2);
    expect(diff.afterEntityCount).toBe(2);
  });
});
