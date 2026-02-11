import { describe, expect, test } from 'bun:test';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { readSessionMessages } from '../../src/session/logs';

describe('Session log parsing', () => {
  test('parses user and assistant messages, ignores others', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'memory-app-session-'));
    const file = join(dir, 'session.jsonl');
    const payload = [
      JSON.stringify({ type: 'session', version: 2, id: 'abc', timestamp: '2026-02-05T10:00:00Z' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'Hello', timestamp: '2026-02-05T10:01:00Z' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'Hi', timestamp: '2026-02-05T10:01:10Z' } }),
      JSON.stringify({ type: 'message', message: { role: 'tool', content: 'ignore', timestamp: '2026-02-05T10:01:20Z' } }),
    ].join('\n');
    await writeFile(file, payload);

    const messages = await readSessionMessages(file);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');

    await rm(dir, { recursive: true, force: true });
  });

  test('parses Claude Code style top-level user/assistant messages', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'memory-app-session-'));
    const file = join(dir, 'session.jsonl');
    const payload = [
      JSON.stringify({ type: 'user', content: 'User text', timestamp: '2026-02-05T10:01:00Z' }),
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'Assistant text' }], timestamp: '2026-02-05T10:01:10Z' }),
    ].join('\n');
    await writeFile(file, payload);

    const messages = await readSessionMessages(file, '1234-2026-02-05');
    expect(messages.length).toBe(2);
    expect(messages[0].content).toContain('User text');
    expect(messages[1].content).toContain('Assistant text');
    expect(messages[0].sessionId).toBe('1234-2026-02-05');

    await rm(dir, { recursive: true, force: true });
  });
});
