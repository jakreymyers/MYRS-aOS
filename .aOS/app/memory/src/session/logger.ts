import { mkdir, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { resolveSessionLogDir, resolveClaudeCodeSessionDir } from '../utils/paths';

export interface SessionIdInfo {
  id: string;
  sourcePath: string;
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find the most recent native Claude Code session log and extract its UUID.
 */
const findMostRecentNativeLog = async (sourceDir: string): Promise<{ path: string; id: string } | null> => {
  try {
    const files = await readdir(sourceDir);
    const uuidPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
    const jsonlFiles = files.filter(f => uuidPattern.test(f));

    if (jsonlFiles.length === 0) return null;

    let mostRecent: { file: string; id: string; mtime: number } | null = null;
    for (const file of jsonlFiles) {
      const filePath = join(sourceDir, file);
      const stats = await stat(filePath);
      const match = file.match(uuidPattern);
      if (match && (!mostRecent || stats.mtimeMs > mostRecent.mtime)) {
        mostRecent = { file: filePath, id: match[1], mtime: stats.mtimeMs };
      }
    }

    return mostRecent ? { path: mostRecent.file, id: mostRecent.id } : null;
  } catch {
    return null;
  }
};

/**
 * Get the current session ID from Claude Code's native logs.
 */
export const getCurrentSessionId = async (nativeDir?: string): Promise<SessionIdInfo | null> => {
  const dir = nativeDir ?? resolveClaudeCodeSessionDir();
  const result = await findMostRecentNativeLog(dir);
  if (!result) return null;
  return { id: result.id, sourcePath: result.path };
};

interface NativeLogEntry {
  type: string;
  message?: {
    content: string | Array<{ type: string; text?: string; thinking?: string }>;
  };
  timestamp?: string;
}

interface ExtractedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

const extractTextContent = (content: string | Array<{ type: string; text?: string }>): string | null => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const textParts = content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text as string);

  return textParts.length > 0 ? textParts.join('\n') : null;
};

/**
 * Extract user/assistant messages from a native Claude Code log file.
 */
export const extractMessagesFromNativeLog = async (logPath: string): Promise<ExtractedMessage[]> => {
  if (!(await fileExists(logPath))) return [];

  const messages: ExtractedMessage[] = [];
  const rl = createInterface({
    input: createReadStream(logPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line) as NativeLogEntry;

      if (entry.type !== 'user' && entry.type !== 'assistant') continue;
      if (!entry.message?.content) continue;

      const text = extractTextContent(entry.message.content);
      if (!text) continue;

      messages.push({
        role: entry.type as 'user' | 'assistant',
        content: text,
        timestamp: entry.timestamp,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
};

/**
 * Sync a specific session from Claude Code's native logs to our session directory.
 * Uses the same UUID as Claude Code for the filename. Overwrites if exists (idempotent).
 */
export const syncSession = async (sessionId: string, sourcePath: string, targetDir?: string): Promise<string> => {
  const dir = targetDir ?? resolveSessionLogDir();
  await mkdir(dir, { recursive: true });

  const targetPath = join(dir, `${sessionId}.jsonl`);
  const messages = await extractMessagesFromNativeLog(sourcePath);

  const header = {
    type: 'session',
    version: 1,
    id: sessionId,
    timestamp: new Date().toISOString(),
  };

  let content = JSON.stringify(header) + '\n';

  for (const msg of messages) {
    const entry = {
      type: 'message',
      message: {
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ?? new Date().toISOString(),
        session_id: sessionId,
      },
    };
    content += JSON.stringify(entry) + '\n';
  }

  const footer = {
    type: 'session_end',
    id: sessionId,
    timestamp: new Date().toISOString(),
  };
  content += JSON.stringify(footer) + '\n';

  await Bun.write(targetPath, content);
  return targetPath;
};

/**
 * Sync the current (most recent) session from Claude Code.
 */
export const syncCurrentSession = async (targetDir?: string): Promise<{ id: string; path: string } | null> => {
  const session = await getCurrentSessionId();
  if (!session) return null;

  const path = await syncSession(session.id, session.sourcePath, targetDir);
  return { id: session.id, path };
};
