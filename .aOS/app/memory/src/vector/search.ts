import { openVecDb, queryVectors, getDocumentsById } from './db';
import { getEmbedder, formatQueryText, disposeEmbedder } from './embed';
import { snippetify } from '../utils/text';
import { resolveVecDbPath } from '../utils/paths';
import type { Result, SearchResult } from '../types';

interface VecSearchOptions {
  query: string;
  limit: number;
  dbPath?: string;
}

/**
 * Vector search: embed query → kNN → SearchResult[]
 *
 * Uses sqlite-vec for in-process vector similarity search.
 * Returns results sorted by cosine similarity (highest first).
 */
export const searchVec = async (options: VecSearchOptions): Promise<Result<SearchResult[]>> => {
  const { query, limit, dbPath } = options;

  try {
    const db = openVecDb(dbPath);
    const embedder = await getEmbedder();

    // Embed the query
    const queryEmbedding = await embedder.embed(formatQueryText(query));

    // kNN search — over-fetch to allow filtering
    const knnResults = queryVectors(db, queryEmbedding, limit * 2);

    if (knnResults.length === 0) {
      db.close();
      return { success: true, data: [] };
    }

    // Fetch document metadata
    const docs = getDocumentsById(db, knnResults.map(r => r.id));
    const docMap = new Map(docs.map(d => [d.id, d]));

    // Convert to SearchResult, scoring with cosine similarity
    const results: SearchResult[] = [];
    for (const knn of knnResults) {
      const doc = docMap.get(knn.id);
      if (!doc) continue;

      // cosine distance ∈ [0, 2] → similarity ∈ [0, 1]
      const score = 1 - knn.distance / 2;

      // Derive file path from source
      let file: string | undefined;
      if (doc.source.startsWith('summary:')) {
        file = doc.source.slice('summary:'.length);
      } else if (doc.source.startsWith('note:')) {
        file = `daily-notes/${doc.source.slice('note:'.length)}.md`;
      }

      results.push({
        content: doc.text,
        snippet: snippetify(doc.text),
        score,
        file,
      });
    }

    // Sort by score descending, take top N
    results.sort((a, b) => b.score - a.score);
    db.close();

    return { success: true, data: results.slice(0, limit) };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Vector search failed' };
  }
};
