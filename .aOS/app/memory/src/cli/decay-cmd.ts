import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { loadFacts, touchFact } from '../knowledge/facts';
import { tierFacts } from '../knowledge/decay';
import { loadGraphState } from '../knowledge/state';
import { refreshEntitySummary } from '../knowledge/summarize';
import { runExtractPrompt } from '../llm/claude';
import { SUMMARIZE_SYSTEM_PROMPT } from '../llm/prompts';

/**
 * CLI: memory decay <action> [args]
 *
 * Actions: status, refresh, touch
 */
export const runDecayCmd = async (args: string[]): Promise<void> => {
  const action = args[0];

  switch (action) {
    case 'status':
      await decayStatus();
      break;
    case 'refresh':
      await decayRefresh(args.slice(1));
      break;
    case 'touch':
      await decayTouch(args.slice(1));
      break;
    default:
      console.log(`Usage: memory decay <status|refresh|touch> [args]

  decay status                Show tier distribution
  decay refresh [--force]     Rewrite dirty summaries
  decay touch <entity> <id>   Mark fact as accessed`);
      if (action) {
        console.error(`Unknown action: ${action}`);
        process.exitCode = 1;
      }
  }
};

const decayStatus = async (): Promise<void> => {
  const entities = await listEntities();
  const today = new Date().toISOString().slice(0, 10);

  let totalHot = 0;
  let totalWarm = 0;
  let totalCold = 0;
  let totalFacts = 0;

  for (const entity of entities) {
    const dir = resolveEntityDir(entity.path);
    const facts = await loadFacts(dir);
    const tiered = tierFacts(facts, today);
    totalHot += tiered.filter((f) => f.tier === 'hot').length;
    totalWarm += tiered.filter((f) => f.tier === 'warm').length;
    totalCold += tiered.filter((f) => f.tier === 'cold').length;
    totalFacts += facts.length;
  }

  const graphState = await loadGraphState();

  console.log('=== Decay Status ===');
  console.log(`Entities: ${entities.length}`);
  console.log(`Total facts: ${totalFacts}`);
  console.log(`  Hot:  ${totalHot}`);
  console.log(`  Warm: ${totalWarm}`);
  console.log(`  Cold: ${totalCold}`);
  console.log(`Dirty entities: ${graphState.dirtyEntities.length}`);
  console.log(`Last summary refresh: ${graphState.lastSummaryRefresh ?? 'never'}`);
};

const decayRefresh = async (args: string[]): Promise<void> => {
  const force = args.includes('--force');
  const graphState = await loadGraphState();

  const toRefresh = force
    ? (await listEntities()).map((e) => e.path)
    : graphState.dirtyEntities;

  if (toRefresh.length === 0) {
    console.log('No entities need summary refresh');
    return;
  }

  let refreshed = 0;
  for (const path of toRefresh) {
    const ok = await refreshEntitySummary({
      entityPath: path,
      llmCaller: runExtractPrompt,
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    });
    if (ok) refreshed++;
  }

  console.log(`Refreshed ${refreshed}/${toRefresh.length} entity summaries`);
};

const decayTouch = async (args: string[]): Promise<void> => {
  const entityPath = args[0];
  const factId = args[1];

  if (!entityPath || !factId) {
    console.error('Usage: memory decay touch <entity-path> <fact-id>');
    process.exitCode = 1;
    return;
  }

  const dir = resolveEntityDir(entityPath);
  const result = await touchFact(dir, factId);

  if (result) {
    console.log(`Touched fact ${factId} in ${entityPath}`);
  } else {
    console.error(`Fact ${factId} not found in ${entityPath}`);
    process.exitCode = 1;
  }
};
