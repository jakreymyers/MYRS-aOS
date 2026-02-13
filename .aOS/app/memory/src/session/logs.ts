import { readFile } from 'node:fs/promises';
import type { SessionMessage } from '../types';

const asRecord = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object') ? value as Record<string, unknown> : {};

const extractText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((rawBlock) => {
        const block = asRecord(rawBlock);
        if (typeof block === 'string') return block;
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        if (typeof block.text === 'string') return block.text;
        return null;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' ') : null;
  }
  const row = asRecord(value);
  if (typeof row.content === 'string') return row.content;
  if (Array.isArray(row.content)) return extractText(row.content);
  if (typeof row.text === 'string') return row.text;
  return null;
};

export const readSessionMessages = async (filePath: string, sessionId?: string): Promise<SessionMessage[]> => {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    try {
      const parsed = asRecord(JSON.parse(line));
      if (parsed.type === 'message') {
        const message = asRecord(parsed.message);
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
        const text = extractText(message.content);
        if (!text) continue;
        messages.push({
          role: message.role,
          content: text,
          timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
          sessionId: (typeof message.session_id === 'string' ? message.session_id : undefined)
            ?? (typeof parsed.session_id === 'string' ? parsed.session_id : undefined)
            ?? sessionId,
        });
        continue;
      }

      if (parsed.type === 'user' || parsed.type === 'assistant') {
        const message = asRecord(parsed.message);
        const text = extractText(message.content ?? parsed.content ?? parsed.text);
        if (!text) continue;
        messages.push({
          role: parsed.type,
          content: text,
          timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
          sessionId: (typeof parsed.session_id === 'string' ? parsed.session_id : undefined) ?? sessionId,
        });
      }
    } catch {
      continue;
    }
  }

  return messages;
};

/** Re-export SessionMessage type for convenience */
export type { SessionMessage };
