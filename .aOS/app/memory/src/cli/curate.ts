import { readdir, readFile, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runPrompt, runExtractPrompt } from '../llm/claude';
import { CURATE_SYSTEM_PROMPT, CURATE_USER_PROMPT, SUMMARIZE_SYSTEM_PROMPT, fillPrompt } from '../llm/prompts';
import { resolveMemoryRoot, resolveMemoryMdPath, resolveDailyLogDir } from '../utils/paths';
import { loadState, saveState } from '../session/state';
import { loadGraphState, clearDirtyEntities, updateRefreshTimestamp } from '../knowledge/state';
import { refreshEntitySummary } from '../knowledge/summarize';
import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { atomicWrite } from '../utils/atomic';

const MAX_REPORT_DAYS = 14;
const MEMORY_VERSION_KEEP = 10;
const MEMORY_VERSION_DIR = 'versions';

interface CurateDeps {
  runPromptFn?: (prompt: string) => Promise<string>;
  summarizeEntityFn?: (entityPath: string) => Promise<boolean>;
  nowFn?: () => Date;
}

export interface CuratePhase1Result {
  dirtyEntities: number;
  refreshed: number;
  refreshedPaths: string[];
  durationMs: number;
  error: string | null;
}

export interface CuratePhase2Result {
  updated: boolean;
  dailyNotesUsed: number;
  changedEntitiesUsed: number;
  previousSizeBytes: number;
  newSizeBytes: number;
  shrinkWarning: boolean;
  durationMs: number;
  error: string | null;
}

export interface CurateResult {
  phase1: CuratePhase1Result | null;
  phase2: CuratePhase2Result | null;
}

const uniqueSorted = (items: string[]): string[] =>
  [...new Set(items)].sort((a, b) => a.localeCompare(b));

/**
 * Auto-refresh entity summaries + MEMORY.md.
 *
 * 1. Refresh dirty entity summaries (applying decay tiers)
 * 2. Clear dirtyEntities in graph-state.json
 * 3. Refresh MEMORY.md from hot entities + recent daily notes
 * 4. Update lastSummaryRefresh timestamp
 */
export const runCurate = async (args: string[], deps: CurateDeps = {}): Promise<CurateResult> => {
  const summariesOnly = args.includes('--summaries-only');
  const days = Number(args.find(a => a.startsWith('--days='))?.split('=')[1]) || MAX_REPORT_DAYS;
  const runPromptFn = deps.runPromptFn ?? runPrompt;
  const summarizeEntityFn = deps.summarizeEntityFn ?? (async (entityPath: string) =>
    refreshEntitySummary({
      entityPath,
      llmCaller: runExtractPrompt,
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    }));
  const now = deps.nowFn ?? (() => new Date());

  let phase1: CuratePhase1Result | null = null;
  let phase2: CuratePhase2Result | null = null;
  const phase1Start = Date.now();

  try {
    const state = await loadState();
    const lastCurateMs = state.lastCurate ? Date.parse(state.lastCurate) : null;

    // Phase 1: Refresh dirty entity summaries
    const graphState = await loadGraphState();
    const dirtyBefore = [...graphState.dirtyEntities];
    let refreshed = 0;
    const refreshedPaths: string[] = [];

    if (graphState.dirtyEntities.length > 0) {
      for (const entityPath of graphState.dirtyEntities) {
        const ok = await summarizeEntityFn(entityPath);
        if (ok) {
          refreshed++;
          refreshedPaths.push(entityPath);
        }
      }
      if (refreshedPaths.length > 0) {
        await clearDirtyEntities(refreshedPaths);
        await updateRefreshTimestamp();
      }
      console.log(`Refreshed ${refreshed} entity summaries`);
    }

    phase1 = {
      dirtyEntities: graphState.dirtyEntities.length,
      refreshed,
      refreshedPaths,
      durationMs: Date.now() - phase1Start,
      error: null,
    };

    if (summariesOnly) return { phase1, phase2 };

    // Phase 2: Refresh MEMORY.md
    const phase2Start = Date.now();
    const memoryMdPath = resolveMemoryMdPath();
    const reportDir = resolveDailyLogDir();

    let existingMemory = '(empty)';
    try {
      existingMemory = await readFile(memoryMdPath, 'utf8');
    } catch {
      // File doesn't exist yet
    }

    // Read diff-filtered daily notes.
    let reportFiles: Array<{ file: string; mtimeMs: number }> = [];
    try {
      const entries = await readdir(reportDir);
      const noteFiles = entries.filter((f) => f.endsWith('.md')).sort().reverse();
      const withMtime = await Promise.all(noteFiles.map(async (file) => ({
        file,
        mtimeMs: (await stat(join(reportDir, file))).mtimeMs,
      })));

      reportFiles = lastCurateMs == null
        ? withMtime.slice(0, days)
        : withMtime.filter((row) => row.mtimeMs > lastCurateMs).slice(0, days);
    } catch {
      // No daily notes — use entity context only
    }

    const allEntities = await listEntities();
    const changedEntityPaths = lastCurateMs == null
      ? allEntities.map((entity) => entity.path)
      : dirtyBefore;

    const reports: string[] = [];
    for (const { file } of reportFiles) {
      const content = await readFile(join(reportDir, file), 'utf8');
      reports.push(`### ${file}\n${content.trim()}`);
    }

    const changedEntityBlocks: string[] = [];
    for (const entityPath of uniqueSorted(changedEntityPaths)) {
      try {
        const summary = await readFile(join(resolveEntityDir(entityPath), 'summary.md'), 'utf8');
        changedEntityBlocks.push(`### ${entityPath}\n${summary.trim()}`);
      } catch {
        // Skip unreadable/missing summaries.
      }
    }

    if (reportFiles.length === 0 && changedEntityBlocks.length === 0 && allEntities.length === 0) {
      console.log('No daily notes or entities — nothing to curate');
      phase2 = {
        updated: false,
        dailyNotesUsed: 0,
        changedEntitiesUsed: 0,
        previousSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
        newSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
        shrinkWarning: false,
        durationMs: Date.now() - phase2Start,
        error: null,
      };
      return { phase1, phase2 };
    }

    if (lastCurateMs != null && reportFiles.length === 0 && changedEntityBlocks.length === 0) {
      console.log('No entity or daily note changes — skipping MEMORY.md refresh');
      phase2 = {
        updated: false,
        dailyNotesUsed: 0,
        changedEntitiesUsed: 0,
        previousSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
        newSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
        shrinkWarning: false,
        durationMs: Date.now() - phase2Start,
        error: null,
      };
      return { phase1, phase2 };
    }

    const today = now().toISOString().slice(0, 10);
    const userPrompt = fillPrompt(CURATE_USER_PROMPT, {
      existing_memory: existingMemory,
      changed_entities: changedEntityBlocks.join('\n\n---\n\n') || '(none)',
      changed_entity_count: String(changedEntityBlocks.length),
      daily_reports: reports.join('\n\n---\n\n') || '(none)',
      daily_report_count: String(reportFiles.length),
      today,
    });

    const prompt = `${CURATE_SYSTEM_PROMPT}\n\n${userPrompt}`;
    const result = await runPromptFn(prompt);

    if (!result.trim()) {
      console.error('Curate: LLM returned empty result');
      process.exitCode = 1;
      phase2 = {
        updated: false,
        dailyNotesUsed: reportFiles.length,
        changedEntitiesUsed: changedEntityBlocks.length,
        previousSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
        newSizeBytes: 0,
        shrinkWarning: false,
        durationMs: Date.now() - phase2Start,
        error: 'LLM returned empty result',
      };
      return { phase1, phase2 };
    }

    const nextMemory = result.trimEnd() + '\n';
    let shrinkWarning = false;

    // Backup current MEMORY.md before overwrite, keep latest N versions.
    if (existingMemory !== '(empty)') {
      const versionsDir = join(resolveMemoryRoot(), MEMORY_VERSION_DIR);
      await mkdir(versionsDir, { recursive: true });
      const versionName = `MEMORY.${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
      await atomicWrite(join(versionsDir, versionName), existingMemory);

      const existingVersions = (await readdir(versionsDir))
        .filter((name) => name.startsWith('MEMORY.') && name.endsWith('.md'))
        .sort()
        .reverse();

      const toDelete = existingVersions.slice(MEMORY_VERSION_KEEP);
      for (const oldName of toDelete) {
        try {
          await unlink(join(versionsDir, oldName));
        } catch {
          // Best effort cleanup.
        }
      }
    }

    if (existingMemory !== '(empty)' && existingMemory.length > 0) {
      const ratio = nextMemory.length / existingMemory.length;
      if (ratio < 0.7) {
        shrinkWarning = true;
        console.warn(`Curate warning: MEMORY.md shrank to ${(ratio * 100).toFixed(1)}% of previous size.`);
      }
    }

    await atomicWrite(memoryMdPath, nextMemory);

    // Update state
    state.lastCurate = now().toISOString();
    await saveState(state);

    phase2 = {
      updated: true,
      dailyNotesUsed: reportFiles.length,
      changedEntitiesUsed: changedEntityBlocks.length,
      previousSizeBytes: existingMemory === '(empty)' ? 0 : existingMemory.length,
      newSizeBytes: nextMemory.length,
      shrinkWarning,
      durationMs: Date.now() - phase2Start,
      error: null,
    };

    console.log(`MEMORY.md refreshed from ${reportFiles.length} new note(s) + ${changedEntityBlocks.length} changed entities`);
    return { phase1, phase2 };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`Curate failed: ${message}`);
    process.exitCode = 1;
    if (!phase1) {
      phase1 = {
        dirtyEntities: 0,
        refreshed: 0,
        refreshedPaths: [],
        durationMs: Date.now() - phase1Start,
        error: message,
      };
    } else if (!phase1.error) {
      phase1.error = message;
    }
    if (!summariesOnly && !phase2) {
      phase2 = {
        updated: false,
        dailyNotesUsed: 0,
        changedEntitiesUsed: 0,
        previousSizeBytes: 0,
        newSizeBytes: 0,
        shrinkWarning: false,
        durationMs: 0,
        error: message,
      };
    }
    return { phase1, phase2 };
  }
};
