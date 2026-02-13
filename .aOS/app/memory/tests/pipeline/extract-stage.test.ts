import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runExtractStage } from '../../src/pipeline/extract-stage';

let root: string;
let contextRoot: string;
let sessionDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'extract-stage-test-'));
  contextRoot = join(root, 'context');
  sessionDir = join(root, 'sessions');
  process.env.CONTEXT_ROOT = contextRoot;
  process.env.SESSION_LOG_DIR = sessionDir;

  await mkdir(contextRoot, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
});

afterEach(async () => {
  delete process.env.CONTEXT_ROOT;
  delete process.env.SESSION_LOG_DIR;
  await rm(root, { recursive: true, force: true });
});

const writeSession = async (path: string, lines: unknown[]): Promise<void> => {
  await writeFile(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
};

describe('runExtractStage delta mode', () => {
  test('uses only new messages and previous summary when delta boundary is valid', async () => {
    const sessionPath = join(sessionDir, 'delta.jsonl');
    await writeSession(sessionPath, [
      { type: 'message', message: { role: 'user', content: 'old message', timestamp: '2026-02-13T09:00:00Z' } },
      { type: 'message', message: { role: 'user', content: 'new message', timestamp: '2026-02-13T09:30:00Z' } },
    ]);

    const prompts: string[] = [];
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ facts: [], newEntities: [], sessionSummary: 'summary' });
    };

    const result = await runExtractStage({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'system',
      extractUserPromptTemplate: 'prev={{previous_summary}}\nlabel={{transcript_label}}\nmsgs={{messages}}',
      contextRoot,
      digestedMessageCount: 1,
      previousSummary: 'prior summary',
    });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toContain('new message');
    expect(prompts[0] ?? '').toContain('prior summary');
    expect(prompts[0] ?? '').toContain('new message');
    expect(prompts[0] ?? '').not.toContain('old message');
  });

  test('falls back to full extraction when stored boundary is stale', async () => {
    const sessionPath = join(sessionDir, 'stale.jsonl');
    await writeSession(sessionPath, [
      { type: 'message', message: { role: 'user', content: 'first', timestamp: '2026-02-13T09:00:00Z' } },
      { type: 'message', message: { role: 'assistant', content: 'second', timestamp: '2026-02-13T09:01:00Z' } },
    ]);

    const prompts: string[] = [];
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ facts: [], newEntities: [], sessionSummary: 'summary' });
    };

    const result = await runExtractStage({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'system',
      extractUserPromptTemplate: 'prev={{previous_summary}}\nmsgs={{messages}}',
      contextRoot,
      digestedMessageCount: 50,
      previousSummary: 'should be ignored',
    });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.messages).toHaveLength(2);
    expect(prompts[0] ?? '').toContain('first');
    expect(prompts[0] ?? '').toContain('second');
    expect(prompts[0] ?? '').not.toContain('should be ignored');
  });

  test('retries once with user-only messages when first extraction returns zero facts', async () => {
    const sessionPath = join(sessionDir, 'retry.jsonl');
    await writeSession(sessionPath, [
      { type: 'message', message: { role: 'user', content: 'Jak met Artemis and selected candidates', timestamp: '2026-02-13T10:00:00Z' } },
      { type: 'message', message: { role: 'assistant', content: 'long technical output chunk', timestamp: '2026-02-13T10:01:00Z' } },
    ]);

    const prompts: string[] = [];
    const llm = async (prompt: string) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return JSON.stringify({ facts: [], newEntities: [], sessionSummary: 'none' });
      }
      return JSON.stringify({
        facts: [
          {
            entityPath: 'projects/artemis',
            fact: 'Jak identified four BI consultant candidates with Artemis and is narrowing to two interviews next week',
            category: 'milestone',
            importance: 2,
            timestamp: '2026-02-13T10:00',
            relatedEntities: ['people/jak-myers'],
          },
        ],
        newEntities: [],
        sessionSummary: 'Candidate shortlist update.',
      });
    };

    const result = await runExtractStage({
      sessionPath,
      llmCaller: llm,
      extractSystemPrompt: 'system',
      extractUserPromptTemplate: 'msgs={{messages}}',
      contextRoot,
    });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('ASSISTANT: long technical output chunk');
    expect(prompts[1]).not.toContain('ASSISTANT: long technical output chunk');
    expect(result.extraction.facts).toHaveLength(1);
    expect(result.extraction.facts[0]?.entityPath).toBe('projects/artemis');
  });
});
