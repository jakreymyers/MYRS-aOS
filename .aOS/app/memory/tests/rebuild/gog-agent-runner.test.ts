import { describe, expect, test } from 'bun:test';
import {
  extractFollowupTerms,
  isLowValueFact,
  runGogAgentTask,
  type GogRunResponse,
} from '../../src/rebuild/gog-agent-runner';
import type { SubagentTask } from '../../src/rebuild/swarm';

const baseTask = (overrides: Partial<SubagentTask> = {}): SubagentTask => ({
  entity: {
    path: 'people/jak-myers',
    name: 'Jak Myers',
    type: 'person',
    bucket: 'people',
    tags: ['leadership'],
    factCount: 0,
    lastUpdated: '2026-02-12',
  },
  entityPath: 'people/jak-myers',
  entityType: 'people',
  attempt: 1,
  maxCalls: 10,
  knownEntityPaths: [
    'people/jak-myers',
    'people/beth-gunzel',
    'projects/publications-workflow-transformation',
  ],
  ...overrides,
});

describe('gog agent runner', () => {
  test('filters low-value count facts and maps related entities to known paths', async () => {
    const calls: string[][] = [];
    const runGog = (args: string[]): GogRunResponse => {
      calls.push(args);
      if (args[0] === 'gmail' && args[1] === 'messages') {
        return {
          ok: true,
          data: {
            messages: [
              {
                id: 'm-1',
                internalDate: '2026-02-10T09:00:00Z',
                subject: 'Aptara renewal',
                snippet: 'Jak Myers and Beth Gunzel aligned on Publications Workflow Transformation milestones.',
              },
            ],
          },
        };
      }
      if (args[0] === 'drive' && args[1] === 'search') {
        return {
          ok: true,
          data: {
            files: [
              {
                id: 'd-1',
                modifiedTime: '2026-02-09T08:00:00Z',
                name: 'Aptara SOW Draft',
                webViewLink: 'https://drive.example/d-1',
              },
            ],
          },
        };
      }
      if (args[0] === 'drive' && args[1] === 'get') {
        return {
          ok: true,
          data: {
            id: 'd-1',
            modifiedTime: '2026-02-09T08:00:00Z',
            name: 'Aptara SOW Draft',
            description: 'Statement of work for editorial production scope',
            owners: [{ displayName: 'Beth Gunzel' }],
          },
        };
      }
      if (args[0] === 'calendar') {
        return { ok: true, data: { events: [] } };
      }
      if (args[0] === 'contacts') {
        return {
          ok: true,
          data: {
            contacts: [{ name: 'Jak Myers', resourceName: 'contacts/1', updateTime: '2026-02-01T00:00:00Z' }],
          },
        };
      }
      return { ok: true, data: {} };
    };

    const result = await runGogAgentTask(baseTask(), {
      runGog,
      runExtract: async () => JSON.stringify({
        facts: [
          {
            fact: 'Aptara has 5 related Drive file(s).',
            category: 'context',
            importance: 1,
            timestamp: '2026-02-10T09:00',
            relatedEntities: [],
            evidenceIndex: 0,
          },
          {
            fact: 'Jak Myers and Beth Gunzel are coordinating Aptara SOW milestones for Publications Workflow Transformation.',
            category: 'relationship',
            importance: 2,
            timestamp: '2026-02-10T09:00',
            relatedEntities: ['beth-gunzel', 'projects/publications-workflow-transformation', 'people/unknown'],
            evidenceIndex: 0,
          },
        ],
      }),
      now: () => new Date('2026-02-12T12:00:00Z'),
    });

    expect(result.callCount).toBeGreaterThan(0);
    expect(result.payload.facts.length).toBe(1);
    expect(result.payload.facts[0].fact).toContain('coordinating Aptara SOW milestones');
    expect(result.payload.facts[0].relatedEntities).toEqual([
      'people/beth-gunzel',
      'projects/publications-workflow-transformation',
    ]);
    expect(calls.some((args) => args[0] === 'gmail' && args[1] === 'messages')).toBe(true);
  });

  test('discovers follow-up terms and uses them in iterative gmail/drive traversal', async () => {
    const calls: string[][] = [];
    const task = baseTask({
      entityPath: 'projects/agentic-os',
      entityType: 'project',
      maxCalls: 6,
      entity: {
        path: 'projects/agentic-os',
        name: 'Agentic OS',
        type: 'project',
        bucket: 'projects',
        tags: [],
        factCount: 0,
        lastUpdated: '2026-02-12',
      },
    });

    const runGog = (args: string[]): GogRunResponse => {
      calls.push(args);
      if (args[0] === 'gmail' && args[1] === 'messages' && args[2] === 'search') {
        return {
          ok: true,
          data: {
            messages: [
              {
                id: `msg-${calls.length}`,
                internalDate: '2026-02-11T10:00:00Z',
                subject: 'Global Physics Summit planning',
                snippet: 'Editorial Board discussed dependencies for launch readiness.',
              },
            ],
          },
        };
      }
      if (args[0] === 'drive' && args[1] === 'search') {
        return { ok: true, data: { files: [] } };
      }
      if (args[0] === 'calendar') {
        return { ok: true, data: { events: [] } };
      }
      return { ok: true, data: {} };
    };

    const result = await runGogAgentTask(task, {
      runGog,
      runExtract: async () => JSON.stringify({ facts: [] }),
      now: () => new Date('2026-02-12T12:00:00Z'),
    });

    expect(result.callCount).toBeLessThanOrEqual(6);
    const followupGmail = calls.find((args) =>
      args[0] === 'gmail'
      && args[1] === 'messages'
      && args[2] === 'search'
      && /Global Physics Summit|Editorial Board/.test(args[3] ?? ''),
    );
    const followupDrive = calls.find((args) =>
      args[0] === 'drive'
      && args[1] === 'search'
      && /Global Physics Summit|Editorial Board/.test(args[2] ?? ''),
    );

    expect(followupGmail).toBeDefined();
    expect(followupDrive).toBeDefined();
  });

  test('utility filters identify low-value facts and term extraction returns multiword entities', () => {
    expect(isLowValueFact('Aptara has 5 related Drive file(s).')).toBe(true);
    expect(isLowValueFact('Beth Gunzel owns the SOW timeline for Aptara')).toBe(false);

    const terms = extractFollowupTerms([
      {
        sourceType: 'gmail',
        sourceId: 'm-1',
        sourceDate: '2026-02-12T10:00:00Z',
        title: 'Global Physics Summit planning',
        snippet: 'Editorial Board dependencies were escalated.',
      },
    ], 'Agentic OS', 3);

    expect(terms).toContain('Global Physics Summit');
    expect(terms).toContain('Editorial Board');
  });

  test('retries extraction prompt when first pass yields zero accepted facts', async () => {
    let extractCalls = 0;
    const result = await runGogAgentTask(baseTask(), {
      runGog: (args) => {
        if (args[0] === 'gmail' && args[1] === 'messages') {
          return {
            ok: true,
            data: {
              messages: [
                {
                  id: 'm-1',
                  internalDate: '2026-02-10T09:00:00Z',
                  subject: 'Editorial milestone',
                  snippet: 'Beth Gunzel approved milestone checkpoint for PWT.',
                },
              ],
            },
          };
        }
        if (args[0] === 'drive' && args[1] === 'search') {
          return { ok: true, data: { files: [] } };
        }
        if (args[0] === 'calendar') {
          return { ok: true, data: { events: [] } };
        }
        if (args[0] === 'contacts') {
          return { ok: true, data: { contacts: [] } };
        }
        return { ok: true, data: {} };
      },
      runExtract: async () => {
        extractCalls++;
        if (extractCalls === 1) return JSON.stringify({ facts: [] });
        return JSON.stringify({
          facts: [
            {
              fact: 'Beth Gunzel approved a Publications Workflow Transformation milestone checkpoint.',
              category: 'milestone',
              importance: 2,
              timestamp: '2026-02-10T09:00',
              relatedEntities: ['projects/publications-workflow-transformation'],
              evidenceIndex: 0,
            },
          ],
        });
      },
      now: () => new Date('2026-02-12T12:00:00Z'),
    });

    expect(extractCalls).toBe(2);
    expect(result.payload.facts.length).toBe(1);
    expect(result.payload.facts[0].category).toBe('milestone');
  });

  test('uses slug/tag fallback query variants when primary query returns no evidence', async () => {
    const calls: string[][] = [];
    const task = baseTask({
      entityPath: 'projects/agentic-os',
      entityType: 'project',
      entity: {
        path: 'projects/agentic-os',
        name: 'Agentic OS',
        type: 'project',
        bucket: 'projects',
        tags: ['context-population'],
        factCount: 0,
        lastUpdated: '2026-02-12',
      },
    });

    const result = await runGogAgentTask(task, {
      runGog: (args) => {
        calls.push(args);
        if (args[0] === 'gmail' && args[1] === 'messages' && args[2] === 'search') {
          const query = String(args[3] ?? '').toLowerCase();
          if (query.includes('context population newer_than:1095d')) {
            return {
              ok: true,
              data: {
                messages: [
                  {
                    id: 'm-fallback',
                    internalDate: '2026-02-11T10:00:00Z',
                    subject: 'Agentic OS context population',
                    snippet: 'Context population sequencing was discussed with publications team.',
                  },
                ],
              },
            };
          }
          return { ok: true, data: { messages: [] } };
        }
        if (args[0] === 'drive' && args[1] === 'search') {
          return { ok: true, data: { files: [] } };
        }
        if (args[0] === 'calendar') {
          return { ok: true, data: { events: [] } };
        }
        return { ok: true, data: {} };
      },
      runExtract: async () => JSON.stringify({
        facts: [
          {
            fact: 'Agentic OS context population sequencing was reviewed with the publications team.',
            category: 'status',
            importance: 2,
            timestamp: '2026-02-11T10:00',
            relatedEntities: [],
            evidenceIndex: 0,
          },
        ],
      }),
      now: () => new Date('2026-02-12T12:00:00Z'),
    });

    expect(result.payload.facts.length).toBe(1);
    expect(
      calls.some((args) =>
        args[0] === 'gmail'
        && args[1] === 'messages'
        && args[2] === 'search'
        && String(args[3] ?? '').toLowerCase().includes('context population newer_than:1095d'),
      ),
    ).toBe(true);
  });
});
