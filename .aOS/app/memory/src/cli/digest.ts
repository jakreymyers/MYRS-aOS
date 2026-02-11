import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { resolveSessionLogDir } from '../utils/paths';
import { acquireLock, releaseLock, loadState, saveState } from '../session/state';
import { readSessionMessages } from '../session/logs';
import { hashContent } from '../utils/hash';
import { runExtraction } from '../knowledge/extract';
import { runExtractPrompt } from '../llm/claude';
import { EXTRACT_SYSTEM_PROMPT, EXTRACT_USER_PROMPT } from '../llm/prompts';
import { syncVectors } from '../vector/sync';
import { disposeEmbedder } from '../vector/embed';
import { loadGraphState, saveGraphState } from '../knowledge/state';

/**
 * Session digest: extract facts from session logs into knowledge graph.
 *
 * 1. Acquire lock (skip if another digest is running)
 * 2. Read all session logs, detect changes
 * 3. For each changed session: extract facts via Haiku → store → daily note
 * 4. Sync vector index
 * 5. Release lock
 *
 * Designed to run async (background) from SessionEnd and PreCompact hooks.
 */
export const runDigest = async (args: string[]): Promise<void> => {
  const force = args.includes('--force');
  const skipCurate = args.includes('--no-curate');

  const locked = await acquireLock();
  if (!locked) {
    console.log('Another digest is running — skipping');
    return;
  }

  try {
    const sessionDir = resolveSessionLogDir();

    let entries;
    try {
      entries = await readdir(sessionDir, { withFileTypes: true });
    } catch {
      console.log('No session logs directory');
      return;
    }

    const sessionFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => join(sessionDir, e.name));

    const state = await loadState();
    let totalFacts = 0;
    let totalEntities = 0;
    let processedCount = 0;

    for (const filePath of sessionFiles) {
      const content = await readFile(filePath, 'utf8');
      const contentHash = hashContent(content);
      const size = Buffer.byteLength(content);
      const messageCount = content.split(/\r?\n/).filter(Boolean).length;
      const mtime = Date.now();

      const prev = state.sessions[filePath];
      const changed = !prev || prev.contentHash !== contentHash;

      // Same delta thresholds as v2
      const deltaSize = prev ? Math.abs(size - prev.size) : size;
      const deltaMsgs = prev ? Math.abs(messageCount - prev.messageCount) : messageCount;
      const shouldProcess = force || (!prev && changed) || (prev && !prev.digestedAt) || (changed && (deltaSize >= 10_000 || deltaMsgs >= 25));

      let extracted = false;

      if (shouldProcess) {
        // Defense-in-depth: skip if content hash matches last extraction
        if (!force && prev?.digestedHash === contentHash) {
          // Content unchanged since last extraction — skip
        } else {
          const sessionId = basename(filePath, '.jsonl');
          try {
            const messages = await readSessionMessages(filePath, sessionId);
            if (messages.length > 0) {
              const date = messages[0].timestamp
                ? new Date(messages[0].timestamp).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);

              const result = await runExtraction({
                messages,
                date,
                sessionId,
                llmCaller: runExtractPrompt,
                systemPrompt: EXTRACT_SYSTEM_PROMPT,
                userPromptTemplate: EXTRACT_USER_PROMPT,
              });

              totalFacts += result.facts.length;
              totalEntities += result.newEntities.length;
              processedCount++;
              extracted = true;
            }
          } catch (error: any) {
            console.error(`Failed to extract ${sessionId.slice(0, 8)}: ${error?.message ?? 'unknown'}`);
          }
        }
      }

      // Always update state tracking
      state.sessions[filePath] = {
        path: filePath,
        contentHash,
        size,
        mtime,
        messageCount,
        digestedAt: extracted ? new Date().toISOString() : (prev?.digestedAt ?? null),
        digestedHash: extracted ? contentHash : (prev?.digestedHash ?? null),
      };
    }

    await saveState(state);

    if (processedCount > 0) {
      state.lastDigest = new Date().toISOString();
      await saveState(state);

      // Update graph state extraction timestamp
      const graphState = await loadGraphState();
      graphState.lastExtraction = new Date().toISOString();
      await saveGraphState(graphState);

      console.log(`Extracted ${totalFacts} facts, ${totalEntities} new entities from ${processedCount} session(s)`);

      // Sync vector index so new facts are searchable immediately
      try {
        const vecResult = await syncVectors({ force: false, verbose: false });
        await disposeEmbedder();
        console.log(`Vector index synced (${vecResult.added} added, ${vecResult.updated} updated)`);
      } catch (error: any) {
        console.error(`Vector sync warning: ${error?.message ?? 'unknown'}`);
      }
    } else {
      console.log('No changes to digest');
    }

    // Run curate independently of extraction — dirty entities may exist from
    // batch imports or prior runs even when no sessions were processed.
    if (!skipCurate) {
      try {
        const graphState = await loadGraphState();
        if (graphState.dirtyEntities && graphState.dirtyEntities.length > 0) {
          const { runCurate } = await import('./curate');
          await runCurate([]);
        }
      } catch (error: any) {
        console.error(`Curate warning: ${error?.message ?? 'unknown error'}`);
      }
    }
  } finally {
    await releaseLock();
  }
};
