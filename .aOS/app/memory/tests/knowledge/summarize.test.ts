import { describe, expect, test } from 'bun:test';
import { generateSummary } from '../../src/knowledge/summarize';
import type { EntityMeta, TieredFact } from '../../src/knowledge/types';

const makeMeta = (overrides: Partial<EntityMeta> = {}): EntityMeta => ({
  path: 'areas/people/jane',
  name: 'Jane Smith',
  type: 'person',
  bucket: 'areas',
  created: '2026-01-15',
  updated: '2026-02-07',
  tags: ['engineering', 'aps'],
  ...overrides,
});

const makeTiered = (tier: 'hot' | 'warm' | 'cold', overrides: Partial<TieredFact> = {}): TieredFact => {
  const { importance, ...rest } = overrides;
  return {
  id: 'jane-001',
  fact: `A ${tier} fact`,
  category: 'status',
  timestamp: '2026-01-15',
  source: '2026-01-15',
  status: 'active',
  supersededBy: null,
  relatedEntities: [],
  lastAccessed: '2026-02-01',
  accessCount: 5,
  tier,
  importance: importance ?? 1,
  ...rest,
  };
};

describe('generateSummary', () => {
  test('includes hot facts in Current section', async () => {
    const meta = makeMeta();
    const facts = [makeTiered('hot', { fact: 'Working on React migration' })];
    const result = await generateSummary({ meta, tieredFacts: facts });

    expect(result).toContain('## Current');
    expect(result).toContain('Working on React migration');
  });

  test('includes warm facts in Recent section', async () => {
    const meta = makeMeta();
    const facts = [makeTiered('warm', { fact: 'Completed API refactor' })];
    const result = await generateSummary({ meta, tieredFacts: facts });

    expect(result).toContain('## Recent');
    expect(result).toContain('Completed API refactor');
  });

  test('excludes cold facts from summary', async () => {
    const meta = makeMeta();
    const facts = [
      makeTiered('hot', { fact: 'Hot fact' }),
      makeTiered('cold', { fact: 'Cold fact should not appear' }),
    ];
    const result = await generateSummary({ meta, tieredFacts: facts });

    expect(result).toContain('Hot fact');
    expect(result).not.toContain('Cold fact should not appear');
  });

  test('includes YAML front matter', async () => {
    const meta = makeMeta();
    const facts = [makeTiered('hot')];
    const result = await generateSummary({ meta, tieredFacts: facts });

    expect(result).toContain('---');
    expect(result).toContain('title: "Jane Smith"');
    expect(result).toContain('type: person');
    expect(result).toContain('tags: [engineering, aps]');
  });

  test('handles entity with no active facts', async () => {
    const meta = makeMeta();
    const result = await generateSummary({ meta, tieredFacts: [] });

    expect(result).toContain('# Jane Smith');
    expect(result).toContain('No active facts yet');
  });

  test('uses LLM when caller provided', async () => {
    const meta = makeMeta();
    const facts = [makeTiered('hot')];
    const mockLlm = async (_prompt: string) => '---\ntitle: "Jane"\n---\n# Jane\nLLM summary here.';

    const result = await generateSummary({
      meta,
      tieredFacts: facts,
      llmCaller: mockLlm,
      systemPrompt: 'Generate a summary.',
    });

    expect(result).toContain('LLM summary here');
  });

  test('falls back to structured when LLM fails', async () => {
    const meta = makeMeta();
    const facts = [makeTiered('hot', { fact: 'Fallback fact' })];
    const failingLlm = async () => { throw new Error('LLM unavailable'); };

    const result = await generateSummary({
      meta,
      tieredFacts: facts,
      llmCaller: failingLlm,
      systemPrompt: 'Generate a summary.',
    });

    // Should fall back to structured output
    expect(result).toContain('Fallback fact');
    expect(result).toContain('## Current');
  });
});
