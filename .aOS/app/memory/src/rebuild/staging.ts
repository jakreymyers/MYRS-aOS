import { isValidBucket, isValidCategory, type FactCategory } from '../knowledge/types';

export type RebuildSourceType = 'gmail' | 'calendar' | 'drive' | 'contacts';

export interface StagedProvenance {
  sourceType: RebuildSourceType;
  sourceId: string;
  sourceDate: string;
}

export interface StagedFactCandidate {
  fact: string;
  category: FactCategory;
  importance: 1 | 2 | 3;
  timestamp: string;
  relatedEntities: string[];
  provenance: StagedProvenance;
}

export interface StagedEntityPayload {
  entityPath: string;
  facts: StagedFactCandidate[];
  generatedAt: string;
  generatedBy: string;
}

export interface StagingValidationResult {
  valid: boolean;
  errors: string[];
}

const KEBAB_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_TYPES: readonly RebuildSourceType[] = ['gmail', 'calendar', 'drive', 'contacts'] as const;

const isValidEntityPath = (path: string): boolean => {
  const parts = path.split('/');
  if (parts.length < 2 || parts.length > 3) return false;
  if (parts.some((part) => part.length === 0)) return false;
  if (!isValidBucket(parts[0] ?? '')) return false;
  if (!parts.slice(1).every((part) => KEBAB_SEGMENT.test(part))) return false;
  if (parts[0] === 'people' && parts.length !== 2) return false;
  if (parts[0] === 'areas' && parts[1] === 'people') return false;
  return true;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const hasCompleteProvenance = (fact: Partial<StagedFactCandidate> | null | undefined): boolean => {
  if (!fact?.provenance) return false;
  return SOURCE_TYPES.includes(fact.provenance.sourceType as RebuildSourceType)
    && isNonEmptyString(fact.provenance.sourceId)
    && isNonEmptyString(fact.provenance.sourceDate);
};

export const validateStagingPayload = (payload: unknown): StagingValidationResult => {
  const errors: string[] = [];
  const row = payload as Partial<StagedEntityPayload> | null | undefined;

  if (!row || typeof row !== 'object') {
    return { valid: false, errors: ['payload must be an object'] };
  }

  if (!isNonEmptyString(row.entityPath) || !isValidEntityPath(row.entityPath)) {
    errors.push('entityPath must be a valid PARA path');
  }

  if (!Array.isArray(row.facts)) {
    errors.push('facts must be an array');
  } else {
    for (let i = 0; i < row.facts.length; i++) {
      const fact = row.facts[i] as Partial<StagedFactCandidate> | null | undefined;
      if (!fact || typeof fact !== 'object') {
        errors.push(`facts[${i}] must be an object`);
        continue;
      }
      if (!isNonEmptyString(fact.fact)) errors.push(`facts[${i}].fact is required`);
      if (!isValidCategory(fact.category ?? '')) errors.push(`facts[${i}].category is invalid`);
      if (!(fact.importance === 1 || fact.importance === 2 || fact.importance === 3)) {
        errors.push(`facts[${i}].importance must be 1|2|3`);
      }
      if (!isNonEmptyString(fact.timestamp)) errors.push(`facts[${i}].timestamp is required`);
      if (!Array.isArray(fact.relatedEntities)) errors.push(`facts[${i}].relatedEntities must be an array`);
      if (!hasCompleteProvenance(fact)) errors.push(`facts[${i}].provenance is incomplete`);
    }
  }

  if (!isNonEmptyString(row.generatedAt)) {
    errors.push('generatedAt is required');
  }
  if (!isNonEmptyString(row.generatedBy)) {
    errors.push('generatedBy is required');
  }

  return { valid: errors.length === 0, errors };
};
