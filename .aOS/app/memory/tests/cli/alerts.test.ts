import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAlerts } from '../../src/cli/alerts';

let root: string;
let contextRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'alerts-test-'));
  contextRoot = join(root, 'context');

  process.env.CONTEXT_ROOT = contextRoot;

  const entityDir = join(contextRoot, 'projects', 'alpha');
  await mkdir(entityDir, { recursive: true });
  await writeFile(join(entityDir, 'summary.md'), `---
title: "Alpha"
type: project
created: 2026-02-01
updated: 2026-02-01
tags: [alpha]
---

# Alpha
`);
  await writeFile(join(entityDir, 'items.json'), JSON.stringify([
    {
      id: 'alpha-001',
      fact: 'Alpha milestone due by 2026-02-20',
      category: 'milestone',
      timestamp: '2026-02-20',
      source: 'seed',
      status: 'active',
      supersededBy: null,
      relatedEntities: [],
      lastAccessed: '2026-01-01',
      accessCount: 1,
      importance: 3,
    },
  ], null, 2) + '\n');
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('memory alerts', () => {
  test('detects upcoming milestones and neglected critical facts', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg ?? ''));

    try {
      await runAlerts(['--json', '--today', '2026-02-12']);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n'));
    expect(payload.upcomingMilestones.length).toBeGreaterThan(0);
    expect(payload.neglectedCriticalFacts.length).toBeGreaterThan(0);
  });
});
