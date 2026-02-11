import { readdir, readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import { resolveContextRoot } from '../utils/paths';
import type { EntityMeta, ParaBucket, AtomicFact } from './types';
import { loadFacts } from './facts';

const SUMMARY_FILE = 'summary.md';
const ITEMS_FILE = 'items.json';

// PARA bucket directories
const PARA_BUCKETS: Record<ParaBucket, string> = {
  projects: 'projects',
  areas: 'areas',
  resources: 'resources',
  archives: 'archives',
  people: 'people',
};

/**
 * Resolve the absolute directory path for an entity.
 * Entity paths are relative to context root (e.g., "areas/people/jane").
 */
export const resolveEntityDir = (entityPath: string, contextRoot?: string): string =>
  join(contextRoot ?? resolveContextRoot(), entityPath);

/**
 * Create a new entity with summary.md and empty items.json.
 */
export const createEntity = async (options: {
  path: string;
  name: string;
  type: string;
  bucket: ParaBucket;
  tags?: string[];
  contextRoot?: string;
}): Promise<EntityMeta> => {
  const { path, name, type, bucket, tags = [], contextRoot } = options;
  const dir = resolveEntityDir(path, contextRoot);
  const today = new Date().toISOString().slice(0, 10);

  await mkdir(dir, { recursive: true });

  const meta: EntityMeta = {
    path,
    name,
    type,
    bucket,
    created: today,
    updated: today,
    tags,
  };

  // Write summary.md with YAML front matter
  const summary = `---
title: "${name}"
type: ${type}
para: ${bucket}/${path.split('/').slice(1, -1).join('/')}
created: ${today}
updated: ${today}
tags: [${tags.join(', ')}]
---

# ${name}

(No summary yet — facts will be extracted from sessions.)
`;
  await writeFile(join(dir, SUMMARY_FILE), summary);

  // Write empty items.json
  await writeFile(join(dir, ITEMS_FILE), '[]\n');

  return meta;
};

/**
 * Check if an entity directory exists.
 */
export const entityExists = async (entityPath: string, contextRoot?: string): Promise<boolean> => {
  try {
    const dir = resolveEntityDir(entityPath, contextRoot);
    const s = await stat(join(dir, ITEMS_FILE));
    return s.isFile();
  } catch {
    return false;
  }
};

/**
 * Load entity metadata from summary.md front matter.
 */
export const getEntity = async (
  entityPath: string,
  contextRoot?: string
): Promise<EntityMeta | null> => {
  const dir = resolveEntityDir(entityPath, contextRoot);
  try {
    const content = await readFile(join(dir, SUMMARY_FILE), 'utf8');
    return parseEntityMeta(entityPath, content);
  } catch {
    return null;
  }
};

/**
 * Parse YAML front matter from summary.md into EntityMeta.
 */
const parseEntityMeta = (entityPath: string, content: string): EntityMeta | null => {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?`, 'm'));
    return m?.[1]?.trim() ?? '';
  };

  const tagsMatch = fm.match(/^tags:\s*\[(.*)\]/m);
  const tags = tagsMatch?.[1]
    ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  // Determine bucket from path
  const bucket = (entityPath.split('/')[0] ?? 'resources') as ParaBucket;

  return {
    path: entityPath,
    name: get('title'),
    type: get('type'),
    bucket,
    created: get('created'),
    updated: get('updated'),
    tags,
  };
};

/**
 * List all entities, optionally filtered by PARA bucket.
 * Scans for directories containing items.json.
 */
export const listEntities = async (options?: {
  bucket?: ParaBucket;
  contextRoot?: string;
}): Promise<Array<EntityMeta & { factCount: number }>> => {
  const { bucket, contextRoot } = options ?? {};
  const root = contextRoot ?? resolveContextRoot();
  const results: Array<EntityMeta & { factCount: number }> = [];

  const bucketsToScan = bucket
    ? [PARA_BUCKETS[bucket]]
    : Object.values(PARA_BUCKETS);

  for (const bucketDir of bucketsToScan) {
    const bucketPath = join(root, bucketDir);
    await scanForEntities(bucketPath, root, results);
  }

  return results;
};

/**
 * Recursively scan for entity directories (those containing items.json).
 */
const scanForEntities = async (
  dir: string,
  root: string,
  results: Array<EntityMeta & { factCount: number }>
): Promise<void> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Check if this directory is an entity
  const hasItems = entries.some((e) => e.isFile() && e.name === ITEMS_FILE);
  if (hasItems) {
    const entityPath = relative(root, dir);
    const meta = await getEntity(entityPath, root);
    if (meta) {
      const facts = await loadFacts(dir);
      results.push({ ...meta, factCount: facts.length });
    }
    return; // Don't recurse into entity subdirectories
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await scanForEntities(join(dir, entry.name), root, results);
    }
  }
};

/**
 * Move an entity to a new location (e.g., projects → archives).
 */
export const moveEntity = async (
  fromPath: string,
  toPath: string,
  contextRoot?: string
): Promise<boolean> => {
  const root = contextRoot ?? resolveContextRoot();
  const fromDir = join(root, fromPath);
  const toDir = join(root, toPath);

  try {
    await mkdir(dirname(toDir), { recursive: true });
    await rename(fromDir, toDir);

    // Update summary.md front matter with new path info
    const summaryPath = join(toDir, SUMMARY_FILE);
    try {
      let content = await readFile(summaryPath, 'utf8');
      const today = new Date().toISOString().slice(0, 10);
      content = content.replace(/^(updated:\s*).*$/m, `$1${today}`);
      const newBucket = toPath.split('/')[0] ?? 'resources';
      content = content.replace(/^(para:\s*).*$/m, `$1${newBucket}/${toPath.split('/').slice(1, -1).join('/')}`);
      await writeFile(summaryPath, content);
    } catch {
      // Summary update is best-effort
    }

    return true;
  } catch {
    return false;
  }
};
