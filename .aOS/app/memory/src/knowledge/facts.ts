import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import type { AtomicFact, FactCategory } from './types';
import { isValidBucket } from './types';
import { resolveContextRoot } from '../utils/paths';
import { markEntityDirty } from './state';

const ITEMS_FILE = 'items.json';

/**
 * Best-effort dirty marking: derive PARA path from entity dir.
 * Skips silently if dir is outside context root (e.g., test temp dirs).
 */
const tryMarkDirty = async (entityDir: string): Promise<void> => {
  try {
    const contextRoot = resolveContextRoot();
    if (!entityDir.startsWith(contextRoot)) return;
    const entityPath = relative(contextRoot, entityDir);
    const bucket = entityPath.split('/')[0] ?? '';
    if (isValidBucket(bucket)) {
      await markEntityDirty(entityPath);
    }
  } catch {
    // Best-effort — don't break fact operations if marking fails
  }
};

const resolveItemsPath = (entityDir: string): string =>
  join(entityDir, ITEMS_FILE);

/**
 * Load all facts for an entity. Returns empty array if file missing.
 */
export const loadFacts = async (entityDir: string): Promise<AtomicFact[]> => {
  try {
    const content = await readFile(resolveItemsPath(entityDir), 'utf8');
    return JSON.parse(content) as AtomicFact[];
  } catch {
    return [];
  }
};

/**
 * Save facts atomically: write to .tmp then rename.
 * By default marks the entity dirty so curate picks it up.
 * Pass { markDirty: false } to skip (e.g. access-only metadata updates).
 */
export const saveFacts = async (
  entityDir: string,
  facts: AtomicFact[],
  options?: { markDirty?: boolean },
): Promise<void> => {
  await mkdir(entityDir, { recursive: true });
  const target = resolveItemsPath(entityDir);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(facts, null, 2) + '\n');
  await rename(tmp, target);
  if (options?.markDirty !== false) {
    await tryMarkDirty(entityDir);
  }
};

/**
 * Generate the next fact ID for an entity.
 * Format: entity-slug-NNN (e.g., "jane-001")
 */
const nextFactId = (facts: AtomicFact[], entitySlug: string): string => {
  const maxNum = facts.reduce((max, f) => {
    const match = f.id.match(/-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `${entitySlug}-${String(maxNum + 1).padStart(3, '0')}`;
};

/**
 * Extract entity slug from directory path (last segment).
 */
const slugFromDir = (entityDir: string): string => {
  const parts = entityDir.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
};

/**
 * Add a new fact to an entity. Auto-generates ID.
 * Returns the added fact with its assigned ID.
 */
export const addFact = async (
  entityDir: string,
  fact: Omit<AtomicFact, 'id' | 'lastAccessed' | 'accessCount'>
): Promise<AtomicFact> => {
  const facts = await loadFacts(entityDir);
  const slug = slugFromDir(entityDir);
  const id = nextFactId(facts, slug);
  const today = new Date().toISOString().slice(0, 10);

  const newFact: AtomicFact = {
    ...fact,
    id,
    lastAccessed: today,
    accessCount: 1,
  };

  facts.push(newFact);
  await saveFacts(entityDir, facts);
  return newFact;
};

/**
 * Supersede an existing fact with a new one.
 * Marks old fact as superseded and adds the replacement.
 */
export const supersedeFact = async (
  entityDir: string,
  oldFactId: string,
  newFactData: Omit<AtomicFact, 'id' | 'lastAccessed' | 'accessCount'>
): Promise<AtomicFact | null> => {
  const facts = await loadFacts(entityDir);
  const oldFact = facts.find((f) => f.id === oldFactId);
  if (!oldFact) return null;

  const slug = slugFromDir(entityDir);
  const newId = nextFactId(facts, slug);
  const today = new Date().toISOString().slice(0, 10);

  oldFact.status = 'superseded';
  oldFact.supersededBy = newId;

  const newFact: AtomicFact = {
    ...newFactData,
    id: newId,
    lastAccessed: today,
    accessCount: 1,
  };

  facts.push(newFact);
  await saveFacts(entityDir, facts);
  return newFact;
};

/**
 * Get all active (non-superseded) facts.
 */
export const getActiveFacts = async (entityDir: string): Promise<AtomicFact[]> =>
  (await loadFacts(entityDir)).filter((f) => f.status === 'active');

/**
 * Update access metadata for a fact (best-effort tracking).
 */
export const touchFact = async (entityDir: string, factId: string): Promise<boolean> => {
  const facts = await loadFacts(entityDir);
  const fact = facts.find((f) => f.id === factId);
  if (!fact) return false;

  fact.lastAccessed = new Date().toISOString().slice(0, 10);
  fact.accessCount += 1;
  await saveFacts(entityDir, facts, { markDirty: false });
  return true;
};

/**
 * Batch-update access metadata for facts across multiple entities.
 * Groups by entity dir to minimize load/save cycles.
 * Best-effort — errors are silently ignored.
 */
export const batchTouchFacts = async (
  refs: Array<{ entityDir: string; factId: string }>
): Promise<void> => {
  const grouped = new Map<string, string[]>();
  for (const { entityDir, factId } of refs) {
    const ids = grouped.get(entityDir);
    if (ids) ids.push(factId);
    else grouped.set(entityDir, [factId]);
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const [entityDir, factIds] of grouped) {
    try {
      const facts = await loadFacts(entityDir);
      const idSet = new Set(factIds);
      let touched = false;

      for (const fact of facts) {
        if (idSet.has(fact.id)) {
          fact.lastAccessed = today;
          fact.accessCount += 1;
          touched = true;
        }
      }

      if (touched) {
        await saveFacts(entityDir, facts, { markDirty: false });
      }
    } catch {
      // Best-effort — don't break search if touch fails
    }
  }
};

/**
 * Get active facts filtered by category.
 */
export const getFactsByCategory = async (
  entityDir: string,
  category: FactCategory
): Promise<AtomicFact[]> =>
  (await getActiveFacts(entityDir)).filter((f) => f.category === category);
