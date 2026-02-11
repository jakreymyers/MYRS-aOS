import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { runPrompt, runExtractPrompt } from '../llm/claude';
import { CURATE_SYSTEM_PROMPT, CURATE_USER_PROMPT, SUMMARIZE_SYSTEM_PROMPT, fillPrompt } from '../llm/prompts';
import { resolveMemoryRoot, resolveMemoryMdPath, resolveDailyLogDir } from '../utils/paths';
import { loadState, saveState } from '../session/state';
import { loadGraphState, saveGraphState, clearDirtyEntities, updateRefreshTimestamp } from '../knowledge/state';
import { refreshEntitySummary } from '../knowledge/summarize';
import { listEntities } from '../knowledge/entities';

const MAX_REPORT_DAYS = 14;

/**
 * Auto-refresh entity summaries + MEMORY.md.
 *
 * 1. Refresh dirty entity summaries (applying decay tiers)
 * 2. Clear dirtyEntities in graph-state.json
 * 3. Refresh MEMORY.md from hot entities + recent daily notes
 * 4. Update lastSummaryRefresh timestamp
 */
export const runCurate = async (args: string[]): Promise<void> => {
  const summariesOnly = args.includes('--summaries-only');
  const days = Number(args.find(a => a.startsWith('--days='))?.split('=')[1]) || MAX_REPORT_DAYS;

  try {
    // Phase 1: Refresh dirty entity summaries
    const graphState = await loadGraphState();
    if (graphState.dirtyEntities.length > 0) {
      let refreshed = 0;
      for (const entityPath of graphState.dirtyEntities) {
        const ok = await refreshEntitySummary({
          entityPath,
          llmCaller: runExtractPrompt,
          systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
        });
        if (ok) refreshed++;
      }
      await clearDirtyEntities(graphState.dirtyEntities);
      await updateRefreshTimestamp();
      console.log(`Refreshed ${refreshed} entity summaries`);
    }

    if (summariesOnly) return;

    // Phase 2: Refresh MEMORY.md
    const memoryMdPath = resolveMemoryMdPath();
    const reportDir = resolveDailyLogDir();

    let existingMemory = '(empty)';
    try {
      existingMemory = await readFile(memoryMdPath, 'utf8');
    } catch {
      // File doesn't exist yet
    }

    // Read recent daily notes
    let reportFiles: string[] = [];
    try {
      const entries = await readdir(reportDir);
      reportFiles = entries
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, days);
    } catch {
      // No daily notes — use entity context only
    }

    // Build entity context for curate prompt
    const entities = await listEntities();

    // Update entityStats in graph state
    const bucketCounts: Record<string, number> = {};
    for (const e of entities) {
      bucketCounts[e.bucket] = (bucketCounts[e.bucket] ?? 0) + 1;
    }
    const curateGraphState = await loadGraphState();
    curateGraphState.entityStats = {
      total: entities.length,
      projects: bucketCounts.projects ?? 0,
      people: bucketCounts.people ?? 0,
      areas: bucketCounts.areas ?? 0,
      resources: bucketCounts.resources ?? 0,
      archives: bucketCounts.archives ?? 0,
    };
    await saveGraphState(curateGraphState);

    const entityContext = entities.length > 0
      ? entities.map(e => `- ${e.path} (${e.type}, ${e.factCount} facts)`).join('\n')
      : '(no entities yet)';

    const reports: string[] = [];
    for (const file of reportFiles) {
      const content = await readFile(join(reportDir, file), 'utf8');
      reports.push(`### ${file}\n${content}`);
    }

    if (reportFiles.length === 0 && entities.length === 0) {
      console.log('No daily notes or entities — nothing to curate');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const userPrompt = fillPrompt(CURATE_USER_PROMPT, {
      existing_memory: existingMemory,
      daily_reports: reports.join('\n\n---\n\n') || '(none)',
      today,
    });

    const prompt = `${CURATE_SYSTEM_PROMPT}\n\n${userPrompt}`;
    const result = await runPrompt(prompt);

    if (!result.trim()) {
      console.error('Curate: LLM returned empty result');
      process.exitCode = 1;
      return;
    }

    await mkdir(dirname(memoryMdPath), { recursive: true });
    await writeFile(memoryMdPath, result.trimEnd() + '\n');

    // Update state
    const state = await loadState();
    state.lastCurate = new Date().toISOString();
    await saveState(state);

    console.log(`MEMORY.md refreshed from ${reportFiles.length} daily note(s) + ${entities.length} entities`);
  } catch (error: any) {
    console.error(`Curate failed: ${error?.message ?? 'unknown error'}`);
    process.exitCode = 1;
  }
};
