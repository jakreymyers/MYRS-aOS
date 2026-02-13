import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../../src/utils/atomic';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atomic-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  test('writes new file atomically and leaves no tmp files', async () => {
    const filePath = join(root, 'data', 'state.json');
    await atomicWrite(filePath, '{"ok":true}\n');

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('{"ok":true}\n');

    const files = await readdir(join(root, 'data'));
    expect(files.some((f) => f.includes('.tmp.'))).toBe(false);
  });

  test('overwrites existing file atomically', async () => {
    const filePath = join(root, 'state.json');
    await atomicWrite(filePath, 'old\n');
    await atomicWrite(filePath, 'new\n');

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('new\n');
  });
});
