import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveContextRoot, resolveDailyLogDir, resolveMemoryMdPath, resolveMemoryRoot, resolveVecDbPath } from '../utils/paths';
import { loadGraphState } from '../knowledge/state';
import { entityExists } from '../knowledge/entities';

interface DoctorIssue {
  code: string;
  severity: 'warn' | 'error';
  path?: string;
  message: string;
}

const walkFiles = async (dir: string, out: string[] = []): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }

  return out;
};

const ageDays = (a: number, b: number): number =>
  Math.floor(Math.abs(b - a) / 86_400_000);

const newestMtime = async (paths: string[]): Promise<number> => {
  let newest = 0;
  for (const path of paths) {
    try {
      const s = await stat(path);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      // Ignore missing files.
    }
  }
  return newest;
};

export const runDoctor = async (args: string[]): Promise<void> => {
  const json = args.includes('--json');
  const issues: DoctorIssue[] = [];

  const contextRoot = resolveContextRoot();
  const memoryRoot = resolveMemoryRoot();

  const files = await walkFiles(contextRoot);

  for (const path of files) {
    if (path.endsWith('/items.json')) {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (!Array.isArray(parsed)) {
          issues.push({
            code: 'MALFORMED_ITEMS_JSON',
            severity: 'error',
            path,
            message: 'items.json must be a JSON array',
          });
        }
      } catch {
        issues.push({
          code: 'MALFORMED_ITEMS_JSON',
          severity: 'error',
          path,
          message: 'items.json is not valid JSON',
        });
      }
    }

    if (path.includes('.tmp.')) {
      issues.push({
        code: 'ORPHAN_TMP_FILE',
        severity: 'warn',
        path,
        message: 'Temporary file may be leftover from interrupted atomic write',
      });
    }
  }

  const lockPath = join(memoryRoot, 'data', 'digest.lock');
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > 60_000) {
      issues.push({
        code: 'STALE_DIGEST_LOCK',
        severity: 'warn',
        path: lockPath,
        message: 'Digest lock appears stale',
      });
    }
  } catch {
    // Missing lock is fine.
  }

  const memoryPath = resolveMemoryMdPath();
  try {
    const memoryStat = await stat(memoryPath);
    if (ageDays(memoryStat.mtimeMs, Date.now()) > 14) {
      issues.push({
        code: 'MEMORY_MD_STALE',
        severity: 'warn',
        path: memoryPath,
        message: 'MEMORY.md has not been refreshed in over 14 days',
      });
    }
  } catch {
    issues.push({
      code: 'MEMORY_MD_MISSING',
      severity: 'warn',
      path: memoryPath,
      message: 'MEMORY.md is missing',
    });
  }

  const vecPath = resolveVecDbPath();
  let vecStatMtime: number | null = null;
  try {
    const s = await stat(vecPath);
    vecStatMtime = s.mtimeMs;
  } catch {
    issues.push({
      code: 'VECTOR_INDEX_MISSING',
      severity: 'warn',
      path: vecPath,
      message: 'Vector index missing. Run `memory vec sync`.',
    });
  }

  try {
    const graph = await loadGraphState(memoryRoot);
    for (const entityPath of graph.dirtyEntities) {
      const exists = await entityExists(entityPath, contextRoot);
      if (!exists) {
        issues.push({
          code: 'GRAPH_DIRTY_ENTITY_MISSING',
          severity: 'error',
          path: entityPath,
          message: 'graph-state references dirty entity path that does not exist',
        });
      }
    }
  } catch {
    // Missing/corrupt graph state handled elsewhere.
  }

  if (vecStatMtime != null) {
    const contextFiles = files.filter((path) => path.endsWith('/summary.md') || path.endsWith('/items.json'));
    const noteFiles = await walkFiles(resolveDailyLogDir(memoryRoot));
    const dailyNoteFiles = noteFiles.filter((path) => path.endsWith('.md'));
    const newestContent = await newestMtime([
      ...contextFiles,
      ...dailyNoteFiles,
      resolveMemoryMdPath(memoryRoot),
    ]);

    if (newestContent > vecStatMtime) {
      issues.push({
        code: 'VECTOR_INDEX_STALE',
        severity: 'warn',
        path: vecPath,
        message: 'Vectors are older than memory/context content. Run `memory vec sync`.',
      });
    }
  }

  const summary = {
    issueCount: issues.length,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
  };

  if (json) {
    console.log(JSON.stringify({ summary, issues }, null, 2));
    return;
  }

  console.log(`Doctor: ${summary.issueCount} issue(s)`);
  for (const issue of issues) {
    console.log(`[${issue.severity}] ${issue.code} ${issue.path ?? ''}`.trim());
    console.log(`  ${issue.message}`);
  }
};
