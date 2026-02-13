import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mutateState } from '../../src/utils/state';

let root: string;
let statePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'state-mutate-test-'));
  statePath = join(root, 'session-state.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('mutateState', () => {
  test('missing file starts from default and writes updated state', async () => {
    const result = await mutateState(statePath, { count: 0 }, (state) => ({
      count: state.count + 1,
    }));

    expect(result.count).toBe(1);

    const content = JSON.parse(await readFile(statePath, 'utf8')) as { count: number };
    expect(content.count).toBe(1);
  });

  test('concurrent in-process mutations preserve all updates', async () => {
    await Promise.all(
      Array.from({ length: 100 }, () =>
        mutateState(statePath, { count: 0 }, (state) => ({ count: state.count + 1 })),
      ),
    );

    const content = JSON.parse(await readFile(statePath, 'utf8')) as { count: number };
    expect(content.count).toBe(100);
  });

  test('corrupt json writes backup and fails closed', async () => {
    await writeFile(statePath, '{not-json\n');

    await expect(
      mutateState(statePath, { count: 0 }, (state) => ({ count: state.count + 1 })),
    ).rejects.toThrow();

    const backups = (await readdir(root)).filter((name) =>
      name.startsWith('session-state.json.corrupt-'),
    );
    expect(backups.length).toBe(1);

    const original = await readFile(statePath, 'utf8');
    expect(original).toBe('{not-json\n');
  });
});
