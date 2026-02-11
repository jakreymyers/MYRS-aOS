// Re-export knowledge graph types
export type {
  AtomicFact,
  FactCategory,
  EntityMeta,
  ParaBucket,
  DecayTier,
  TieredFact,
  GraphState,
  ExtractionResult,
} from './knowledge/types';

// ============================================================================
// Session State (replaces SQLite session_state table)
// ============================================================================

export interface SessionStateEntry {
  path: string;
  contentHash: string;
  size: number;
  mtime: number;
  messageCount: number;
  digestedAt: string | null; // ISO timestamp of last digest, null if never digested
}

export interface SessionStateFile {
  sessions: Record<string, SessionStateEntry>; // keyed by file path
  lastDigest: string | null; // ISO timestamp
  lastCurate: string | null; // ISO timestamp
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  content: string;
  snippet: string;
  score: number;
  file?: string;
  startLine?: number;
  endLine?: number;
}

// ============================================================================
// Session Messages (from logs.ts)
// ============================================================================

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  sessionId?: string;
}

// ============================================================================
// Operation Results
// ============================================================================

export type Result<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; code?: string };
