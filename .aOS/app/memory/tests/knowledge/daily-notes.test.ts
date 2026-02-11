import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendDailyNote } from '../../src/knowledge/daily-notes';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'daily-notes-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('appendDailyNote', () => {
  test('creates new file with date heading', async () => {
    const path = await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'abc12345-full-id',
      time: '14:30',
      summary: 'Reviewed memory upgrade plan.',
      factCount: 5,
      entityPaths: ['areas/people/jak', 'projects/memory-v3'],
    });

    const content = await readFile(path, 'utf8');
    expect(content).toContain('# 2026-02-07');
    expect(content).toContain('## Session abc12345 (14:30)');
    expect(content).toContain('Reviewed memory upgrade plan.');
    expect(content).toContain('_5 facts extracted → areas/people/jak, projects/memory-v3_');
  });

  test('appends to existing file', async () => {
    await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'first-session-id',
      time: '10:00',
      summary: 'First session.',
      factCount: 2,
      entityPaths: ['areas/people/jak'],
    });

    await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'second-session-id',
      time: '14:30',
      summary: 'Second session.',
      factCount: 3,
      entityPaths: ['projects/alpha'],
    });

    const content = await readFile(join(testDir, '2026-02-07.md'), 'utf8');
    expect(content).toContain('## Session first-se (10:00)');
    expect(content).toContain('## Session second-s (14:30)');
    // Should have only one date heading
    const headingCount = (content.match(/^# 2026-02-07$/gm) || []).length;
    expect(headingCount).toBe(1);
  });

  test('replaces existing entry for same session', async () => {
    await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'abc12345-full-id',
      time: '14:30',
      summary: 'First extraction.',
      factCount: 3,
      entityPaths: ['projects/alpha'],
    });

    await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'abc12345-full-id',
      time: '14:30',
      summary: 'Updated extraction with more facts.',
      factCount: 7,
      entityPaths: ['projects/alpha', 'people/jak'],
    });

    const content = await readFile(join(testDir, '2026-02-07.md'), 'utf8');
    // Should have exactly one entry for this session
    const matches = content.match(/## Session abc12345/g) || [];
    expect(matches.length).toBe(1);
    // Should contain the updated content
    expect(content).toContain('Updated extraction with more facts.');
    expect(content).not.toContain('First extraction.');
    expect(content).toContain('_7 facts extracted');
  });

  test('handles zero facts gracefully', async () => {
    await appendDailyNote({
      dir: testDir,
      date: '2026-02-07',
      sessionId: 'nofacts-session',
      time: '09:00',
      summary: 'Quick check-in.',
      factCount: 0,
      entityPaths: [],
    });

    const content = await readFile(join(testDir, '2026-02-07.md'), 'utf8');
    expect(content).toContain('Quick check-in.');
    // No facts line when count is 0 and no entities
    expect(content).not.toContain('_0 facts');
  });
});
