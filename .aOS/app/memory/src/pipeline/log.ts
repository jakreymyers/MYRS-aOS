import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveMemoryRoot } from '../utils/paths';
import { atomicWrite } from '../utils/atomic';

export interface PipelineLogEntry {
  runId: string;
  sessionPath?: string;
  stages?: Array<{ name: string; ms: number; ok: boolean }>;
  errors?: string[];
  fallbackMode?: string | null;
  droppedFacts?: number;
  invalidDecisions?: number;
  retryCount?: number;
  startedAt: string;
  completedAt: string;
  success: boolean;
}

const resolvePipelineLogPath = (): string =>
  join(resolveMemoryRoot(), 'data', 'pipeline-runs.jsonl');

export const appendPipelineLog = async (entry: PipelineLogEntry): Promise<void> => {
  const path = resolvePipelineLogPath();
  let existing = '';

  try {
    existing = await readFile(path, 'utf8');
  } catch {
    // New file.
  }

  const line = JSON.stringify(entry) + '\n';
  await atomicWrite(path, existing + line);
};
