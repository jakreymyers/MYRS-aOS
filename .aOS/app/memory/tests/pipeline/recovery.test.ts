import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPipeline } from '../../src/pipeline/orchestrate';
import { loadFacts } from '../../src/knowledge/facts';

let root: string;
let contextRoot: string;
let memoryRoot: string;
let sessionDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pipeline-recovery-test-'));
  contextRoot = join(root, 'context');
  memoryRoot = join(root, 'memory');
  sessionDir = join(root, 'sessions');

  process.env.CONTEXT_ROOT = contextRoot;
  process.env.MEMORY_ROOT = memoryRoot;
  process.env.SESSION_LOG_DIR = sessionDir;

  await mkdir(sessionDir, { recursive: true });
  await mkdir(join(memoryRoot, 'daily-notes'), { recursive: true });
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.MEMORY_ROOT;
  delete process.env.SESSION_LOG_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('pipeline crash recovery', () => {
  test('rerun after apply-stage failure does not duplicate facts', async () => {
    const sessionPath = join(sessionDir, 'session-crash.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Jane leads platform engineering.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    let extractCalls = 0;
    const llm = async () => {
      extractCalls++;
      return JSON.stringify({
        facts: [
          {
            entityPath: 'people/jane',
            fact: 'Jane leads platform engineering',
            category: 'status',
            importance: 2,
            timestamp: '2026-02-12T09:00',
            relatedEntities: [],
          },
        ],
        newEntities: [
          { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [] },
        ],
        sessionSummary: 'Status update.',
      });
    };
    let consolidateCalls = 0;
    const consolidateCaller = async () => {
      consolidateCalls++;
      if (consolidateCalls === 1) {
        return JSON.stringify({
          decisions: [{ candidateIndex: 0, action: 'create' }],
        });
      }
      return JSON.stringify({
        decisions: [{ candidateIndex: 0, action: 'drop', reason: 'duplicate' }],
      });
    };

    await expect(runPipeline({
      sessionPath,
      llmCaller: llm,
      consolidateCaller,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
      hooks: {
        afterApply: async () => {
          throw new Error('simulated crash');
        },
      },
    })).rejects.toThrow('simulated crash');

    const afterCrash = await loadFacts(join(contextRoot, 'people', 'jane'));
    expect(afterCrash).toHaveLength(1);

    const rerun = await runPipeline({
      sessionPath,
      llmCaller: llm,
      consolidateCaller,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    });

    expect(rerun.processed).toBe(true);
    expect(extractCalls).toBe(2);
    expect(consolidateCalls).toBe(2);

    const afterRerun = await loadFacts(join(contextRoot, 'people', 'jane'));
    expect(afterRerun).toHaveLength(1);
  });
});
