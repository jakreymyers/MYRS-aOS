import { searchNative, type FactRef } from '../search/native';
import { searchFusion } from '../search/fusion';
import { searchVec } from '../vector/search';
import { disposeEmbedder } from '../vector/embed';
import { batchTouchFacts } from '../knowledge/facts';

/**
 * Search memory via fusion (default), keyword, or vector search.
 *
 * Strategies (fastest → highest quality):
 *   memory search <query>                     Fusion search (keyword + vector, default)
 *   memory search <query> --keyword           Native keyword search (~27ms)
 *   memory search <query> --vec               sqlite-vec embedding search (~67ms)
 *   memory search <query> --scope entities    Restrict to entity summaries
 *   memory search <query> --scope facts       Restrict to atomic facts
 *   memory search <query> --scope notes       Restrict to daily notes
 *   memory search <query> --json              JSON output
 *   memory search <query> -n 5               Limit results
 */
export const runSearch = async (args: string[]): Promise<void> => {
  const queryParts: string[] = [];
  let json = false;
  let limit = 10;
  let method: 'fusion' | 'keyword' | 'vec' = 'fusion';
  let minScore: number | undefined;
  let scope: 'all' | 'entities' | 'notes' | 'facts' = 'all';
  let vectorWeight: number | undefined;
  let textWeight: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--keyword') method = 'keyword';
    else if (arg === '--fusion') method = 'fusion';
    else if (arg === '--vec') method = 'vec';
    else if (arg === '-n' && args[i + 1]) limit = Number(args[++i]);
    else if (arg === '--min-score' && args[i + 1]) minScore = Number(args[++i]);
    else if (arg === '--scope' && args[i + 1]) scope = args[++i] as typeof scope;
    else if (arg === '--vector-weight' && args[i + 1]) vectorWeight = Number(args[++i]);
    else if (arg === '--text-weight' && args[i + 1]) textWeight = Number(args[++i]);
    else queryParts.push(arg);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    console.error(`Usage: memory search <query> [options]

Strategies:
  (default)     Fusion search: keyword + vector, 70/30 weighted (~72ms)
  --keyword     Native keyword search (~27ms)
  --vec         sqlite-vec embedding search (~67ms)

Scope:
  --scope entities    Search entity summaries only
  --scope facts       Search atomic facts only
  --scope notes       Search daily notes only

Options:
  --json                 JSON output
  -n <limit>             Limit results (default: 10)
  --min-score <n>        Minimum score threshold
  --vector-weight <n>    Fusion vector weight (default: 0.7)
  --text-weight <n>      Fusion text weight (default: 0.3)`);
    process.exitCode = 1;
    return;
  }

  // sqlite-vec embedding search
  if (method === 'vec') {
    const result = await searchVec({ query, limit });
    await disposeEmbedder();

    if (!result.success) {
      console.error(`Vec search failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }

    if (json) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (result.data.length === 0) {
      console.log('No results found. Run `memory vec sync` to index content.');
      return;
    }

    for (const item of result.data) {
      const score = item.score.toFixed(3);
      console.log(`[${score}] ${item.snippet}`);
      if (item.file) console.log(`  ${item.file}`);
    }
    return;
  }

  // Native keyword search
  if (method === 'keyword') {
    const result = await searchNative({ query, limit, scope });
    if (!result.success) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }

    const { results: items, matchedFacts } = result.data;

    if (json) {
      console.log(JSON.stringify(items, null, 2));
    } else if (items.length === 0) {
      console.log('No results found. Try without --keyword for fusion search.');
    } else {
      for (const item of items) {
        const score = item.score.toFixed(3);
        console.log(`[${score}] ${item.snippet}`);
        if (item.file) console.log(`  ${item.file}`);
      }
    }

    // Fire-and-forget access tracking
    if (matchedFacts.length > 0) batchTouchFacts(matchedFacts).catch(() => {});
    return;
  }

  // Fusion search (keyword + sqlite-vec, weighted merge) — default
  const result = await searchFusion({
    query,
    limit,
    vectorWeight,
    textWeight,
    scope,
    minScore,
  });
  await disposeEmbedder();

  if (!result.success) {
    console.error(`Fusion search failed: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const { results: items, matchedFacts } = result.data;

  if (json) {
    console.log(JSON.stringify(items, null, 2));
  } else if (items.length === 0) {
    console.log('No results found.');
  } else {
    for (const item of items) {
      const score = item.score.toFixed(3);
      console.log(`[${score}] ${item.snippet}`);
      if (item.file) console.log(`  ${item.file}`);
    }
  }

  // Fire-and-forget access tracking
  if (matchedFacts.length > 0) batchTouchFacts(matchedFacts).catch(() => {});
};
