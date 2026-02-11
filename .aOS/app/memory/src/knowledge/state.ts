import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { resolveMemoryRoot } from '../utils/paths';
import type { GraphState } from './types';

const GRAPH_STATE_FILE = 'graph-state.json';

const resolveGraphStatePath = (memoryRoot?: string): string =>
  join(memoryRoot ?? resolveMemoryRoot(), 'data', GRAPH_STATE_FILE);

const EMPTY_STATE: GraphState = {
  lastSummaryRefresh: null,
  lastExtraction: null,
  dirtyEntities: [],
  entityStats: { total: 0, projects: 0, areas: 0, resources: 0, archives: 0, people: 0 },
};

export const loadGraphState = async (memoryRoot?: string): Promise<GraphState> => {
  try {
    const content = await readFile(resolveGraphStatePath(memoryRoot), 'utf8');
    return JSON.parse(content) as GraphState;
  } catch {
    return { ...EMPTY_STATE, dirtyEntities: [], entityStats: { ...EMPTY_STATE.entityStats } };
  }
};

export const saveGraphState = async (state: GraphState, memoryRoot?: string): Promise<void> => {
  const path = resolveGraphStatePath(memoryRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n');
};

/**
 * Mark an entity as needing summary refresh.
 */
export const markEntityDirty = async (entityPath: string, memoryRoot?: string): Promise<void> => {
  const state = await loadGraphState(memoryRoot);
  if (!state.dirtyEntities.includes(entityPath)) {
    state.dirtyEntities.push(entityPath);
  }
  await saveGraphState(state, memoryRoot);
};

/**
 * Clear dirty flags for specific entities after refresh.
 */
export const clearDirtyEntities = async (paths: string[], memoryRoot?: string): Promise<void> => {
  const state = await loadGraphState(memoryRoot);
  const toRemove = new Set(paths);
  state.dirtyEntities = state.dirtyEntities.filter((p) => !toRemove.has(p));
  await saveGraphState(state, memoryRoot);
};

/**
 * Update the last summary refresh timestamp.
 */
export const updateRefreshTimestamp = async (memoryRoot?: string): Promise<void> => {
  const state = await loadGraphState(memoryRoot);
  state.lastSummaryRefresh = new Date().toISOString();
  await saveGraphState(state, memoryRoot);
};
