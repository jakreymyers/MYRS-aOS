import { join } from 'node:path';
import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { saveFacts } from '../knowledge/facts';
import { saveGraphState } from '../knowledge/state';
import { saveState } from '../session/state';
import { atomicWrite } from '../utils/atomic';
import { resolveMemoryRoot } from '../utils/paths';
import type { GraphState } from '../knowledge/types';
import type { SessionStateFile } from '../types';

export interface CleanResult {
  entitiesCleared: number;
  sessionStateReset: boolean;
  graphStateReset: boolean;
  pipelineRunsTruncated: boolean;
}

const EMPTY_SESSION_STATE: SessionStateFile = {
  schemaVersion: 3,
  sessions: {},
  lastDigest: null,
  lastCurate: null,
};

const EMPTY_GRAPH_STATE: GraphState = {
  lastSummaryRefresh: null,
  lastExtraction: null,
  dirtyEntities: [],
  consolidationFailures: 0,
};

/**
 * Clean the context graph without touching entity structure.
 *
 * - Writes `[]` to every entity's items.json
 * - Resets session-state.json to empty (schema v3, no sessions)
 * - Resets graph-state.json (clears dirty list, nulls timestamps, zeros counters)
 * - Truncates pipeline-runs.jsonl
 *
 * Summary.md files are preserved — only facts are wiped.
 */
export const cleanGraph = async (options?: {
  contextRoot?: string;
  memoryRoot?: string;
}): Promise<CleanResult> => {
  const { contextRoot, memoryRoot } = options ?? {};

  const result: CleanResult = {
    entitiesCleared: 0,
    sessionStateReset: false,
    graphStateReset: false,
    pipelineRunsTruncated: false,
  };

  // 1. Clear all entity items.json to []
  const entities = await listEntities({ contextRoot });
  for (const entity of entities) {
    const entityDir = resolveEntityDir(entity.path, contextRoot);
    await saveFacts(entityDir, [], { markDirty: false });
    result.entitiesCleared++;
  }

  // 2. Reset session state
  await saveState(EMPTY_SESSION_STATE);
  result.sessionStateReset = true;

  // 3. Reset graph state
  await saveGraphState(EMPTY_GRAPH_STATE, memoryRoot);
  result.graphStateReset = true;

  // 4. Truncate pipeline runs
  const memRoot = memoryRoot ?? resolveMemoryRoot();
  const pipelinePath = join(memRoot, 'data', 'pipeline-runs.jsonl');
  await atomicWrite(pipelinePath, '');
  result.pipelineRunsTruncated = true;

  return result;
};
