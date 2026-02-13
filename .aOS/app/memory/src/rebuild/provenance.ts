import { hasCompleteProvenance, type StagedEntityPayload } from './staging';

export interface ProvenanceCoverage {
  totalFacts: number;
  withProvenance: number;
  percent: number;
}

export const computeProvenanceCoverage = (
  payloads: Array<Partial<StagedEntityPayload> | null | undefined>,
): ProvenanceCoverage => {
  let totalFacts = 0;
  let withProvenance = 0;

  for (const payload of payloads) {
    const facts = Array.isArray(payload?.facts) ? payload.facts : [];
    totalFacts += facts.length;
    withProvenance += facts.filter((fact) => hasCompleteProvenance(fact)).length;
  }

  const percent = totalFacts === 0
    ? 100
    : Math.round((withProvenance / totalFacts) * 10000) / 100;

  return { totalFacts, withProvenance, percent };
};
