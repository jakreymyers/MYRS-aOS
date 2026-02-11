import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { syncSession, extractMessagesFromNativeLog } from '../../src/session/logger';

describe('Session logger', () => {
  test('extracts messages from native Claude Code log format', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'memory-app-session-log-'));
    const logPath = join(dir, 'test-session.jsonl');

    // Mock native Claude Code log format
    const nativeLog = [
      '{"type":"user","message":{"content":"Hello"},"timestamp":"2026-02-05T10:00:00Z"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there!"}]},"timestamp":"2026-02-05T10:00:01Z"}',
      '{"type":"file-history-snapshot","data":{}}', // Should be skipped
    ].join('\n');

    await writeFile(logPath, nativeLog);
    const messages = await extractMessagesFromNativeLog(logPath);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Hi there!');

    await rm(dir, { recursive: true, force: true });
  });

  test('syncs session with UUID filename', async () => {
    const sourceDir = await mkdtemp(join(os.tmpdir(), 'memory-app-source-'));
    const targetDir = await mkdtemp(join(os.tmpdir(), 'memory-app-target-'));
    const sessionId = 'abc12345-1234-5678-9abc-def012345678';
    const sourcePath = join(sourceDir, `${sessionId}.jsonl`);

    // Mock native log
    const nativeLog = [
      '{"type":"user","message":{"content":"Test message"},"timestamp":"2026-02-05T10:00:00Z"}',
    ].join('\n');
    await writeFile(sourcePath, nativeLog);

    const targetPath = await syncSession(sessionId, sourcePath, targetDir);

    expect(targetPath).toBe(join(targetDir, `${sessionId}.jsonl`));

    const content = await readFile(targetPath, 'utf8');
    expect(content).toContain('"type":"session"');
    expect(content).toContain('"type":"message"');
    expect(content).toContain('"type":"session_end"');
    expect(content).toContain(sessionId);

    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  });
});
