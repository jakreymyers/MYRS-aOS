# Memory CLI Architecture

## Overview

Memory CLI is a local knowledge store combining native keyword search with sqlite-vec vector embeddings for fusion search. It manages a PARA-structured knowledge graph with atomic facts, memory decay, and session-based extraction.

## Data Flow

1. **Extract**: `memory session-digest` reads session JSONL logs and extracts atomic facts via Haiku into entity `items.json` files.
2. **Index**: `memory vec sync` embeds entity summaries and daily notes into sqlite-vec for vector search.
3. **Search**: `memory search` runs one of three strategies:
   - Fusion (default): keyword + sqlite-vec weighted merge (70/30)
   - Keyword: native TF-IDF scoring over entities, facts, and daily notes
   - Vec: sqlite-vec kNN embedding search
4. **Curate**: `memory curate` regenerates entity `summary.md` files from hot+warm facts and updates `MEMORY.md`.
5. **Decay**: Facts age through hot (7d) → warm (30d) → cold tiers, with frequency bonuses for accessed facts.

## Knowledge Graph Structure

- `context/{projects,people,areas,resources,archives}/` — PARA entity directories
- Each entity: `summary.md` (auto-generated) + `items.json` (atomic facts with decay metadata)
- Entity operations: create, archive, list, show, graph (relationships)

## Search Architecture

### Fusion Search (default)
Combines native keyword TF-IDF scores with sqlite-vec cosine similarity:
- Keyword results: weighted at 0.3 (text weight)
- Vector results: weighted at 0.7 (vector weight)
- Rank fusion merges both result sets by normalized score

### Vector Backend
- sqlite-vec with 768-dimensional cosine embeddings
- embeddinggemma-300M model via node-llama-cpp (in-process, no subprocess)
- Database: `memory/data/vectors.db`
- Index scope: entity summaries + daily notes (not items.json facts)
- Incremental sync via content hash tracking

### Keyword Backend
- Native TF-IDF scoring over markdown files
- Walks entity items.json and summary.md files sequentially
- Supports scope filtering: entities, facts, notes

## Session Pipeline

1. **Mirror**: Copy session JSONL from Claude Code log dir to canonical location
2. **Digest**: Extract facts from session logs via Haiku → store in entities → append to daily notes → sync vector index
3. **Check**: Lightweight state check at session start (stale locks, undigested sessions, dirty summaries)

## Error Handling

All operations return `Result<T>` with `success`/`error` status. CLI commands translate failures into non-zero exit codes and human-readable errors.
