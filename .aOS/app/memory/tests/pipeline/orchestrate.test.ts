import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPipeline } from '../../src/pipeline/orchestrate';
import { loadFacts } from '../../src/knowledge/facts';
import { loadGraphState } from '../../src/knowledge/state';
import { loadState } from '../../src/session/state';

let root: string;
let contextRoot: string;
let memoryRoot: string;
let sessionDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pipeline-orchestrate-test-'));
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

describe('runPipeline', () => {
  test('extracts/consolidates/applies and writes decisions + lessons to daily notes', async () => {
    const sessionPath = join(sessionDir, 'session-1.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Jane chose Snowflake for cost and we learned to validate paths.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    let call = 0;
    const llm = async () => {
      call++;
      if (call === 1) {
        return JSON.stringify({
          facts: [
            {
              entityPath: 'people/jane',
              fact: 'Jane chose Snowflake over Redshift for cost reasons',
              category: 'decision',
              importance: 3,
              timestamp: '2026-02-12T09:00',
              relatedEntities: ['projects/data-platform'],
            },
          ],
          newEntities: [
            { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [] },
          ],
          sessionSummary: 'Discussed platform decisions.',
          decisions: ['Chose Snowflake over Redshift because of cost efficiency'],
          lessons: ['Validate extracted entity paths before write'],
        });
      }

      return JSON.stringify({
        decisions: [{ candidateIndex: 0, action: 'create' }],
      });
    };

    const result = await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    });

    expect(result.processed).toBe(true);
    expect(result.createdFacts).toBe(1);

    const facts = await loadFacts(join(contextRoot, 'people', 'jane'));
    expect(facts).toHaveLength(1);

    const note = await readFile(join(memoryRoot, 'daily-notes', '2026-02-12.md'), 'utf8');
    expect(note).toContain('Recent decisions:');
    expect(note).toContain('Lessons learned:');
    expect(note).toContain('Chose Snowflake over Redshift');
    expect(note).toContain('Validate extracted entity paths');

    const graph = await loadGraphState(memoryRoot);
    expect(graph.lastExtraction).not.toBeNull();
  });

  test('second run with unchanged content is a no-op', async () => {
    const sessionPath = join(sessionDir, 'session-2.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Jane leads platform engineering.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    let call = 0;
    const llm = async () => {
      call++;
      if (call === 1) {
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
      }

      return JSON.stringify({
        decisions: [{ candidateIndex: 0, action: 'create' }],
      });
    };

    const first = await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    });

    const second = await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    });

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(second.reason).toBe('unchanged');

    const facts = await loadFacts(join(contextRoot, 'people', 'jane'));
    expect(facts).toHaveLength(1);
  });

  test('parse fallback increments consolidationFailures', async () => {
    const sessionPath = join(sessionDir, 'session-3.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Jane shared an update.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    const llm = async () => JSON.stringify({
      facts: [
        {
          entityPath: 'people/jane',
          fact: 'Jane shared project update',
          category: 'status',
          importance: 1,
          timestamp: '2026-02-12T09:00',
          relatedEntities: [],
        },
      ],
      newEntities: [
        { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [] },
      ],
      sessionSummary: 'Update.',
    });

    const consolidateCaller = async () => 'not-json';

    const result = await runPipeline({
      sessionPath,
      llmCaller: llm,
      consolidateCaller,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    });

    expect(result.processed).toBe(true);
    expect(result.fallbackCount).toBe(1);

    const graph = await loadGraphState(memoryRoot);
    expect(graph.consolidationFailures).toBe(1);
  });

  test('concurrent runs on same session do not duplicate facts', async () => {
    const sessionPath = join(sessionDir, 'session-concurrent.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Jane chose Snowflake for cost reasons.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    let extractCalls = 0;
    const llm = async () => {
      extractCalls++;
      // Both calls return the same extraction — simulates two processes
      // that both read stale state and both decided to extract.
      return JSON.stringify({
        facts: [
          {
            entityPath: 'people/jane',
            fact: 'Jane chose Snowflake for cost reasons',
            category: 'decision',
            importance: 3,
            timestamp: '2026-02-12T09:00',
            relatedEntities: [],
          },
        ],
        newEntities: [
          { path: 'people/jane', name: 'Jane', type: 'person', bucket: 'people', tags: [] },
        ],
        sessionSummary: 'Platform decision.',
      });
    };

    const consolidateCaller = async () => JSON.stringify({
      decisions: [{ candidateIndex: 0, action: 'create' }],
    });

    const opts = {
      sessionPath,
      llmCaller: llm,
      consolidateCaller,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      consolidateSystemPrompt: 'consolidate-system',
      consolidateUserPromptTemplate: 'consolidate-user',
    };

    const [a, b] = await Promise.all([runPipeline(opts), runPipeline(opts)]);

    // Exactly one should have processed; the other should be unchanged
    // (either blocked by lock or caught by double-check).
    const processed = [a, b].filter((r) => r.processed);
    const skipped = [a, b].filter((r) => !r.processed);
    expect(processed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(processed[0].createdFacts).toBe(1);

    // Most importantly: only 1 fact in the entity, not 2
    const facts = await loadFacts(join(contextRoot, 'people', 'jane'));
    expect(facts).toHaveLength(1);
  });

  test('uses previous session summary and only new messages on delta extraction', async () => {
    const sessionPath = join(sessionDir, 'session-delta.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Old discussion content.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    const prompts: string[] = [];
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({
        facts: [],
        newEntities: [],
        sessionSummary: prompts.length === 1 ? 'Initial summary' : 'Updated summary',
      });
    };

    await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'prev={{previous_summary}}\nlabel={{transcript_label}}\nmsgs={{messages}}',
      noConsolidate: true,
    });

    await writeFile(sessionPath, [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'Old discussion content.',
          timestamp: '2026-02-12T09:00:00Z',
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'New candidate shortlist update.',
          timestamp: '2026-02-12T10:00:00Z',
        },
      }),
    ].join('\n') + '\n');

    await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'prev={{previous_summary}}\nlabel={{transcript_label}}\nmsgs={{messages}}',
      noConsolidate: true,
    });

    const secondPrompt = prompts[1] ?? '';
    expect(secondPrompt).toContain('Initial summary');
    expect(secondPrompt).toContain('New candidate shortlist update.');
    expect(secondPrompt).not.toContain('Old discussion content.');

    const state = await loadState();
    expect(state.sessions[sessionPath]?.digestedMessageCount).toBe(2);
    expect(state.sessions[sessionPath]?.sessionSummary).toBe('Updated summary');
  });

  test('writes minimal session state entry schema', async () => {
    const sessionPath = join(sessionDir, 'session-4.jsonl');
    await writeFile(sessionPath, JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Status update.',
        timestamp: '2026-02-12T09:00:00Z',
      },
    }) + '\n');

    const llm = async () => JSON.stringify({
      facts: [],
      newEntities: [],
      sessionSummary: 'No facts.',
    });

    await runPipeline({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'extract-system',
      extractUserPromptTemplate: 'extract-user',
      noConsolidate: true,
    });

    const state = await loadState();
    const entry = state.sessions[sessionPath];
    const entryObj: object = entry;
    expect(entry.contentHash).toBeDefined();
    expect(entry.digestedAt).toBeDefined();
    expect(entry.digestedHash).toBeDefined();
    expect(entry.digestedMessageCount).toBe(1);
    expect(entry.sessionSummary).toBe('No facts.');
    expect(Object.hasOwn(entryObj, 'extractedFactIds' )).toBe(false);
    expect(Object.hasOwn(entryObj, 'digestedLineCount')).toBe(false);
    expect(Object.hasOwn(entryObj, 'size')).toBe(false);
    expect(Object.hasOwn(entryObj, 'mtime')).toBe(false);
    expect(Object.hasOwn(entryObj, 'messageCount')).toBe(false);
    expect(Object.hasOwn(entryObj, 'path')).toBe(false);
  });
});
