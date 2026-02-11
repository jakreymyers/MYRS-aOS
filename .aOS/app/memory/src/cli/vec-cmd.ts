import { syncVectors } from '../vector/sync';
import { openVecDb, getStats } from '../vector/db';

/**
 * Vector index management commands.
 *
 *   memory vec sync [--force] [--verbose]   Sync entity summaries + daily notes
 *   memory vec status                       Show vector index stats
 */
export const runVecCmd = async (args: string[]): Promise<void> => {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help') {
    console.log(`memory vec <subcommand>

Subcommands:
  sync [--force] [--verbose]   Index entity summaries + daily notes
  status                       Show vector index statistics`);
    return;
  }

  switch (subcommand) {
    case 'sync': {
      const force = args.includes('--force');
      const verbose = args.includes('--verbose');
      console.log(force ? 'Force re-indexing all content...' : 'Syncing vector index...');
      const start = performance.now();
      const result = await syncVectors({ force, verbose });
      const elapsed = (performance.now() - start).toFixed(0);
      console.log(`Done in ${elapsed}ms: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ${result.unchanged} unchanged (${result.total} total)`);
      break;
    }

    case 'status': {
      try {
        const db = openVecDb();
        const stats = getStats(db);
        console.log(`=== Vector Index ===`);
        console.log(`Documents: ${stats.documentCount}`);
        if (Object.keys(stats.sourceBreakdown).length > 0) {
          console.log(`\nSources:`);
          for (const [source, count] of Object.entries(stats.sourceBreakdown)) {
            console.log(`  ${source}: ${count}`);
          }
        }
        db.close();
      } catch (error: any) {
        console.error(`Vector index not available: ${error?.message}`);
        process.exitCode = 1;
      }
      break;
    }

    default:
      console.error(`Unknown vec subcommand: ${subcommand}`);
      process.exitCode = 1;
  }
};
