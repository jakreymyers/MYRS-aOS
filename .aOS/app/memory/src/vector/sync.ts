import { readdir, readFile } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { openVecDb, upsertDocument, deleteByIds, getAllDocumentHashes } from './db';
import { getEmbedder, formatDocumentText, disposeEmbedder } from './embed';
import { listEntities, resolveEntityDir } from '../knowledge/entities';
import { resolveVecDbPath, resolveDailyNotesDir, resolveContextRoot } from '../utils/paths';
import type { Database } from 'bun:sqlite';

const MAX_CHUNK_CHARS = 3200;

interface SyncOptions {
  force?: boolean;
  verbose?: boolean;
  dbPath?: string;
}

interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  total: number;
}

const hashContent = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);

/**
 * Chunk text if it exceeds MAX_CHUNK_CHARS.
 * Splits on paragraph boundaries (double newline) for cleaner chunks.
 */
const chunkText = (text: string): string[] => {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
};

interface PendingDoc {
  id: string;
  title: string;
  text: string;
  source: string;
  chunkSeq: number;
  contentHash: string;
}

/**
 * Incrementally sync entity summaries and daily notes into the vector database.
 */
export const syncVectors = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const { force = false, verbose = false, dbPath } = options;
  const db = openVecDb(dbPath);
  const existingHashes = getAllDocumentHashes(db);
  const seenIds = new Set<string>();

  const pending: PendingDoc[] = [];
  let unchanged = 0;

  // 1. Walk entity summaries
  const entities = await listEntities();
  const contextRoot = resolveContextRoot();
  for (const entity of entities) {
    const dir = resolveEntityDir(entity.path);
    let content: string;
    try {
      content = await readFile(join(dir, 'summary.md'), 'utf8');
    } catch {
      continue;
    }

    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i++) {
      const id = chunks.length === 1
        ? `summary:${entity.path}`
        : `summary:${entity.path}:${i}`;
      const hash = hashContent(chunks[i]);
      seenIds.add(id);

      if (!force && existingHashes.get(id) === hash) {
        unchanged++;
        continue;
      }

      pending.push({
        id,
        title: entity.name || entity.path,
        text: chunks[i],
        source: `summary:${entity.path}`,
        chunkSeq: i,
        contentHash: hash,
      });
    }
  }

  // 2. Walk daily notes
  const notesDir = resolveDailyNotesDir();
  let noteFiles: string[] = [];
  try {
    noteFiles = (await readdir(notesDir)).filter(f => f.endsWith('.md')).sort();
  } catch {
    // No daily notes directory
  }

  for (const file of noteFiles) {
    const content = await readFile(join(notesDir, file), 'utf8');
    const date = basename(file, '.md');
    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const id = chunks.length === 1
        ? `note:${date}`
        : `note:${date}:${i}`;
      const hash = hashContent(chunks[i]);
      seenIds.add(id);

      if (!force && existingHashes.get(id) === hash) {
        unchanged++;
        continue;
      }

      pending.push({
        id,
        title: `Daily Note ${date}`,
        text: chunks[i],
        source: `note:${date}`,
        chunkSeq: i,
        contentHash: hash,
      });
    }
  }

  // 3. Delete orphans (ids in DB but not seen in this walk)
  const orphanIds = [...existingHashes.keys()].filter(id => !seenIds.has(id));
  if (orphanIds.length > 0) {
    deleteByIds(db, orphanIds);
    if (verbose) console.log(`Deleted ${orphanIds.length} orphan(s)`);
  }

  // 4. Embed and upsert pending documents
  let added = 0;
  let updated = 0;

  if (pending.length > 0) {
    const embedder = await getEmbedder();
    for (const doc of pending) {
      const text = formatDocumentText(doc.title, doc.text);
      const embedding = await embedder.embed(text);
      const isUpdate = existingHashes.has(doc.id);

      upsertDocument(db, {
        id: doc.id,
        contentHash: doc.contentHash,
        text: doc.text,
        title: doc.title,
        source: doc.source,
        chunkSeq: doc.chunkSeq,
        embeddedAt: new Date().toISOString(),
      }, embedding);

      if (isUpdate) {
        updated++;
        if (verbose) console.log(`  Updated: ${doc.id}`);
      } else {
        added++;
        if (verbose) console.log(`  Added: ${doc.id}`);
      }
    }
    await disposeEmbedder();
  }

  db.close();

  return {
    added,
    updated,
    deleted: orphanIds.length,
    unchanged,
    total: seenIds.size,
  };
};
