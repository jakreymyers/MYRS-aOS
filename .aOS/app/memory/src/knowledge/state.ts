import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveMemoryRoot } from '../utils/paths';
import type { GraphState } from './types';
import { mutateState } from '../utils/state';

const GRAPH_STATE_FILE = 'graph-state.json';

const resolveGraphStatePath = (memoryRoot?: string): string =>
  join(memoryRoot ?? resolveMemoryRoot(), 'data', GRAPH_STATE_FILE);

const EMPTY_STATE: GraphState = {
  lastSummaryRefresh: null,
  lastExtraction: null,
  dirtyEntities: [],
  consolidationFailures: 0,
};

const normalizeState = (state: Partial<GraphState> | null | undefined): GraphState => ({
  lastSummaryRefresh: state?.lastSummaryRefresh ?? null,
  lastExtraction: state?.lastExtraction ?? null,
  dirtyEntities: state?.dirtyEntities ?? [],
  consolidationFailures: state?.consolidationFailures ?? 0,
});

export const loadGraphState = async (memoryRoot?: string): Promise<GraphState> => {
  try {
    const content = await readFile(resolveGraphStatePath(memoryRoot), 'utf8');
    return normalizeState(JSON.parse(content) as Partial<GraphState>);
  } catch {
    return { ...EMPTY_STATE, dirtyEntities: [] };
  }
};

export const saveGraphState = async (state: GraphState, memoryRoot?: string): Promise<void> => {
  await mutateState(resolveGraphStatePath(memoryRoot), EMPTY_STATE, async () => normalizeState(state));
};

export const mutateGraphState = async (
  mutator: (state: GraphState) => GraphState | Promise<GraphState>,
  memoryRoot?: string,
): Promise<GraphState> =>
  mutateState(resolveGraphStatePath(memoryRoot), EMPTY_STATE, async (state) => {
    const next = await mutator(normalizeState(state));
    return normalizeState(next);
  });

/**
 * Mark an entity as needing summary refresh.
 */
export const markEntityDirty = async (entityPath: string, memoryRoot?: string): Promise<void> => {
  await mutateGraphState(async (next) => {
    if (!next.dirtyEntities.includes(entityPath)) {
      next.dirtyEntities.push(entityPath);
    }
    return next;
  }, memoryRoot);
};

/**
 * Clear dirty flags for specific entities after refresh.
 */
export const clearDirtyEntities = async (paths: string[], memoryRoot?: string): Promise<void> => {
  await mutateGraphState(async (next) => {
    const toRemove = new Set(paths);
    next.dirtyEntities = next.dirtyEntities.filter((p) => !toRemove.has(p));
    return next;
  }, memoryRoot);
};

/**
 * Update the last summary refresh timestamp.
 */
export const updateRefreshTimestamp = async (memoryRoot?: string): Promise<void> => {
  await mutateGraphState(async (next) => {
    next.lastSummaryRefresh = new Date().toISOString();
    return next;
  }, memoryRoot);
};
