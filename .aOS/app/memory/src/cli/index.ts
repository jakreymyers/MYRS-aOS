import { runMirror } from './mirror';
import { runDigest } from './digest';
import { runCheck } from './check';
import { runCurate } from './curate';
import { runSearch } from './search';
import { runStats } from './stats';
import { runEntityCmd } from './entity-cmd';
import { runDecayCmd } from './decay-cmd';
import { runVecCmd } from './vec-cmd';
import { runBenchmarkCmd } from '../benchmark/run';
import { runConsolidate } from './consolidate';
import { runRecall } from './recall';
import { runDoctor } from './doctor';
import { runAlerts } from './alerts';
import { runRebuild } from './rebuild';

const printHelp = () => {
  console.log(`memory <command> [options]

Session Commands:
  session-mirror              Mirror current session log (fast, sync)
  session-digest [--force] [--no-consolidate] [--no-curate]
                              Extract facts from session logs
  session-check               Check state at session start

Knowledge Graph Commands:
  entity list [--bucket <b>]  List entities with fact counts
  entity show <path>          Display entity summary + facts
  entity create <path>        Create new entity
  entity archive <path>       Move entity to archives
  entity graph <path>         Show related entities
  consolidate --entity <p>    Consolidate candidate facts for one entity

Memory Maintenance:
  curate [--summaries-only]   Refresh summaries + MEMORY.md
  decay status                Show tier distribution
  decay refresh [--force]     Rewrite dirty summaries
  decay touch <entity> <id>   Mark fact as accessed

Search:
  search <query>              Fusion search (keyword + vector, default)
  recall <query>              Fusion recall + entity expansion (primary)
  search <query> --keyword    Native keyword only (~27ms)
  search <query> --vec        Vector embedding only (~67ms)
  search <query> --scope X    Restrict: entities, facts, or notes

Vector Index:
  vec sync [--force]          Index summaries + notes into sqlite-vec
  vec status                  Show vector index stats

Benchmark:
  benchmark [--json]          Run search benchmark (20 queries × 3 strategies)
  benchmark --strategy <s>    Run one strategy only
  benchmark --category <c>    Run one category only

Diagnostics:
  stats [--json]              Full system statistics
  doctor [--json]             Validate memory system integrity
  alerts [--json]             Show upcoming/stale/critical alerts
  rebuild <subcommand>        Rebuild helpers (manifest-diff, validate-staging, provenance, orchestrate)
  help                        Show this help
`);
};

export const runCli = async (argv: string[]): Promise<void> => {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'session-mirror':
      await runMirror(args.slice(1));
      break;
    case 'session-digest':
      await runDigest(args.slice(1));
      break;
    case 'session-check':
      await runCheck(args.slice(1));
      break;
    case 'curate':
      await runCurate(args.slice(1));
      break;
    case 'search':
      await runSearch(args.slice(1));
      break;
    case 'recall':
      await runRecall(args.slice(1));
      break;
    case 'stats':
      await runStats(args.slice(1));
      break;
    case 'doctor':
      await runDoctor(args.slice(1));
      break;
    case 'alerts':
      await runAlerts(args.slice(1));
      break;
    case 'rebuild':
      await runRebuild(args.slice(1));
      break;
    case 'entity':
      await runEntityCmd(args.slice(1));
      break;
    case 'decay':
      await runDecayCmd(args.slice(1));
      break;
    case 'vec':
      await runVecCmd(args.slice(1));
      break;
    case 'benchmark':
      await runBenchmarkCmd(args.slice(1));
      break;
    case 'consolidate':
      await runConsolidate(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
};
