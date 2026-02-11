import { readFile } from 'node:fs/promises';
import type { SessionMessage } from '../types';

const extractText = (value: any): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (typeof block?.text === 'string') return block.text;
        return null;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (typeof value?.content === 'string') return value.content;
  if (Array.isArray(value?.content)) return extractText(value.content);
  if (typeof value?.text === 'string') return value.text;
  return null;
};

export const readSessionMessages = async (filePath: string, sessionId?: string): Promise<SessionMessage[]> => {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const messages: SessionMessage[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'message') {
        const message = parsed.message;
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
        const text = extractText(message.content);
        if (!text) continue;
        messages.push({
          role: message.role,
          content: text,
          timestamp: message.timestamp,
          sessionId: message.session_id ?? parsed.session_id ?? sessionId,
        });
        continue;
      }

      if (parsed?.type === 'user' || parsed?.type === 'assistant') {
        const text = extractText(parsed.message?.content ?? parsed.content ?? parsed.text);
        if (!text) continue;
        messages.push({
          role: parsed.type,
          content: text,
          timestamp: parsed.timestamp,
          sessionId: parsed.session_id ?? sessionId,
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
