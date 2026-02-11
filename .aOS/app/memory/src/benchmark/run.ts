import { searchNative } from '../search/native';
import { searchVec } from '../vector/search';
import { searchFusion } from '../search/fusion';
import { disposeEmbedder } from '../vector/embed';
import { BENCHMARK_QUERIES, type BenchmarkQuery } from './queries';
import type { SearchResult, Result } from '../types';

type Strategy = 'keyword' | 'vec' | 'fusion';

interface QueryResult {
  queryId: number;
  strategy: Strategy;
  results: SearchResult[];
  latencyMs: number;
  error?: string;
}

interface QueryMetrics {
  queryId: number;
  category: string;
  query: string;
  strategy: Strategy;
  precisionAt5: number;
  recallAt10: number;
  mrr: number;
  latencyMs: number;
  topResultRelevant: boolean;
  relevantFound: string[];
  relevantMissed: string[];
  noiseScore?: number;
}

const ALL_STRATEGIES: Strategy[] = ['keyword', 'vec', 'fusion'];

/**
 * Normalize a search result file path to an entity key for matching against ground truth.
 * Strips /summary.md, daily-notes/ prefix, etc.
 */
const normalizeToEntityKey = (file?: string): string => {
  if (!file) return '';
  return file
    .replace(/\/summary\.md$/, '')
    .replace(/\/items\.json$/, '');
};

/**
 * Check if a result file path matches any of the expected entity paths.
 * Uses prefix matching so "areas/departments/finance" matches results from
 * "areas/departments/finance/summary.md".
 */
const isRelevant = (resultFile: string, expectedEntities: string[]): boolean => {
  const normalized = normalizeToEntityKey(resultFile);
  return expectedEntities.some(expected =>
    normalized === expected || normalized.startsWith(expected + '/')
  );
};

const runStrategy = async (
  strategy: Strategy,
  query: string,
  limit: number,
): Promise<{ results: SearchResult[]; error?: string }> => {
  switch (strategy) {
    case 'keyword': {
      const r = await searchNative({ query, limit });
      if (!r.success) return { results: [], error: r.error };
      return { results: r.data.results };
    }
    case 'vec': {
      const r = await searchVec({ query, limit });
      if (!r.success) return { results: [], error: r.error };
      return { results: r.data };
    }
    case 'fusion': {
      const r = await searchFusion({ query, limit });
      if (!r.success) return { results: [], error: r.error };
      return { results: r.data.results };
    }
  }
};

const computeMetrics = (
  bq: BenchmarkQuery,
  strategy: Strategy,
  results: SearchResult[],
  latencyMs: number,
): QueryMetrics => {
  // For noise queries, compute noise score (how many false positives with score > 0.3)
  if (bq.expectNoise) {
    const noiseThreshold = 0.3;
    const noiseCount = results.filter(r => r.score > noiseThreshold).length;
    return {
      queryId: bq.id,
      category: bq.category,
      query: bq.query,
      strategy,
      precisionAt5: noiseCount === 0 ? 1 : 0,
      recallAt10: 1, // Nothing to recall
      mrr: noiseCount === 0 ? 1 : 0,
      latencyMs,
      topResultRelevant: noiseCount === 0,
      relevantFound: [],
      relevantMissed: [],
      noiseScore: noiseCount,
    };
  }

  const top5 = results.slice(0, 5);
  const top10 = results.slice(0, 10);

  // Precision@5: fraction of top-5 results that are relevant
  const relevantInTop5 = top5.filter(r => isRelevant(r.file ?? '', bq.expectedEntities)).length;
  const precisionAt5 = top5.length > 0 ? relevantInTop5 / Math.min(5, top5.length) : 0;

  // Recall@10: fraction of expected entities found in top-10
  const foundEntities = new Set<string>();
  for (const r of top10) {
    const key = normalizeToEntityKey(r.file ?? '');
    for (const expected of bq.expectedEntities) {
      if (key === expected || key.startsWith(expected + '/')) {
        foundEntities.add(expected);
      }
    }
  }
  const recallAt10 = bq.expectedEntities.length > 0
    ? foundEntities.size / bq.expectedEntities.length
    : 1;

  // MRR: 1/rank of first relevant result
  let mrr = 0;
  for (let i = 0; i < results.length; i++) {
    if (isRelevant(results[i].file ?? '', bq.expectedEntities)) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const relevantFound = [...foundEntities];
  const relevantMissed = bq.expectedEntities.filter(e => !foundEntities.has(e));

  return {
    queryId: bq.id,
    category: bq.category,
    query: bq.query,
    strategy,
    precisionAt5,
    recallAt10,
    mrr,
    latencyMs,
    topResultRelevant: results.length > 0 && isRelevant(results[0].file ?? '', bq.expectedEntities),
    relevantFound,
    relevantMissed,
  };
};

export const runBenchmark = async (options: {
  strategies?: Strategy[];
  categories?: string[];
  json?: boolean;
}): Promise<void> => {
  const {
    strategies = ALL_STRATEGIES,
    categories,
    json = false,
  } = options;

  const activeStrategies = strategies;

  const queries = categories
    ? BENCHMARK_QUERIES.filter(q => categories.includes(q.category))
    : BENCHMARK_QUERIES;

  if (!json) {
    console.log(`Running ${queries.length} queries × ${activeStrategies.length} strategies...\n`);
  }

  const allMetrics: QueryMetrics[] = [];

  for (const bq of queries) {
    for (const strategy of activeStrategies) {
      const start = performance.now();
      const { results, error } = await runStrategy(strategy, bq.query, 10);
      const elapsed = performance.now() - start;

      if (error) {
        if (!json) console.log(`  [${strategy}] Q${bq.id} ERROR: ${error}`);
        allMetrics.push({
          queryId: bq.id, category: bq.category, query: bq.query, strategy,
          precisionAt5: 0, recallAt10: 0, mrr: 0, latencyMs: elapsed,
          topResultRelevant: false, relevantFound: [], relevantMissed: bq.expectedEntities,
        });
        continue;
      }

      const metrics = computeMetrics(bq, strategy, results, elapsed);
      allMetrics.push(metrics);

      if (!json) {
        const status = metrics.mrr >= 0.5 ? '✓' : metrics.mrr > 0 ? '~' : '✗';
        console.log(`  [${strategy.padEnd(7)}] Q${String(bq.id).padStart(2)}: P@5=${metrics.precisionAt5.toFixed(2)} R@10=${metrics.recallAt10.toFixed(2)} MRR=${metrics.mrr.toFixed(2)} ${metrics.latencyMs.toFixed(0).padStart(6)}ms ${status}`);
      }
    }
  }

  // Dispose embedder after all vector-related searches
  await disposeEmbedder();

  if (json) {
    console.log(JSON.stringify(allMetrics, null, 2));
    return;
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY BY STRATEGY');
  console.log('='.repeat(80));

  for (const strategy of activeStrategies) {
    const metrics = allMetrics.filter(m => m.strategy === strategy);
    const avgP5 = metrics.reduce((sum, m) => sum + m.precisionAt5, 0) / metrics.length;
    const avgR10 = metrics.reduce((sum, m) => sum + m.recallAt10, 0) / metrics.length;
    const avgMRR = metrics.reduce((sum, m) => sum + m.mrr, 0) / metrics.length;
    const avgLatency = metrics.reduce((sum, m) => sum + m.latencyMs, 0) / metrics.length;
    const topHits = metrics.filter(m => m.topResultRelevant).length;

    console.log(`\n${strategy.toUpperCase()}`);
    console.log(`  Avg Precision@5:  ${avgP5.toFixed(3)}`);
    console.log(`  Avg Recall@10:    ${avgR10.toFixed(3)}`);
    console.log(`  Avg MRR:          ${avgMRR.toFixed(3)}`);
    console.log(`  Avg Latency:      ${avgLatency.toFixed(0)}ms`);
    console.log(`  Top-1 hits:       ${topHits}/${metrics.length}`);
  }

  // Category breakdown
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY BY CATEGORY');
  console.log('='.repeat(80));

  const cats = [...new Set(queries.map(q => q.category))];
  for (const cat of cats) {
    console.log(`\n${cat.toUpperCase()}`);
    for (const strategy of activeStrategies) {
      const metrics = allMetrics.filter(m => m.category === cat && m.strategy === strategy);
      if (metrics.length === 0) continue;
      const avgP5 = metrics.reduce((sum, m) => sum + m.precisionAt5, 0) / metrics.length;
      const avgMRR = metrics.reduce((sum, m) => sum + m.mrr, 0) / metrics.length;
      const avgLatency = metrics.reduce((sum, m) => sum + m.latencyMs, 0) / metrics.length;
      console.log(`  ${strategy.padEnd(7)}: P@5=${avgP5.toFixed(2)} MRR=${avgMRR.toFixed(2)} ${avgLatency.toFixed(0)}ms`);
    }
  }

  // Winner analysis
  console.log('\n' + '='.repeat(80));
  console.log('PER-QUERY WINNER (by MRR, latency as tiebreaker)');
  console.log('='.repeat(80));

  for (const bq of queries) {
    const qMetrics = allMetrics.filter(m => m.queryId === bq.id);
    const best = qMetrics.reduce((a, b) => {
      if (b.mrr > a.mrr) return b;
      if (b.mrr === a.mrr && b.latencyMs < a.latencyMs) return b;
      return a;
    });
    const ties = qMetrics.filter(m => m.mrr === best.mrr).map(m => m.strategy);
    console.log(`  Q${String(bq.id).padStart(2)} [${bq.category.padEnd(14)}]: ${ties.join(', ').padEnd(30)} (MRR=${best.mrr.toFixed(2)})`);
  }
};

// CLI entry point
export const runBenchmarkCmd = async (args: string[]): Promise<void> => {
  const json = args.includes('--json');
  let strategies: Strategy[] | undefined;
  let categories: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--strategy' && args[i + 1]) {
      strategies = [args[++i] as Strategy];
    }
    if (args[i] === '--category' && args[i + 1]) {
      categories = [args[++i]];
    }
  }

  await runBenchmark({ strategies, categories, json });
};
