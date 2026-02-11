import { syncCurrentSession, syncSession, getCurrentSessionId } from '../session/logger';
import { updateSession, loadState } from '../session/state';
import { hashContent } from '../utils/hash';
import { readFile } from 'node:fs/promises';
import { resolveSessionLogDir } from '../utils/paths';
import { join } from 'node:path';

/**
 * Mirror the current session log from Claude Code's native logs.
 *
 * Reads session_id from hook input (stdin JSON) if available,
 * otherwise falls back to the most recently modified session.
 *
 * Writes to .aOS/logs/sessions/{UUID}.jsonl (overwrites if exists).
 * Updates session-state.json with hash + message count.
 */
export const runMirror = async (args: string[]): Promise<void> => {
  try {
    let sessionId: string | undefined;

    // Try to read session_id from stdin (hook input)
    if (!process.stdin.isTTY) {
      try {
        const input = await new Response(process.stdin as any).text();
        if (input.trim()) {
          const hookInput = JSON.parse(input);
          sessionId = hookInput?.session_id;
        }
      } catch {
        // stdin not available or not JSON — fall back to auto-detection
      }
    }

    let result: { id: string; path: string } | null;

    if (sessionId) {
      // Find the source path for this session ID
      const info = await getCurrentSessionId();
      if (info && info.id === sessionId) {
        const path = await syncSession(sessionId, info.sourcePath);
        result = { id: sessionId, path };
      } else {
        // Session ID from hook doesn't match most recent — try to sync most recent anyway
        result = await syncCurrentSession();
      }
    } else {
      result = await syncCurrentSession();
    }

    if (!result) {
      console.error('No session found to mirror');
      process.exitCode = 1;
      return;
    }

    // Update session state, preserving digestedAt/digestedHash from prior entry
    const targetPath = join(resolveSessionLogDir(), `${result.id}.jsonl`);
    const content = await readFile(targetPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);

    const state = await loadState();
    const prev = state.sessions[targetPath];

    await updateSession(targetPath, {
      path: targetPath,
      contentHash: hashContent(content),
      size: Buffer.byteLength(content),
      mtime: Date.now(),
      messageCount: lines.length,
      digestedAt: prev?.digestedAt ?? null,
      digestedHash: prev?.digestedHash ?? null,
    });

    console.log(`Mirrored session ${result.id}`);
  } catch (error: any) {
    console.error(`Mirror failed: ${error?.message ?? 'unknown error'}`);
    process.exitCode = 1;
  }
};
