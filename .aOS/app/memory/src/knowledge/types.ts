// ============================================================================
// Atomic Fact Schema
// ============================================================================

export type FactCategory =
  | 'relationship'   // Connections between entities
  | 'milestone'      // Events, achievements, completions
  | 'status'         // Current state or role
  | 'preference'     // How someone/something operates
  | 'context'        // Background information
  | 'decision'       // Choice with rationale
  | 'lesson';        // Learned from experience

export interface AtomicFact {
  id: string;                    // Entity-scoped (e.g., "jane-003")
  fact: string;                  // 1-2 sentences, self-contained
  category: FactCategory;
  timestamp: string;             // When fact became true (YYYY-MM-DD or YYYY-MM-DDTHH:MM)
  source: string;                // Session UUID that produced this fact
  status: 'active' | 'superseded';
  supersededBy: string | null;   // ID of replacement (chain forward)
  relatedEntities: string[];     // PARA paths ("areas/people/jane")
  lastAccessed: string;          // ISO datetime (YYYY-MM-DDTHH:MM)
  accessCount: number;
  importance: 1 | 2 | 3;         // 1=routine, 2=significant, 3=critical
  mergedFrom?: string[];         // IDs of source facts when merged
}

// ============================================================================
// Entity Types
// ============================================================================

export type ParaBucket = 'projects' | 'areas' | 'resources' | 'archives' | 'people';

export const VALID_BUCKETS: readonly ParaBucket[] = ['projects', 'areas', 'resources', 'archives', 'people'] as const;

export const isValidBucket = (s: string): s is ParaBucket => VALID_BUCKETS.includes(s as ParaBucket);

export const VALID_CATEGORIES: readonly FactCategory[] = [
  'relationship', 'milestone', 'status', 'preference', 'context', 'decision', 'lesson',
] as const;

export const isValidCategory = (s: string): s is FactCategory =>
  VALID_CATEGORIES.includes(s as FactCategory);

export interface EntityMeta {
  path: string;                  // Relative to context root (e.g., "areas/people/jane")
  name: string;
  type: string;                  // person, company, project, topic, department, team
  bucket: ParaBucket;
  created: string;               // YYYY-MM-DD
  updated: string;               // YYYY-MM-DD
  tags: string[];
}

// ============================================================================
// Decay Tiers
// ============================================================================

export type DecayTier = 'hot' | 'warm' | 'cold';

export interface TieredFact extends AtomicFact {
  tier: DecayTier;
}

// ============================================================================
// Graph State
// ============================================================================

export interface GraphState {
  lastSummaryRefresh: string | null;  // ISO timestamp
  lastExtraction: string | null;      // ISO timestamp
  dirtyEntities: string[];            // PARA paths needing summary refresh
  consolidationFailures: number;
}

// ============================================================================
// Extraction Pipeline
// ============================================================================

export interface ExtractionResult {
  facts: Array<{
    entityPath: string;
    fact: Omit<AtomicFact, 'id' | 'lastAccessed' | 'accessCount'>;
  }>;
  newEntities: Array<{
    path: string;
    name: string;
    type: string;
    bucket: ParaBucket;
    tags: string[];
  }>;
  sessionSummary: string;
  decisions: string[];
  lessons: string[];
}
