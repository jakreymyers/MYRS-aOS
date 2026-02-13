import { describe, expect, test } from 'bun:test';
import type { AtomicFact } from '../../src/knowledge/types';
import { computeTier } from '../../src/knowledge/decay';
import {
  consolidateEntity,
  parseConsolidationResponse,
  preFilterFacts,
  type CandidateFact,
} from '../../src/knowledge/consolidate';

const makeFact = (id: string, fact: string, overrides: Partial<AtomicFact> = {}): AtomicFact => ({
  id,
  fact,
  category: 'context',
  timestamp: '2026-01-01',
  source: 'seed',
  status: 'active',
  supersededBy: null,
  relatedEntities: [],
  lastAccessed: '2026-02-01',
  accessCount: 1,
  importance: 1,
  ...overrides,
});

const makeCandidate = (fact: string, overrides: Partial<CandidateFact> = {}): CandidateFact => ({
  fact,
  category: 'context',
  importance: 1,
  timestamp: '2026-02-12T10:00',
  relatedEntities: [],
  ...overrides,
});

describe('parseConsolidationResponse', () => {
  test('unknown action downgrades to create', () => {
    const existing = [makeFact('jak-001', 'Jak leads IS')];
    const parsed = parseConsolidationResponse(
      JSON.stringify({
        decisions: [{ candidateIndex: 0, action: 'teleport' }],
      }),
      1,
      existing,
    );

    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.decisions[0].action).toBe('create');
  });

  test('unknown targetFactId downgrades merge/supersede to create', () => {
    const existing = [makeFact('jak-001', 'Jak leads IS')];
    const parsed = parseConsolidationResponse(
      JSON.stringify({
        decisions: [
          { candidateIndex: 0, action: 'merge', targetFactId: 'missing-999', mergedFact: 'Combined' },
        ],
      }),
      1,
      existing,
    );

    expect(parsed.decisions[0].action).toBe('create');
  });

  test('mergedFact is normalized to fact', () => {
    const existing = [makeFact('jak-001', 'Jak leads IS')];
    const parsed = parseConsolidationResponse(
      JSON.stringify({
        decisions: [
          {
            candidateIndex: 0,
            action: 'merge',
            targetFactId: 'jak-001',
            mergedFact: 'Jak leads IS and oversees platform governance',
            importance: 2,
          },
        ],
      }),
      1,
      existing,
    );

    const decision = parsed.decisions[0];
    expect(decision.action).toBe('merge');
    if (decision.action !== 'merge') throw new Error('expected merge');
    expect(decision.fact).toContain('oversees platform governance');
  });
});

describe('consolidateEntity', () => {
  test('parse failure falls back to create-all', async () => {
    const result = await consolidateEntity({
      entityPath: 'people/jak-myers',
      existingFacts: [makeFact('jak-001', 'Jak leads IS')],
      candidates: [makeCandidate('Jak presented strategy to the board')],
      llmCaller: async () => 'NOT_JSON',
      systemPrompt: 'x',
      userPromptTemplate: 'x',
    });

    expect(result.fallbackMode).toBe('parse-fallback');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].action).toBe('create');
  });
});

describe('preFilterFacts', () => {
  test('caps to <=100 and preserves hot/warm facts', () => {
    const existing: AtomicFact[] = [];
    for (let i = 0; i < 150; i++) {
      existing.push(
        makeFact(`fact-${String(i).padStart(3, '0')}`, `fact ${i}`, {
          lastAccessed: i < 30 ? '2026-02-10' : '2025-11-01',
          accessCount: i < 30 ? 2 : 1,
        }),
      );
    }

    const candidates = [makeCandidate('new fact')];
    const filtered = preFilterFacts(existing, candidates, '2026-02-12');

    expect(filtered.length).toBeLessThanOrEqual(100);

    const hotWarmIds = existing
      .filter((f) => computeTier(f, '2026-02-12') !== 'cold')
      .map((f) => f.id);

    for (const id of hotWarmIds) {
      expect(filtered.some((f) => f.id === id)).toBe(true);
    }
  });
});
