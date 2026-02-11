// ============================================================================
// Atomic Fact Schema
// ============================================================================

export type FactCategory =
  | 'relationship'   // Connections between entities
  | 'milestone'      // Events, achievements, completions
  | 'status'         // Current state or role
  | 'preference'     // How someone/something operates
  | 'context';       // Background information

export interface AtomicFact {
  id: string;                    // Entity-scoped (e.g., "jane-003")
  fact: string;                  // 1-2 sentences, self-contained
  category: FactCategory;
  timestamp: string;             // YYYY-MM-DD when fact became true
  source: string;                // Daily note date where learned
  status: 'active' | 'superseded';
  supersededBy: string | null;   // ID of replacement (chain forward)
  relatedEntities: string[];     // PARA paths ("areas/people/jane")
  lastAccessed: string;          // YYYY-MM-DD
  accessCount: number;
}

// ============================================================================
// Entity Types
// ============================================================================

export type ParaBucket = 'projects' | 'areas' | 'resources' | 'archives' | 'people';

export const VALID_BUCKETS: readonly ParaBucket[] = ['projects', 'areas', 'resources', 'archives', 'people'] as const;

export const isValidBucket = (s: string): s is ParaBucket => VALID_BUCKETS.includes(s as ParaBucket);

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
  entityStats: {
    total: number;
    projects: number;
    areas: number;
    resources: number;
    archives: number;
    people: number;
  };
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
}
