import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffEntityManifests, type EntityManifestRow } from '../rebuild/manifest';
import { computeProvenanceCoverage } from '../rebuild/provenance';
import { validateStagingPayload, type StagedEntityPayload } from '../rebuild/staging';
import { orchestrateSwarmRebuild, type SubagentRunner } from '../rebuild/swarm';
import { createCommandSubagentRunner } from '../rebuild/runner';
import { applyStaging } from '../rebuild/apply-staging';
import { cleanGraph } from '../rebuild/clean';

const usage = (): void => {
  console.log(`Usage: memory rebuild <command> [options]

Commands:
  manifest-diff --before <json> --after <json> [--json]
  validate-staging --input <json>
  provenance --dir <staging-dir> [--json]
  orchestrate --manifest <json> --staging-dir <dir> [--max-concurrent N] [--max-calls-per-entity N] [--retries N] [--dry-run] [--json]
  apply-staging --dir <staging-dir> [--dry-run] [--json]
  clean [--json]`);
};

const argValue = (args: string[], flag: string): string | null => {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
};

const readJson = async <T>(path: string): Promise<T> => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
};

const parseIntFlag = (args: string[], flag: string, fallback: number): number => {
  const raw = argValue(args, flag);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const runManifestDiff = async (args: string[]): Promise<void> => {
  const beforePath = argValue(args, '--before');
  const afterPath = argValue(args, '--after');
  const json = args.includes('--json');

  if (!beforePath || !afterPath) {
    console.error('Usage: memory rebuild manifest-diff --before <json> --after <json> [--json]');
    process.exitCode = 1;
    return;
  }

  const before = await readJson<EntityManifestRow[]>(beforePath);
  const after = await readJson<EntityManifestRow[]>(afterPath);
  const diff = diffEntityManifests(before, after);

  if (json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(`Before entities: ${diff.beforeEntityCount}`);
  console.log(`After entities: ${diff.afterEntityCount}`);
  console.log(`Added: ${diff.addedPaths.length}`);
  console.log(`Removed: ${diff.removedPaths.length}`);
  console.log(`Changed fact counts: ${diff.changedFactCounts.length}`);
};

const runValidateStaging = async (args: string[]): Promise<void> => {
  const input = argValue(args, '--input');
  if (!input) {
    console.error('Usage: memory rebuild validate-staging --input <json>');
    process.exitCode = 1;
    return;
  }

  const payload = await readJson<unknown>(input);
  const validation = validateStagingPayload(payload);

  if (!validation.valid) {
    console.error(`invalid staging payload (${validation.errors.length} error(s))`);
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('staging payload is valid');
};

const runProvenanceReport = async (args: string[]): Promise<void> => {
  const dir = argValue(args, '--dir');
  const json = args.includes('--json');
  if (!dir) {
    console.error('Usage: memory rebuild provenance --dir <staging-dir> [--json]');
    process.exitCode = 1;
    return;
  }

  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`unable to read staging dir: ${message}`);
    process.exitCode = 1;
    return;
  }

  const payloads = await Promise.all(entries.map(async (name) =>
    readJson<unknown>(join(dir, name)),
  ));
  const coveragePayloads: Array<Partial<StagedEntityPayload> | null | undefined> =
    payloads.map((payload) => (payload && typeof payload === 'object'
      ? payload as Partial<StagedEntityPayload>
      : null));
  const coverage = computeProvenanceCoverage(coveragePayloads);

  if (json) {
    console.log(JSON.stringify(coverage, null, 2));
    return;
  }

  console.log(`total facts: ${coverage.totalFacts}`);
  console.log(`with provenance: ${coverage.withProvenance}`);
  console.log(`coverage: ${coverage.percent}%`);
};

interface RebuildCliDeps {
  swarmRunner?: SubagentRunner;
  orchestrateSwarmFn?: typeof orchestrateSwarmRebuild;
}

const runOrchestrate = async (args: string[], deps: RebuildCliDeps): Promise<void> => {
  const manifestPath = argValue(args, '--manifest');
  const stagingDir = argValue(args, '--staging-dir');
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const maxConcurrent = parseIntFlag(args, '--max-concurrent', 3);
  const maxCallsPerEntity = parseIntFlag(args, '--max-calls-per-entity', 10);
  const retryLimit = parseIntFlag(args, '--retries', 1);

  if (!manifestPath || !stagingDir) {
    console.error('Usage: memory rebuild orchestrate --manifest <json> --staging-dir <dir> [--max-concurrent N] [--max-calls-per-entity N] [--retries N] [--dry-run] [--json]');
    process.exitCode = 1;
    return;
  }

  const runner = deps.swarmRunner
    ?? (process.env.MEMORY_SWARM_AGENT_CMD
      ? createCommandSubagentRunner(process.env.MEMORY_SWARM_AGENT_CMD)
      : null);

  if (!runner) {
    console.error('No swarm runner configured. Set MEMORY_SWARM_AGENT_CMD or inject runner in code.');
    process.exitCode = 1;
    return;
  }

  const orchestrateSwarmFn = deps.orchestrateSwarmFn ?? orchestrateSwarmRebuild;
  const manifest = await readJson<EntityManifestRow[]>(manifestPath);
  const result = await orchestrateSwarmFn({
    manifest,
    stagingDir,
    runner,
    maxConcurrent,
    maxCallsPerEntity,
    retryLimit,
    dryRun,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Swarm complete: ${result.summary.succeeded}/${result.summary.total} succeeded`);
    console.log(`Failed: ${result.summary.failed}`);
    console.log(`Retried: ${result.summary.retried}`);
    console.log(`Invalid payloads: ${result.summary.invalidPayloads}`);
    console.log(`Budget exceeded: ${result.summary.budgetExceeded}`);
  }

  if (result.summary.failed > 0) {
    process.exitCode = 1;
  }
};

const runApplyStaging = async (args: string[]): Promise<void> => {
  const dir = argValue(args, '--dir');
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  if (!dir) {
    console.error('Usage: memory rebuild apply-staging --dir <staging-dir> [--dry-run] [--json]');
    process.exitCode = 1;
    return;
  }

  const result = await applyStaging({ stagingDir: dir, dryRun });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Entities applied: ${result.entitiesApplied}`);
  console.log(`Facts written: ${result.factsWritten}`);
  if (result.skipped.length > 0) {
    console.log(`Skipped: ${result.skipped.length}`);
    for (const s of result.skipped) {
      console.log(`  - ${s.file}: ${s.reason}`);
    }
  }
  if (dryRun) {
    console.log('(dry run — no files written)');
  }
};

const runClean = async (args: string[]): Promise<void> => {
  const json = args.includes('--json');
  const result = await cleanGraph();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Entities cleared: ${result.entitiesCleared}`);
  console.log(`Session state reset: ${result.sessionStateReset}`);
  console.log(`Graph state reset: ${result.graphStateReset}`);
  console.log(`Pipeline runs truncated: ${result.pipelineRunsTruncated}`);
};

export const runRebuild = async (args: string[], deps: RebuildCliDeps = {}): Promise<void> => {
  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'manifest-diff':
      await runManifestDiff(rest);
      return;
    case 'validate-staging':
      await runValidateStaging(rest);
      return;
    case 'provenance':
      await runProvenanceReport(rest);
      return;
    case 'orchestrate':
      await runOrchestrate(rest, deps);
      return;
    case 'apply-staging':
      await runApplyStaging(rest);
      return;
    case 'clean':
      await runClean(rest);
      return;
    case '--help':
    case '-h':
    case undefined:
      usage();
      return;
    default:
      console.error(`Unknown rebuild command: ${command}`);
      usage();
      process.exitCode = 1;
  }
};
