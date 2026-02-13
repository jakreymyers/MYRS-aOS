import type { AtomicFact, DecayTier, TieredFact } from './types';

// Decay constants
export const HOT_DAYS = 7;
export const WARM_DAYS = 30;
export const FREQUENCY_BONUS_THRESHOLD = 10;
export const FREQUENCY_BONUS_DAYS = 14;
export const IMPORTANCE_BONUS_DAYS = 14;
export const MAX_BONUS_DAYS = 28;

const toDate = (s: string): Date =>
  s.includes('T') ? new Date(s) : new Date(s + 'T00:00:00Z');

const daysBetween = (a: string, b: string): number => {
  const msPerDay = 86_400_000;
  const dateA = toDate(a);
  const dateB = toDate(b);
  return Math.floor(Math.abs(dateB.getTime() - dateA.getTime()) / msPerDay);
};

/**
 * Compute the decay tier for a single fact.
 * Superseded facts are always cold.
 * Frequently accessed facts (accessCount >= threshold) get a bonus extension.
 */
export const computeTier = (fact: AtomicFact, today: string): DecayTier => {
  if (fact.status === 'superseded') return 'cold';

  const daysSinceAccess = daysBetween(fact.lastAccessed, today);
  const frequencyBonus = fact.accessCount >= FREQUENCY_BONUS_THRESHOLD ? FREQUENCY_BONUS_DAYS : 0;
  const importanceBonus = fact.importance === 3 ? IMPORTANCE_BONUS_DAYS : 0;
  const bonus = Math.min(MAX_BONUS_DAYS, frequencyBonus + importanceBonus);

  if (daysSinceAccess <= HOT_DAYS + bonus) return 'hot';
  if (daysSinceAccess <= WARM_DAYS + bonus) return 'warm';
  return 'cold';
};

/**
 * Assign tiers to facts and sort by tier (hot first), then by accessCount descending.
 */
export const tierFacts = (facts: AtomicFact[], today: string): TieredFact[] => {
  const tiered: TieredFact[] = facts.map((fact) => ({
    ...fact,
    tier: computeTier(fact, today),
  }));

  const tierOrder: Record<DecayTier, number> = { hot: 0, warm: 1, cold: 2 };

  return tiered.sort((a, b) => {
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.accessCount - a.accessCount;
  });
};
