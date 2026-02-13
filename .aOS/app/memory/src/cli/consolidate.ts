import { readFile } from 'node:fs/promises';
import { resolveEntityDir } from '../knowledge/entities';
import { loadFacts } from '../knowledge/facts';
import { runExtractPrompt } from '../llm/claude';
import {
  CONSOLIDATE_SYSTEM_PROMPT,
  CONSOLIDATE_USER_PROMPT,
} from '../llm/prompts';
import {
  consolidateEntity,
  type CandidateFact,
} from '../knowledge/consolidate';
import { applyPlan } from '../knowledge/apply';

const usage = (): void => {
  console.error(`Usage: memory consolidate --entity <path> [--input <json-file>] [--dry-run]`);
};

export const runConsolidate = async (args: string[]): Promise<void> => {
  const entityIdx = args.indexOf('--entity');
  const inputIdx = args.indexOf('--input');
  const dryRun = args.includes('--dry-run');

  const entityPath = entityIdx >= 0 ? args[entityIdx + 1] : undefined;
  const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : undefined;

  if (!entityPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  let candidates: CandidateFact[] = [];
  if (inputPath) {
    try {
      const raw = await readFile(inputPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('input must be an array of candidate facts');
      }
      candidates = parsed as CandidateFact[];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error(`Invalid --input file: ${message}`);
      process.exitCode = 1;
      return;
    }
  }

  const entityDir = resolveEntityDir(entityPath);
  const existingFacts = await loadFacts(entityDir);

  if (candidates.length === 0) {
    console.log('No candidate facts supplied. Use --input <json-file>.');
    return;
  }

  const result = await consolidateEntity({
    entityPath,
    existingFacts,
    candidates,
    llmCaller: runExtractPrompt,
    systemPrompt: CONSOLIDATE_SYSTEM_PROMPT,
    userPromptTemplate: CONSOLIDATE_USER_PROMPT,
  });

  if (dryRun) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const applyResult = await applyPlan({
    entityDir,
    entityPath,
    source: `consolidate:${new Date().toISOString()}`,
    candidates,
    decisions: result.decisions,
  });

  console.log(JSON.stringify({ ...result, applied: applyResult }, null, 2));
};
