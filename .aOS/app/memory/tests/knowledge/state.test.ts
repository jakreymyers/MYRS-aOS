import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGraphState, saveGraphState, markEntityDirty, clearDirtyEntities, updateRefreshTimestamp } from '../../src/knowledge/state';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'state-test-'));
  await mkdir(join(testDir, 'data'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('loadGraphState', () => {
  test('returns empty state for missing file', async () => {
    const state = await loadGraphState(testDir);
    expect(state.lastSummaryRefresh).toBeNull();
    expect(state.lastExtraction).toBeNull();
    expect(state.dirtyEntities).toEqual([]);
    expect(state.consolidationFailures).toBe(0);
  });
});

describe('saveGraphState / loadGraphState', () => {
  test('round-trips state', async () => {
    const state = {
      lastSummaryRefresh: '2026-02-07T10:00:00Z',
      lastExtraction: '2026-02-07T09:00:00Z',
      dirtyEntities: ['areas/people/jane'],
      consolidationFailures: 0,
    };

    await saveGraphState(state, testDir);
    const loaded = await loadGraphState(testDir);
    expect(loaded).toEqual(state);
  });
});

describe('markEntityDirty', () => {
  test('adds entity to dirty list', async () => {
    await markEntityDirty('projects/alpha', testDir);
    const state = await loadGraphState(testDir);
    expect(state.dirtyEntities).toContain('projects/alpha');
  });

  test('does not duplicate entries', async () => {
    await markEntityDirty('projects/alpha', testDir);
    await markEntityDirty('projects/alpha', testDir);
    const state = await loadGraphState(testDir);
    expect(state.dirtyEntities.filter(e => e === 'projects/alpha')).toHaveLength(1);
  });
});

describe('clearDirtyEntities', () => {
  test('removes specified entities', async () => {
    await markEntityDirty('projects/alpha', testDir);
    await markEntityDirty('areas/people/jane', testDir);

    await clearDirtyEntities(['projects/alpha'], testDir);
    const state = await loadGraphState(testDir);
    expect(state.dirtyEntities).toEqual(['areas/people/jane']);
  });
});

describe('updateRefreshTimestamp', () => {
  test('sets lastSummaryRefresh to now', async () => {
    const before = Date.now();
    await updateRefreshTimestamp(testDir);
    const state = await loadGraphState(testDir);

    expect(state.lastSummaryRefresh).not.toBeNull();
    const ts = new Date(state.lastSummaryRefresh!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
