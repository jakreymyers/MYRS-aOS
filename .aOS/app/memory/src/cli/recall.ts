import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchFusion, type FusionOptions } from '../search/fusion';
import type { FactRef } from '../search/native';
import { resolveEntityDir } from '../knowledge/entities';
import { loadFacts } from '../knowledge/facts';
import type { FactCategory } from '../knowledge/types';
import type { Result, SearchResult } from '../types';
import { resolveMemoryRoot } from '../utils/paths';

interface RecallEntityFact {
  id: string;
  fact: string;
  category: FactCategory;
  importance: 1 | 2 | 3;
  timestamp: string;
}

interface RecallResult {
  query: string;
  resultCount: number;
  entities: Array<{
    path: string;
    name: string;
    score: number;
    summary: string;
    facts: RecallEntityFact[];
    relatedEntities: string[];
  }>;
  notes: Array<{
    date: string;
    score: number;
    content: string;
  }>;
}

interface RecallDeps {
  searchFn?: (options: FusionOptions) => Promise<Result<{ results: SearchResult[]; matchedFacts: FactRef[] }>>;
}

const usage = (): void => {
  console.error('Usage: memory recall <query> [--json] [-n <limit>] [--category <type>]');
};

const parseName = (entityPath: string): string =>
  entityPath.split('/').pop() ?? entityPath;

const readSummary = async (entityPath: string): Promise<string> => {
  try {
    return await readFile(join(resolveEntityDir(entityPath), 'summary.md'), 'utf8');
  } catch {
    return '';
  }
};

const readNote = async (file: string): Promise<string> => {
  const path = join(resolveMemoryRoot(), file);
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
};

export const runRecall = async (args: string[], deps?: RecallDeps): Promise<void> => {
  let json = false;
  let limit = 3;
  let category: FactCategory | undefined;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '-n' && args[i + 1]) limit = Number(args[++i]);
    else if (arg === '--category' && args[i + 1]) category = args[++i] as FactCategory;
    else queryParts.push(arg);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    usage();
    process.exitCode = 1;
    return;
  }

  const search = deps?.searchFn ?? searchFusion;
  const searchResult = await search({
    query,
    limit: Math.max(1, Math.min(limit, 5)),
    scope: 'all',
    category,
  });

  if (!searchResult.success) {
    console.error(searchResult.error);
    process.exitCode = 1;
    return;
  }

  const payload: RecallResult = {
    query,
    resultCount: 0,
    entities: [],
    notes: [],
  };

  const entitySeen = new Set<string>();

  for (const row of searchResult.data.results) {
    const file = row.file ?? '';

    if (file.startsWith('daily-notes/')) {
      const noteContent = await readNote(file);
      payload.notes.push({
        date: file.replace('daily-notes/', '').replace('.md', ''),
        score: row.score,
        content: noteContent.slice(0, 2000),
      });
      continue;
    }

    const entityPath = file.replace(/\/summary\.md$/, '').replace(/\/items\.json$/, '');
    if (!entityPath || entitySeen.has(entityPath) || payload.entities.length >= 5) continue;
    entitySeen.add(entityPath);

    const summary = await readSummary(entityPath);
    const facts = (await loadFacts(resolveEntityDir(entityPath)))
      .filter((fact) => fact.status === 'active')
      .filter((fact) => !category || fact.category === category)
      .sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        return b.timestamp.localeCompare(a.timestamp);
      })
      .slice(0, 10);

    const related = [...new Set(facts.flatMap((fact) => fact.relatedEntities))];

    payload.entities.push({
      path: entityPath,
      name: parseName(entityPath),
      score: row.score,
      summary,
      facts: facts.map((fact) => ({
        id: fact.id,
        fact: fact.fact,
        category: fact.category,
        importance: fact.importance,
        timestamp: fact.timestamp,
      })),
      relatedEntities: related,
    });
  }

  payload.resultCount = payload.entities.length + payload.notes.length;

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`--- Recall: "${payload.query}" ---`);

  for (const entity of payload.entities) {
    console.log(`[Entity] ${entity.path} (score: ${entity.score.toFixed(2)})`);
    console.log(entity.summary.trim());
    console.log(`Facts (${entity.facts.length}):`);
    for (const fact of entity.facts) {
      console.log(`- [${fact.category}] ${fact.fact} (${fact.timestamp})`);
    }
  }

  for (const note of payload.notes) {
    console.log(`[Note] ${note.date} (score: ${note.score.toFixed(2)})`);
    console.log(note.content);
  }
};
