import { describe, expect, test } from 'bun:test';
import { computeTier, tierFacts, HOT_DAYS, WARM_DAYS, FREQUENCY_BONUS_THRESHOLD, FREQUENCY_BONUS_DAYS } from '../../src/knowledge/decay';
import type { AtomicFact } from '../../src/knowledge/types';

const makeFact = (overrides: Partial<AtomicFact> = {}): AtomicFact => {
  const { importance, ...rest } = overrides;
  return {
  id: 'test-001',
  fact: 'Test fact',
  category: 'status',
  timestamp: '2026-01-15',
  source: '2026-01-15',
  status: 'active',
  supersededBy: null,
  relatedEntities: [],
  lastAccessed: '2026-02-01',
  accessCount: 1,
  importance: importance ?? 1,
  ...rest,
  };
};

describe('computeTier', () => {
  test('recent access is hot', () => {
    const fact = makeFact({ lastAccessed: '2026-02-05' });
    expect(computeTier(fact, '2026-02-07')).toBe('hot');
  });

  test('access within hot boundary is hot', () => {
    const fact = makeFact({ lastAccessed: '2026-01-31' });
    expect(computeTier(fact, '2026-02-07')).toBe('hot'); // 7 days
  });

  test('access beyond hot but within warm is warm', () => {
    const fact = makeFact({ lastAccessed: '2026-01-20' });
    expect(computeTier(fact, '2026-02-07')).toBe('warm'); // 18 days
  });

  test('access at warm boundary is warm', () => {
    const fact = makeFact({ lastAccessed: '2026-01-08' });
    expect(computeTier(fact, '2026-02-07')).toBe('warm'); // 30 days
  });

  test('access beyond 30 days is cold', () => {
    const fact = makeFact({ lastAccessed: '2026-01-01' });
    expect(computeTier(fact, '2026-02-07')).toBe('cold'); // 37 days
  });

  test('superseded facts are always cold', () => {
    const fact = makeFact({
      lastAccessed: '2026-02-07', // Would be hot
      status: 'superseded',
      supersededBy: 'test-002',
    });
    expect(computeTier(fact, '2026-02-07')).toBe('cold');
  });

  test('frequency bonus extends hot window', () => {
    const fact = makeFact({
      lastAccessed: '2026-01-20', // 18 days ago — normally warm
      accessCount: FREQUENCY_BONUS_THRESHOLD,
    });
    // With bonus: effective hot window = 7 + 14 = 21 days, 18 < 21 → hot
    expect(computeTier(fact, '2026-02-07')).toBe('hot');
  });

  test('frequency bonus extends warm window', () => {
    const fact = makeFact({
      lastAccessed: '2025-12-30', // 39 days ago — normally cold
      accessCount: FREQUENCY_BONUS_THRESHOLD + 5,
    });
    // With bonus: effective warm window = 30 + 14 = 44 days, 39 < 44 → warm
    expect(computeTier(fact, '2026-02-07')).toBe('warm');
  });

  test('frequency bonus insufficient to stay hot if too old', () => {
    const fact = makeFact({
      lastAccessed: '2026-01-10', // 28 days ago
      accessCount: FREQUENCY_BONUS_THRESHOLD,
    });
    // With bonus: effective hot window = 7 + 14 = 21 days, 28 > 21 → warm
    expect(computeTier(fact, '2026-02-07')).toBe('warm');
  });

  test('importance + frequency bonuses are additive and can keep fact hot up to 35 days', () => {
    const fact = makeFact({
      lastAccessed: '2026-01-05', // 33 days ago
      accessCount: FREQUENCY_BONUS_THRESHOLD + 1,
      importance: 3,
    });
    expect(computeTier(fact, '2026-02-07')).toBe('hot');
  });

  test('importance + frequency bonuses extend warm tier to 58 days max', () => {
    const fact = makeFact({
      lastAccessed: '2025-12-20', // 49 days ago
      accessCount: FREQUENCY_BONUS_THRESHOLD + 1,
      importance: 3,
    });
    expect(computeTier(fact, '2026-02-07')).toBe('warm');
  });
});

describe('tierFacts', () => {
  test('sorts by tier order (hot > warm > cold)', () => {
    const facts = [
      makeFact({ id: 'cold', lastAccessed: '2025-12-01', accessCount: 1 }),
      makeFact({ id: 'hot', lastAccessed: '2026-02-06', accessCount: 1 }),
      makeFact({ id: 'warm', lastAccessed: '2026-01-20', accessCount: 1 }),
    ];
    const result = tierFacts(facts, '2026-02-07');
    expect(result[0].id).toBe('hot');
    expect(result[0].tier).toBe('hot');
    expect(result[1].id).toBe('warm');
    expect(result[1].tier).toBe('warm');
    expect(result[2].id).toBe('cold');
    expect(result[2].tier).toBe('cold');
  });

  test('within same tier, sorts by accessCount descending', () => {
    const facts = [
      makeFact({ id: 'low', lastAccessed: '2026-02-06', accessCount: 2 }),
      makeFact({ id: 'high', lastAccessed: '2026-02-05', accessCount: 15 }),
      makeFact({ id: 'mid', lastAccessed: '2026-02-04', accessCount: 5 }),
    ];
    const result = tierFacts(facts, '2026-02-07');
    // All hot (within 7 days)
    expect(result.every(f => f.tier === 'hot')).toBe(true);
    expect(result[0].id).toBe('high');
    expect(result[1].id).toBe('mid');
    expect(result[2].id).toBe('low');
  });

  test('empty input returns empty', () => {
    expect(tierFacts([], '2026-02-07')).toEqual([]);
  });

  test('preserves all fact fields', () => {
    const original = makeFact({
      id: 'preserve-001',
      fact: 'Preserve me',
      category: 'milestone',
      relatedEntities: ['areas/people/test'],
    });
    const result = tierFacts([original], '2026-02-07');
    expect(result[0].id).toBe('preserve-001');
    expect(result[0].fact).toBe('Preserve me');
    expect(result[0].category).toBe('milestone');
    expect(result[0].relatedEntities).toEqual(['areas/people/test']);
    expect(result[0].tier).toBeDefined();
  });
});
