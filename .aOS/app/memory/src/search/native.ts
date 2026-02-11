import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolveContextRoot, resolveMemoryRoot } from '../utils/paths';
import type { Result, SearchResult } from '../types';

export interface FactRef {
  entityDir: string;
  factId: string;
}

interface NativeSearchOptions {
  query: string;
  limit: number;
  scope?: 'all' | 'entities' | 'notes' | 'facts';
  contextRoot?: string;
  memoryRoot?: string;
}

interface NativeSearchResult {
  results: SearchResult[];
  matchedFacts: FactRef[];
}

/**
 * Native keyword search across the knowledge graph and daily notes.
 * No external dependencies — uses regex matching with scoring.
 *
 * Searches: entity summaries, fact text, daily notes.
 * Returns matched fact refs for access tracking.
 */
export const searchNative = async (options: NativeSearchOptions): Promise<Result<NativeSearchResult>> => {
  const { query, limit, scope = 'all', contextRoot, memoryRoot } = options;
  const results: SearchResult[] = [];
  const matchedFacts: FactRef[] = [];

  const terms = tokenize(query);
  if (terms.length === 0) {
    return { success: false, error: 'Empty query' };
  }

  try {
    if (scope === 'all' || scope === 'entities') {
      await searchEntities(terms, results, contextRoot);
    }

    if (scope === 'all' || scope === 'facts') {
      await searchFacts(terms, results, matchedFacts, contextRoot);
    }

    if (scope === 'all' || scope === 'notes') {
      await searchDailyNotes(terms, results, memoryRoot);
    }

    // Score and sort
    results.sort((a, b) => b.score - a.score);
    return { success: true, data: { results: results.slice(0, limit), matchedFacts } };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Search failed' };
  }
};

// --- Tokenization ---

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'that',
  'this', 'it', 'its', 'and', 'or', 'but', 'not', 'no', 'so', 'if',
  'what', 'who', 'how', 'when', 'where', 'which', 'why',
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[\s\-_/.,;:!?'"()\[\]{}]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

// --- Scoring ---

const scoreContent = (content: string, terms: string[]): number => {
  const lower = content.toLowerCase();
  let score = 0;

  for (const term of terms) {
    // Exact word match (higher weight)
    const wordRegex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    const exactMatches = (lower.match(wordRegex) || []).length;
    score += exactMatches * 2;

    // Substring match (lower weight)
    if (exactMatches === 0 && lower.includes(term)) {
      score += 1;
    }
  }

  // Bonus for matching all terms
  const matchedTerms = terms.filter((t) => lower.includes(t)).length;
  if (matchedTerms === terms.length && terms.length > 1) {
    score *= 1.5;
  }

  return score;
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractSnippet = (content: string, terms: string[], maxLen = 300): string => {
  const lower = content.toLowerCase();

  // Find the best match position
  let bestPos = 0;
  let bestScore = 0;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) {
      const localScore = terms.filter((t) => lower.indexOf(t, Math.max(0, idx - 150)) < idx + 150 && lower.indexOf(t, Math.max(0, idx - 150)) >= 0).length;
      if (localScore > bestScore) {
        bestScore = localScore;
        bestPos = idx;
      }
    }
  }

  const start = Math.max(0, bestPos - 100);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end).trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
};

// --- Search targets ---

const PARA_BUCKETS = ['projects', 'people', 'areas', 'resources', 'archives'];

const searchEntities = async (terms: string[], results: SearchResult[], contextRoot?: string): Promise<void> => {
  const root = contextRoot ?? resolveContextRoot();

  for (const bucket of PARA_BUCKETS) {
    const bucketDir = join(root, bucket);
    await walkForFiles(bucketDir, 'summary.md', async (filePath) => {
      const content = await readFile(filePath, 'utf8');
      const score = scoreContent(content, terms);
      if (score > 0) {
        const relPath = relative(root, filePath);
        results.push({
          content: extractSnippet(content, terms),
          snippet: extractSnippet(content, terms, 200),
          score: normalizeScore(score, content.length),
          file: relPath,
        });
      }
    });
  }
};

const searchFacts = async (terms: string[], results: SearchResult[], matchedFacts: FactRef[], contextRoot?: string): Promise<void> => {
  const root = contextRoot ?? resolveContextRoot();

  for (const bucket of PARA_BUCKETS) {
    const bucketDir = join(root, bucket);
    await walkForFiles(bucketDir, 'items.json', async (filePath) => {
      try {
        const content = await readFile(filePath, 'utf8');
        const facts = JSON.parse(content);
        if (!Array.isArray(facts)) return;

        const entityDir = join(filePath, '..');
        const entityPath = relative(root, entityDir);

        for (const fact of facts) {
          if (typeof fact.fact !== 'string') continue;
          const score = scoreContent(fact.fact, terms);
          if (score > 0) {
            const status = fact.status === 'superseded' ? ' [superseded]' : '';
            results.push({
              content: `[${fact.category ?? 'unknown'}] ${fact.fact}${status}`,
              snippet: fact.fact,
              score: normalizeScore(score, fact.fact.length) * 1.2, // Boost facts — they're atomic and precise
              file: entityPath,
            });
            if (fact.id) {
              matchedFacts.push({ entityDir, factId: fact.id });
            }
          }
        }
      } catch {
        // Skip malformed items.json
      }
    });
  }
};

const searchDailyNotes = async (terms: string[], results: SearchResult[], memoryRoot?: string): Promise<void> => {
  const root = memoryRoot ?? resolveMemoryRoot();
  const notesDir = join(root, 'daily-notes');

  let files: string[];
  try {
    files = (await readdir(notesDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = join(notesDir, file);
    const content = await readFile(filePath, 'utf8');
    const score = scoreContent(content, terms);
    if (score > 0) {
      results.push({
        content: extractSnippet(content, terms),
        snippet: extractSnippet(content, terms, 200),
        score: normalizeScore(score, content.length),
        file: `daily-notes/${file}`,
      });
    }
  }
};

// --- Helpers ---

const normalizeScore = (rawScore: number, contentLength: number): number => {
  // Shorter content with same match count = more relevant
  const densityBonus = Math.min(1, 500 / Math.max(contentLength, 1));
  return Math.min(1, (rawScore / 10) * (1 + densityBonus));
};

const walkForFiles = async (
  dir: string,
  filename: string,
  handler: (path: string) => Promise<void>
): Promise<void> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      await handler(fullPath);
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await walkForFiles(fullPath, filename, handler);
    }
  }
};
