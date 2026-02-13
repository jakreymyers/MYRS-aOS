import { describe, expect, test } from 'bun:test';
import { parseExtractionResponse } from '../../src/knowledge/extract';

describe('parseExtractionResponse', () => {
  test('parses valid JSON directly', () => {
    const input = JSON.stringify({
      facts: [
        {
          entityPath: 'people/jane',
          fact: 'Jane is an engineer',
          category: 'status',
          timestamp: '2026-02-07',
          source: '2026-02-07',
          status: 'active',
          supersededBy: null,
          relatedEntities: ['areas/companies/aps'],
        },
      ],
      newEntities: [],
      sessionSummary: 'Discussed team structure.',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].entityPath).toBe('people/jane');
    expect(result.facts[0].fact.fact).toBe('Jane is an engineer');
    expect(result.facts[0].fact.relatedEntities).toEqual(['areas/companies/aps']);
    expect(result.sessionSummary).toBe('Discussed team structure.');
  });

  test('strips markdown code fences', () => {
    const input = '```json\n' + JSON.stringify({
      facts: [{ entityPath: 'projects/alpha', fact: 'Alpha launched', category: 'milestone' }],
      newEntities: [],
      sessionSummary: 'Launch day.',
    }) + '\n```';

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].fact.fact).toBe('Alpha launched');
  });

  test('extracts JSON from surrounding text', () => {
    const input = 'Here is the extraction:\n' + JSON.stringify({
      facts: [{ entityPath: 'people/bob', fact: 'Bob joined', category: 'milestone' }],
      newEntities: [],
      sessionSummary: 'New hire.',
    }) + '\nEnd of extraction.';

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(1);
  });

  test('returns empty for completely invalid input', () => {
    const result = parseExtractionResponse('This is not JSON at all.');
    expect(result.facts).toEqual([]);
    expect(result.newEntities).toEqual([]);
    expect(result.sessionSummary).toBe('');
  });

  test('filters out facts without required fields', () => {
    const input = JSON.stringify({
      facts: [
        { entityPath: 'people/jane', fact: 'Valid fact', category: 'status' },
        { entityPath: 'people/bob' },  // Missing fact
        { fact: 'No path' },                  // Missing entityPath
        { entityPath: 'x', fact: '' },        // Empty fact
      ],
      newEntities: [],
      sessionSummary: 'Mixed bag.',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].fact.fact).toBe('Valid fact');
  });

  test('filters out facts with invalid bucket prefix', () => {
    const input = JSON.stringify({
      facts: [
        { entityPath: 'projects/alpha', fact: 'Valid project fact' },
        { entityPath: 'workspace/projects/alpha', fact: 'Invalid bucket' },
        { entityPath: 'memory/something', fact: 'Invalid bucket' },
        { entityPath: 'people/jane', fact: 'Valid people fact' },
      ],
      newEntities: [],
      sessionSummary: 'Bucket validation test.',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0].entityPath).toBe('projects/alpha');
    expect(result.facts[1].entityPath).toBe('people/jane');
  });

  test('filters out facts with invalid path shape', () => {
    const input = JSON.stringify({
      facts: [
        { entityPath: 'people/jane', fact: 'Valid path' },
        { entityPath: 'people/jane/doe', fact: 'Too deep path should fail' },
        { entityPath: 'projects//alpha', fact: 'Empty segment should fail' },
      ],
      newEntities: [],
      sessionSummary: 'Path shape test.',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].entityPath).toBe('people/jane');
  });

  test('defaults missing optional fields', () => {
    const input = JSON.stringify({
      facts: [{ entityPath: 'projects/alpha', fact: 'Minimal fact' }],
      newEntities: [{ path: 'people/new', name: 'New Person' }],
      sessionSummary: 'Test.',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts[0].fact.category).toBe('context');
    expect(result.facts[0].fact.status).toBe('active');
    expect(result.facts[0].fact.supersededBy).toBeNull();
    expect(result.facts[0].fact.relatedEntities).toEqual([]);
    expect(result.newEntities[0].type).toBe('unknown');
    expect(result.newEntities[0].bucket).toBe('people');
    expect(result.newEntities[0].tags).toEqual([]);
    expect(result.facts[0].fact.importance).toBe(1);
  });

  test('preserves valid importance and normalizes invalid importance', () => {
    const input = JSON.stringify({
      facts: [
        { entityPath: 'projects/alpha', fact: 'Critical decision', category: 'decision', importance: 3 },
        { entityPath: 'projects/alpha', fact: 'Invalid high importance', importance: 99 },
      ],
      newEntities: [],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0].fact.importance).toBe(3);
    expect(result.facts[1].fact.importance).toBe(1);
  });

  test('filters out entities with invalid bucket prefix', () => {
    const input = JSON.stringify({
      facts: [],
      newEntities: [
        { path: 'people/valid', name: 'Valid', type: 'person', bucket: 'people', tags: ['test'] },
        { path: 'workspace/invalid', name: 'Bad Bucket' },
        { path: 'missing-name' },  // Missing name
        { name: 'No Path' },        // Missing path
      ],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.newEntities).toHaveLength(1);
    expect(result.newEntities[0].name).toBe('Valid');
  });

  test('filters invalid relatedEntities references', () => {
    const input = JSON.stringify({
      facts: [{
        entityPath: 'people/jane',
        fact: 'Jane works with Bob',
        relatedEntities: ['people/bob', 'workspace/bad', 'areas/companies/aps'],
      }],
      newEntities: [],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts[0].fact.relatedEntities).toEqual(['people/bob', 'areas/companies/aps']);
  });

  test('invalid category normalizes to context', () => {
    const input = JSON.stringify({
      facts: [{ entityPath: 'people/jane', fact: 'Test', category: 'bogus' }],
      newEntities: [],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts[0].fact.category).toBe('context');
  });

  test('invalid status normalizes to active', () => {
    const input = JSON.stringify({
      facts: [{ entityPath: 'people/jane', fact: 'Test', status: 'archived' }],
      newEntities: [],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts[0].fact.status).toBe('active');
  });

  test('supersededBy always forced to null', () => {
    const input = JSON.stringify({
      facts: [{ entityPath: 'people/jane', fact: 'Test', supersededBy: 'jane-005' }],
      newEntities: [],
      sessionSummary: '',
    });

    const result = parseExtractionResponse(input);
    expect(result.facts[0].fact.supersededBy).toBeNull();
  });

  test('captures decisions and lessons arrays when present', () => {
    const input = JSON.stringify({
      facts: [],
      newEntities: [],
      sessionSummary: 'Summary.',
      decisions: ['Chose option A over B'],
      lessons: ['Validate schema before persisting'],
    });

    const result = parseExtractionResponse(input);
    expect(result.decisions).toEqual(['Chose option A over B']);
    expect(result.lessons).toEqual(['Validate schema before persisting']);
  });
});

describe('extractFromMessages prompt context', () => {
  test('injects previous summary and transcript label placeholders', async () => {
    let seenPrompt = '';
    const llm = async (prompt: string) => {
      seenPrompt = prompt;
      return JSON.stringify({ facts: [], newEntities: [], sessionSummary: 'ok' });
    };

    const { extractFromMessages } = await import('../../src/knowledge/extract');
    await extractFromMessages({
      messages: [{ role: 'user', content: 'New update text' }],
      entityList: '',
      date: '2026-02-13',
      sessionId: 'session-123',
      llmCaller: llm,
      systemPrompt: 'system',
      userPromptTemplate: 'prev={{previous_summary}} label={{transcript_label}} msgs={{messages}}',
      previousSummary: 'Prior summary text',
      transcriptLabel: 'New messages since last extraction',
    } as unknown as Parameters<typeof extractFromMessages>[0]);

    expect(seenPrompt).toContain('Prior summary text');
    expect(seenPrompt).toContain('New messages since last extraction');
    expect(seenPrompt).toContain('USER: New update text');
  });

  test('caps previous summary to 500 words before prompt render', async () => {
    let seenPrompt = '';
    const llm = async (prompt: string) => {
      seenPrompt = prompt;
      return JSON.stringify({ facts: [], newEntities: [], sessionSummary: 'ok' });
    };

    const longSummary = Array.from({ length: 650 }, (_, i) => `word${i}`).join(' ');
    const { extractFromMessages } = await import('../../src/knowledge/extract');
    await extractFromMessages({
      messages: [{ role: 'user', content: 'Delta message' }],
      entityList: '',
      date: '2026-02-13',
      sessionId: 'session-124',
      llmCaller: llm,
      systemPrompt: 'system',
      userPromptTemplate: 'prev={{previous_summary}} msgs={{messages}}',
      previousSummary: longSummary,
      transcriptLabel: 'New messages',
    } as unknown as Parameters<typeof extractFromMessages>[0]);

    const promptWordCount = seenPrompt.split(/\s+/).filter(Boolean).length;
    expect(promptWordCount).toBeLessThan(560);
  });
});
