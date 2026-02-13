import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadState } from '../session/state';
import { resolveMemoryRoot, resolveDailyLogDir, resolveSessionLogDir, resolveVecDbPath } from '../utils/paths';
import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { loadFacts } from '../knowledge/facts';
import { tierFacts } from '../knowledge/decay';
import { loadGraphState } from '../knowledge/state';
import type { SessionStateFile } from '../types';

/**
 * Show memory system stats: session state, daily notes, knowledge graph, vector index.
 */
export const runStats = async (args: string[]): Promise<void> => {
  const jsonOutput = args.includes('--json');
  const state = await loadState();
  const sessionCount = Object.keys(state.sessions).length;
  const digestedCount = Object.values(state.sessions).filter(s => s.digestedAt).length;

  if (jsonOutput) {
    await printJsonStats(state, sessionCount, digestedCount);
    return;
  }

  console.log('=== Session State ===');
  console.log(`Sessions tracked: ${sessionCount}`);
  console.log(`Sessions digested: ${digestedCount}`);
  console.log(`Last digest: ${state.lastDigest ?? 'never'}`);
  console.log(`Last curate: ${state.lastCurate ?? 'never'}`);

  // Count daily notes
  const reportDir = resolveDailyLogDir();
  try {
    const reports = await readdir(reportDir);
    const mdFiles = reports.filter(f => f.endsWith('.md'));
    console.log(`\n=== Daily Notes ===`);
    console.log(`Notes: ${mdFiles.length}`);
    if (mdFiles.length > 0) {
      const sorted = mdFiles.sort().reverse();
      console.log(`Latest: ${sorted[0]}`);
      console.log(`Oldest: ${sorted[sorted.length - 1]}`);
    }
  } catch {
    console.log(`\n=== Daily Notes ===`);
    console.log('No notes directory');
  }

  // Count session logs
  const sessionDir = resolveSessionLogDir();
  try {
    const files = await readdir(sessionDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    console.log(`\n=== Session Logs ===`);
    console.log(`Files: ${jsonlFiles.length}`);
  } catch {
    console.log(`\n=== Session Logs ===`);
    console.log('No session logs directory');
  }

  // MEMORY.md status
  const memoryMdPath = join(resolveMemoryRoot(), 'MEMORY.md');
  try {
    const memStat = await stat(memoryMdPath);
    const lines = (await Bun.file(memoryMdPath).text()).split('\n').length;
    console.log(`\n=== MEMORY.md ===`);
    console.log(`Lines: ${lines}`);
    console.log(`Updated: ${new Date(memStat.mtimeMs).toISOString()}`);
  } catch {
    console.log(`\n=== MEMORY.md ===`);
    console.log('Not yet created');
  }

  // Knowledge Graph
  console.log(`\n=== Knowledge Graph ===`);
  const entities = await listEntities();
  const today = new Date().toISOString().slice(0, 10);
  let totalFacts = 0;
  let totalHot = 0;
  let totalWarm = 0;
  let totalCold = 0;
  const bucketCounts: Record<string, number> = {};

  for (const entity of entities) {
    const dir = resolveEntityDir(entity.path);
    const facts = await loadFacts(dir);
    const tiered = tierFacts(facts, today);
    totalFacts += facts.length;
    totalHot += tiered.filter(f => f.tier === 'hot').length;
    totalWarm += tiered.filter(f => f.tier === 'warm').length;
    totalCold += tiered.filter(f => f.tier === 'cold').length;
    bucketCounts[entity.bucket] = (bucketCounts[entity.bucket] ?? 0) + 1;
  }

  console.log(`Entities: ${entities.length}`);
  if (entities.length > 0) {
    for (const [bucket, count] of Object.entries(bucketCounts)) {
      console.log(`  ${bucket}: ${count}`);
    }
    console.log(`Facts: ${totalFacts} (${totalHot} hot, ${totalWarm} warm, ${totalCold} cold)`);
  }

  const graphState = await loadGraphState();
  console.log(`Dirty entities: ${graphState.dirtyEntities.length}`);
  console.log(`Last summary refresh: ${graphState.lastSummaryRefresh ?? 'never'}`);
  console.log(`Last extraction: ${graphState.lastExtraction ?? 'never'}`);

  // Vector index status
  console.log(`\n=== Vector Index ===`);
  try {
    const vecDbPath = resolveVecDbPath();
    const vecStat = await stat(vecDbPath);
    const sizeMB = (vecStat.size / 1024 / 1024).toFixed(1);
    console.log(`Database: ${vecDbPath}`);
    console.log(`Size: ${sizeMB} MB`);
    console.log(`Updated: ${new Date(vecStat.mtimeMs).toISOString()}`);
  } catch {
    console.log('Not initialized. Run `memory vec sync` to create.');
  }
};

const printJsonStats = async (
  state: SessionStateFile,
  sessionCount: number,
  digestedCount: number
): Promise<void> => {
  const entities = await listEntities();
  const graphState = await loadGraphState();

  const output = {
    sessions: { tracked: sessionCount, digested: digestedCount, lastDigest: state.lastDigest, lastCurate: state.lastCurate },
    entities: { total: entities.length, byBucket: {} as Record<string, number> },
    graph: graphState,
  };

  for (const e of entities) {
    output.entities.byBucket[e.bucket] = (output.entities.byBucket[e.bucket] ?? 0) + 1;
  }

  console.log(JSON.stringify(output, null, 2));
};
