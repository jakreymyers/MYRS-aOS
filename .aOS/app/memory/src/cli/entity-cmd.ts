import { listEntities, getEntity, createEntity, moveEntity, resolveEntityDir } from '../knowledge/entities';
import { loadFacts, batchTouchFacts } from '../knowledge/facts';
import { tierFacts } from '../knowledge/decay';
import type { ParaBucket } from '../knowledge/types';

/**
 * CLI: memory entity <action> [args]
 *
 * Actions: list, show, create, archive, graph
 */
export const runEntityCmd = async (args: string[]): Promise<void> => {
  const action = args[0];

  switch (action) {
    case 'list':
      await entityList(args.slice(1));
      break;
    case 'show':
      await entityShow(args.slice(1));
      break;
    case 'create':
      await entityCreate(args.slice(1));
      break;
    case 'archive':
      await entityArchive(args.slice(1));
      break;
    case 'graph':
      await entityGraph(args.slice(1));
      break;
    default:
      console.log(`Usage: memory entity <list|show|create|archive|graph> [args]

  entity list [--bucket <b>]  List entities with fact counts
  entity show <path>          Display entity summary + facts
  entity create <path> --type <type> --name <name>
  entity archive <path>       Move entity to archives
  entity graph <path>         Show related entities`);
      if (action && action !== '--help' && action !== '-h') {
        console.error(`Unknown action: ${action}`);
        process.exitCode = 1;
      }
  }
};

const entityList = async (args: string[]): Promise<void> => {
  let bucket: ParaBucket | undefined;
  const json = args.includes('--json');
  const bucketIdx = args.indexOf('--bucket');
  if (bucketIdx !== -1 && args[bucketIdx + 1]) {
    bucket = args[bucketIdx + 1] as ParaBucket;
  }

  const entities = (await listEntities({ bucket }))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (entities.length === 0) {
    if (json) {
      console.log('[]');
    } else {
      console.log('No entities found.');
    }
    return;
  }

  if (json) {
    const payload = entities.map((entity) => ({
      path: entity.path,
      name: entity.name,
      type: entity.type,
      bucket: entity.bucket,
      tags: entity.tags,
      factCount: entity.factCount,
      lastUpdated: entity.updated,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const entity of entities) {
    const dir = resolveEntityDir(entity.path);
    const facts = await loadFacts(dir);
    const tiered = tierFacts(facts, today);
    const hotCount = tiered.filter((f) => f.tier === 'hot').length;
    const warmCount = tiered.filter((f) => f.tier === 'warm').length;
    const coldCount = tiered.filter((f) => f.tier === 'cold').length;

    console.log(`${entity.path}  (${entity.type})  ${entity.factCount} facts [${hotCount}h/${warmCount}w/${coldCount}c]`);
  }
};

const entityShow = async (args: string[]): Promise<void> => {
  const entityPath = args[0];
  if (!entityPath) {
    console.error('Usage: memory entity show <path>');
    process.exitCode = 1;
    return;
  }

  const meta = await getEntity(entityPath);
  if (!meta) {
    console.error(`Entity not found: ${entityPath}`);
    process.exitCode = 1;
    return;
  }

  const dir = resolveEntityDir(entityPath);
  const facts = await loadFacts(dir);
  const today = new Date().toISOString().slice(0, 10);
  const tiered = tierFacts(facts, today);

  console.log(`# ${meta.name} (${meta.type})`);
  console.log(`Path: ${meta.path}`);
  console.log(`Bucket: ${meta.bucket}`);
  console.log(`Tags: ${meta.tags.join(', ') || '(none)'}`);
  console.log(`Created: ${meta.created} | Updated: ${meta.updated}`);
  console.log(`Facts: ${facts.length} total\n`);

  const hot = tiered.filter((f) => f.tier === 'hot');
  const warm = tiered.filter((f) => f.tier === 'warm');
  const cold = tiered.filter((f) => f.tier === 'cold');

  if (hot.length > 0) {
    console.log('## Hot (active)');
    for (const f of hot) {
      console.log(`  [${f.category}] ${f.fact}  (accessed: ${f.accessCount}x)`);
    }
  }

  if (warm.length > 0) {
    console.log('## Warm (recent)');
    for (const f of warm) {
      console.log(`  [${f.category}] ${f.fact}  (accessed: ${f.accessCount}x)`);
    }
  }

  if (cold.length > 0) {
    console.log('## Cold (archived)');
    for (const f of cold) {
      const superseded = f.status === 'superseded' ? ' [superseded]' : '';
      console.log(`  [${f.category}] ${f.fact}${superseded}`);
    }
  }

  // Touch all active facts that were displayed
  const activeFacts = tiered.filter((f) => f.status === 'active');
  if (activeFacts.length > 0) {
    batchTouchFacts(activeFacts.map((f) => ({ entityDir: dir, factId: f.id }))).catch(() => {});
  }
};

const entityCreate = async (args: string[]): Promise<void> => {
  const entityPath = args[0];
  if (!entityPath) {
    console.error('Usage: memory entity create <path> --type <type> --name <name> [--tags tag1,tag2]');
    process.exitCode = 1;
    return;
  }

  const typeIdx = args.indexOf('--type');
  const nameIdx = args.indexOf('--name');
  const tagsIdx = args.indexOf('--tags');

  const type = typeIdx !== -1 ? args[typeIdx + 1] : 'unknown';
  const name = nameIdx !== -1 ? args[nameIdx + 1] : entityPath.split('/').pop() ?? entityPath;
  const tags = tagsIdx !== -1 ? (args[tagsIdx + 1] ?? '').split(',').filter(Boolean) : [];
  const bucket = (entityPath.split('/')[0] ?? 'resources') as ParaBucket;

  await createEntity({ path: entityPath, name, type, bucket, tags });
  console.log(`Created entity: ${entityPath} (${type})`);
};

const entityArchive = async (args: string[]): Promise<void> => {
  const entityPath = args[0];
  if (!entityPath) {
    console.error('Usage: memory entity archive <path>');
    process.exitCode = 1;
    return;
  }

  const name = entityPath.split('/').pop() ?? entityPath;
  const archivePath = `archives/${name}`;
  const result = await moveEntity(entityPath, archivePath);

  if (result) {
    console.log(`Archived: ${entityPath} → ${archivePath}`);
  } else {
    console.error(`Failed to archive: ${entityPath}`);
    process.exitCode = 1;
  }
};

const entityGraph = async (args: string[]): Promise<void> => {
  const entityPath = args[0];
  if (!entityPath) {
    console.error('Usage: memory entity graph <path>');
    process.exitCode = 1;
    return;
  }

  const dir = resolveEntityDir(entityPath);
  const facts = await loadFacts(dir);
  const related = new Map<string, number>();

  for (const fact of facts) {
    for (const rel of fact.relatedEntities) {
      if (rel !== entityPath) {
        related.set(rel, (related.get(rel) ?? 0) + 1);
      }
    }
  }

  if (related.size === 0) {
    console.log(`No related entities found for ${entityPath}`);
    return;
  }

  console.log(`Related entities for ${entityPath}:`);
  const sorted = [...related.entries()].sort((a, b) => b[1] - a[1]);
  for (const [path, count] of sorted) {
    console.log(`  ${path}  (${count} shared facts)`);
  }
};
