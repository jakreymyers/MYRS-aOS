import { searchNative, type FactRef } from './native';
import { searchVec } from '../vector/search';
import { disposeEmbedder } from '../vector/embed';
import type { Result, SearchResult } from '../types';

interface FusionOptions {
  query: string;
  limit: number;
  vectorWeight?: number;   // default 0.7
  textWeight?: number;     // default 0.3
  candidateMultiplier?: number; // default 4
  scope?: 'all' | 'entities' | 'notes' | 'facts';
  minScore?: number;
}

interface ScoredCandidate {
  textScore: number;
  vectorScore: number;
  fusionScore: number;
  bestSnippet: string;
  bestContent: string;
  entity: string;
  sources: ('keyword' | 'vector')[];
}

/**
 * Normalize a file path to an entity-level key for deduplication.
 * - Native results: "people/sandy-weldon" or "people/sandy-weldon/summary.md"
 * - Vec results: "people/sandy-weldon" (entity path from source field)
 * - Daily notes: "daily-notes/2026-02-08.md"
 */
const toEntityKey = (file?: string): string => {
  if (!file) return '_unknown';
  const normalized = file
    .replace(/\/summary\.md$/, '')     // strip /summary.md
    .replace(/\/items\.json$/, '');    // strip /items.json
  return normalized;
};

/**
 * Fusion search: combines native keyword (BM25-like) with sqlite-vec embedding
 * using weighted score fusion. No subprocess dependency.
 *
 * How it works:
 * 1. Run native keyword and sqlite-vec in parallel with expanded candidate pools
 * 2. Normalize file paths to entity-level keys
 * 3. For each entity, take best score from each source
 * 4. Compute: fusionScore = vectorWeight * vectorScore + textWeight * textScore
 * 5. Entities found by both sources naturally rank higher
 */
interface FusionSearchResult {
  results: SearchResult[];
  matchedFacts: FactRef[];
}

export const searchFusion = async (options: FusionOptions): Promise<Result<FusionSearchResult>> => {
  const {
    query,
    limit,
    vectorWeight: rawVectorWeight,
    textWeight: rawTextWeight,
    candidateMultiplier = 4,
    scope = 'all',
    minScore,
  } = options;

  // Normalize weights to sum to 1.0
  const rawVW = rawVectorWeight ?? 0.7;
  const rawTW = rawTextWeight ?? 0.3;
  const total = rawVW + rawTW;
  const vectorWeight = rawVW / total;
  const textWeight = rawTW / total;

  const candidateLimit = limit * candidateMultiplier;

  // Run keyword and sqlite-vec in parallel
  const [keywordResult, vectorResult] = await Promise.all([
    searchNative({ query, limit: candidateLimit, scope }),
    searchVec({ query, limit: candidateLimit }),
  ]);

  // Collect matched fact refs from keyword search for access tracking
  const matchedFacts: FactRef[] = keywordResult.success ? keywordResult.data.matchedFacts : [];

  // Build candidate map keyed by entity
  const candidates = new Map<string, ScoredCandidate>();

  // Process keyword results
  if (keywordResult.success) {
    for (const result of keywordResult.data.results) {
      const key = toEntityKey(result.file);
      const existing = candidates.get(key);
      if (existing) {
        if (result.score > existing.textScore) {
          existing.textScore = result.score;
          // Prefer fact-level snippets from keyword (more precise)
          existing.bestSnippet = result.snippet;
          existing.bestContent = result.content;
        }
        if (!existing.sources.includes('keyword')) existing.sources.push('keyword');
      } else {
        candidates.set(key, {
          textScore: result.score,
          vectorScore: 0,
          fusionScore: 0,
          bestSnippet: result.snippet,
          bestContent: result.content,
          entity: key,
          sources: ['keyword'],
        });
      }
    }
  }

  // Process vector results
  if (vectorResult.success) {
    for (const result of vectorResult.data) {
      const key = toEntityKey(result.file);
      const existing = candidates.get(key);
      if (existing) {
        if (result.score > existing.vectorScore) {
          existing.vectorScore = result.score;
          // If no keyword snippet, use vector's
          if (!existing.sources.includes('keyword')) {
            existing.bestSnippet = result.snippet;
            existing.bestContent = result.content;
          }
        }
        if (!existing.sources.includes('vector')) existing.sources.push('vector');
      } else {
        candidates.set(key, {
          textScore: 0,
          vectorScore: result.score,
          fusionScore: 0,
          bestSnippet: result.snippet,
          bestContent: result.content,
          entity: key,
          sources: ['vector'],
        });
      }
    }
  }

  // If both backends failed, return error
  if (!keywordResult.success && !vectorResult.success) {
    return { success: false, error: `Both search backends failed. Keyword: ${keywordResult.error}. Vector: ${vectorResult.error}` };
  }

  // Compute fusion scores
  for (const candidate of candidates.values()) {
    candidate.fusionScore = vectorWeight * candidate.vectorScore + textWeight * candidate.textScore;
  }

  // Sort by fusion score descending, take top N
  const sorted = [...candidates.values()]
    .sort((a, b) => b.fusionScore - a.fusionScore)
    .slice(0, limit);

  const results: SearchResult[] = sorted.map((c) => ({
    content: c.bestContent,
    snippet: c.bestSnippet,
    score: c.fusionScore,
    file: c.entity,
  }));

  return { success: true, data: { results, matchedFacts } };
};
