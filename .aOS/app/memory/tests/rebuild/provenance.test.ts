import { describe, expect, test } from 'bun:test';
import { computeProvenanceCoverage } from '../../src/rebuild/provenance';
import type { StagedEntityPayload } from '../../src/rebuild/staging';

describe('rebuild provenance coverage', () => {
  test('returns 100% when all staged facts have complete provenance', () => {
    const payloads: Array<Partial<StagedEntityPayload>> = [
      {
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
              sourceId: 'm-1',
              sourceDate: '2026-02-12T09:00:00Z',
            },
          },
        ],
      },
    ];

    const coverage = computeProvenanceCoverage(payloads);
    expect(coverage.totalFacts).toBe(1);
    expect(coverage.withProvenance).toBe(1);
    expect(coverage.percent).toBe(100);
  });

  test('counts staged facts with incomplete provenance as uncovered', () => {
    const payloads: Array<Partial<StagedEntityPayload>> = [
      {
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
              sourceDate: '2026-02-12T09:00:00Z',
            },
          },
          {
            fact: 'Jane reports to Jak',
            category: 'relationship',
            importance: 2,
            timestamp: '2026-02-12T09:00',
            relatedEntities: [],
            provenance: {
              sourceType: 'contacts',
              sourceId: 'c-1',
              sourceDate: '2026-02-12T09:00:00Z',
            },
          },
        ],
      },
    ];

    const coverage = computeProvenanceCoverage(payloads);
    expect(coverage.totalFacts).toBe(2);
    expect(coverage.withProvenance).toBe(1);
    expect(coverage.percent).toBe(50);
  });
});
