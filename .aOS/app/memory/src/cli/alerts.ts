import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { loadFacts } from '../knowledge/facts';

const DAY_MS = 86_400_000;

const parseDateMs = (value: string): number | null => {
  const ms = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(ms) ? ms : null;
};

const diffDays = (fromMs: number, toMs: number): number =>
  Math.floor((toMs - fromMs) / DAY_MS);

export const runAlerts = async (args: string[]): Promise<void> => {
  const json = args.includes('--json');
  const todayArgIdx = args.indexOf('--today');
  const today = todayArgIdx >= 0 && args[todayArgIdx + 1]
    ? args[todayArgIdx + 1]
    : new Date().toISOString().slice(0, 10);

  const nowMs = parseDateMs(today) ?? Date.now();
  const entities = await listEntities();

  const upcomingMilestones: Array<{ entityPath: string; factId: string; fact: string; due: string; daysUntil: number }> = [];
  const neglectedCriticalFacts: Array<{ entityPath: string; factId: string; fact: string; daysSinceAccess: number }> = [];
  const staleEntities: Array<{ entityPath: string; lastUpdated: string; daysStale: number }> = [];

  for (const entity of entities) {
    const updatedMs = parseDateMs(entity.updated);
    if (updatedMs != null) {
      const staleDays = diffDays(updatedMs, nowMs);
      if (staleDays >= 30) {
        staleEntities.push({
          entityPath: entity.path,
          lastUpdated: entity.updated,
          daysStale: staleDays,
        });
      }
    }

    const facts = await loadFacts(resolveEntityDir(entity.path));

    for (const fact of facts) {
      if (fact.status !== 'active') continue;

      if (fact.category === 'milestone') {
        const dueMs = parseDateMs(fact.timestamp);
        if (dueMs != null) {
          const daysUntil = diffDays(nowMs, dueMs);
          if (daysUntil >= 0 && daysUntil <= 14) {
            upcomingMilestones.push({
              entityPath: entity.path,
              factId: fact.id,
              fact: fact.fact,
              due: fact.timestamp,
              daysUntil,
            });
          }
        }
      }

      if (fact.importance === 3) {
        const accessedMs = parseDateMs(fact.lastAccessed);
        if (accessedMs != null) {
          const daysSinceAccess = diffDays(accessedMs, nowMs);
          if (daysSinceAccess >= 7) {
            neglectedCriticalFacts.push({
              entityPath: entity.path,
              factId: fact.id,
              fact: fact.fact,
              daysSinceAccess,
            });
          }
        }
      }
    }
  }

  const payload = {
    today,
    upcomingMilestones,
    neglectedCriticalFacts,
    staleEntities,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Alerts for ${today}`);
  console.log(`Upcoming milestones: ${upcomingMilestones.length}`);
  console.log(`Neglected critical facts: ${neglectedCriticalFacts.length}`);
  console.log(`Stale entities: ${staleEntities.length}`);
};
