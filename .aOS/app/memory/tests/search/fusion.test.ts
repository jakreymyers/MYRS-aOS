import { describe, expect, test } from 'bun:test';
import { searchFusion } from '../../src/search/fusion';

describe('searchFusion', () => {
  test('--min-score filters low-score results', async () => {
    const result = await searchFusion(
      {
        query: 'test',
        limit: 5,
        minScore: 0.5,
      },
      {
        searchNativeFn: async () => ({
          success: true,
          data: {
            results: [
              { content: 'low', snippet: 'low', score: 0.2, file: 'people/a' },
              { content: 'high', snippet: 'high', score: 0.9, file: 'people/b' },
            ],
            matchedFacts: [],
          },
        }),
        searchVecFn: async () => ({ success: true, data: [] }),
      },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.results.length).toBe(1);
    expect(result.data.results[0].score).toBeGreaterThanOrEqual(0.5);
  });

  test('--scope is passed to vector branch', async () => {
    let seenScope: string | undefined;

    const result = await searchFusion(
      {
        query: 'test',
        limit: 5,
        scope: 'notes',
      },
      {
        searchNativeFn: async () => ({ success: true, data: { results: [], matchedFacts: [] } }),
        searchVecFn: async (opts) => {
          seenScope = opts.scope;
          return { success: true, data: [] };
        },
      },
    );

    expect(result.success).toBe(true);
    expect(seenScope).toBe('notes');
  });

  test('zero weights are normalized safely (no NaN)', async () => {
    const result = await searchFusion(
      {
        query: 'test',
        limit: 1,
        vectorWeight: 0,
        textWeight: 0,
      },
      {
        searchNativeFn: async () => ({
          success: true,
          data: {
            results: [{ content: 'x', snippet: 'x', score: 0.8, file: 'people/a' }],
            matchedFacts: [],
          },
        }),
        searchVecFn: async () => ({ success: true, data: [] }),
      },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Number.isNaN(result.data.results[0].score)).toBe(false);
  });

  test('--category is forwarded to keyword search', async () => {
    let seenCategory: string | undefined;

    await searchFusion(
      {
        query: 'decision',
        limit: 5,
        category: 'decision',
      },
      {
        searchNativeFn: async (opts) => {
          seenCategory = opts.category;
          return { success: true, data: { results: [], matchedFacts: [] } };
        },
        searchVecFn: async () => ({ success: true, data: [] }),
      },
    );

    expect(seenCategory).toBe('decision');
  });
});
