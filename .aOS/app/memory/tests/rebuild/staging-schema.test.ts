import { describe, expect, test } from 'bun:test';
import { validateStagingPayload } from '../../src/rebuild/staging';

describe('rebuild staging schema', () => {
  test('accepts valid staged payload with provenance', () => {
    const payload = {
      entityPath: 'people/jane',
      facts: [
        {
          fact: 'Jane leads platform engineering',
          category: 'status',
          importance: 2,
          timestamp: '2026-02-12T09:00',
          relatedEntities: ['projects/platform'],
          provenance: {
            sourceType: 'gmail',
            sourceId: 'msg-123',
            sourceDate: '2026-02-11T15:00:00Z',
          },
        },
      ],
      generatedAt: '2026-02-12T20:00:00Z',
      generatedBy: 'people-swarm',
    };

    const result = validateStagingPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects facts missing provenance fields', () => {
    const payload = {
      entityPath: 'people/jane',
      facts: [
        {
          fact: 'Jane leads platform engineering',
          category: 'status',
          importance: 2,
          timestamp: '2026-02-12T09:00',
          relatedEntities: [],
          provenance: {
            sourceType: 'gmail',
            sourceId: '',
            sourceDate: '',
          },
        },
      ],
      generatedAt: '2026-02-12T20:00:00Z',
      generatedBy: 'people-swarm',
    };

    const result = validateStagingPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('provenance'))).toBe(true);
  });

  test('rejects invalid entity paths', () => {
    const payload = {
      entityPath: 'workspace/people/jane',
      facts: [],
      generatedAt: '2026-02-12T20:00:00Z',
      generatedBy: 'people-swarm',
    };

    const result = validateStagingPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('entityPath'))).toBe(true);
  });
});
