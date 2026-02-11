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
});
