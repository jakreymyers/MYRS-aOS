---
name: memory
description: >
  Personal knowledge management system with PARA-structured entities,
  atomic facts, memory decay, and hybrid search. Use for recalling
  past decisions, tracking people/projects/companies, searching notes,
  and managing the knowledge graph.
license: MIT
compatibility: Requires memory CLI at .aOS/app/memory/
metadata:
  author: exa
  version: "3.3.0"
allowed-tools: Bash(memory:*)
---

# Memory Skill

## CLI Invocation

The `memory` wrapper is **not on PATH**. Always invoke via the wrapper's absolute path:

```bash
"$CLAUDE_PROJECT_DIR"/.aOS/app/memory/memory <command> [args]
```

All `memory` commands in this document use the short form for readability — **always expand to the full invocation when executing**.

## When to Use This Skill

**Proactive by default.** Don't wait for explicit recall requests — query memory whenever the conversation touches organizational context.

### Always query when you encounter:
- **A name** (person, company, team, project) → `entity show` or `search` to get role, status, relationships
- **A decision or commitment** ("what did we decide", "when did we agree") → search facts + daily notes
- **Business context** (vendor relationships, org structure, initiatives, goals) → search to ground your response
- **Cross-entity questions** ("who works with whom", "what projects involve X") → `entity graph` + search for connections

### Also use for:
- Tracking new people, projects, or decisions → `entity create` + `addFact`
- Answering "what's the status of..." → entity show for structured state
- Briefings and summaries → search across scopes, then synthesize

### Skip when:
- The answer is already in MEMORY.md (loaded every session)
- It's in the current conversation context
- The task is purely technical with no organizational dimension

## Retrieval Decision Framework

**Always start with the cheapest, fastest option and escalate only if needed.**

### Step 1: Do you know the entity path?

If yes → **direct lookup** (instant, precise):
```bash
memory entity show people/jane      # Full entity with tiered facts
memory entity graph people/jane     # Related entities
```

If you know the PARA bucket but not the exact entity:
```bash
memory entity list --bucket areas         # Browse entities in a bucket
memory entity list --bucket projects
```

### Step 2: Search (3 strategies, benchmarked)

| Strategy | Flag | MRR | Latency | Best for |
|----------|------|-----|---------|----------|
| Fusion (default) | (none) | 0.63 | ~72ms | General purpose — combines keyword + vector, 70/30 |
| Keyword | `--keyword` | 0.41 | ~27ms | Known terms, exact names, scoped searches |
| Vec (embedding) | `--vec` | **0.75** | ~67ms | Conceptual queries, paraphrase matching, relationships |

**Default strategy: Fusion (no flag needed).** It provides the best recall (R@10=0.88) for general queries. Use `--vec` when you need the highest precision for conceptual queries. Use `--keyword` for exact term lookups and scoped searches (`--scope`).

```bash
# Fusion search (default, best recall, ~72ms)
memory search "who manages finance"
memory search "organizational changes"

# Vector search (best quality, ~67ms)
memory search "team structure and reporting lines" --vec

# Keyword (fastest, ~27ms, supports --scope)
memory search "atlassian migration" --keyword
memory search "jane" --keyword --scope facts
memory search "budget review" --keyword --scope notes

# Options (all strategies)
memory search "query" --json              # Machine-readable output
memory search "query" -n 5               # Limit results
```

### Interpreting Results & Follow-Up

Search results return **snippets** (truncated lines) with source file paths. After getting results:

1. **Atomic facts** (`--scope facts`) — Return scored fact text + entity path. Usually self-contained enough to answer directly. If you need more context on the entity, run `memory entity show <path>`.
2. **Daily notes** (`--scope notes`) — Return truncated note text + file path (e.g., `daily-notes/2026-02-08.md`). **Read the full daily note file** at `memory/daily-notes/<date>.md` for complete session narratives. These files are small (typically <50 lines) so always read the full file.
3. **Entities** (`--scope entities`) — Return summary snippets + entity path. Use `memory entity show <path>` for the full entity with tiered facts.

**Multi-scope strategy**: When recalling a topic, search `--scope facts` and `--scope notes` in parallel. Facts give you the structured what; notes give you the narrative when/why. Combine both for a complete answer.

### When NOT to search

- **MEMORY.md is already in context** — it's loaded every session. Don't search for things that are in working memory.
- **Entity summaries for known paths** — use `entity show` instead of search.
- **Recent session context** — it's in your conversation history. Only search if it was from a *previous* session.

## Quick Reference

### Entity Management

```bash
memory entity list                        # All entities with fact counts + tiers
memory entity list --bucket areas         # Filter by PARA bucket
memory entity show people/jane      # View entity + tiered facts
memory entity create people/jane --type person --name "Jane Smith" --tags engineering,aps
memory entity archive projects/old-project  # Move to archives
memory entity graph people/jane     # Show related entities
```

### Search

```bash
# Fusion (default, best recall, ~72ms)
memory search "broad query"
memory search "conceptual question"

# Keyword (fastest, ~27ms, supports --scope)
memory search "exact terms" --keyword
memory search "query" --keyword --scope facts
memory search "query" --keyword --scope entities
memory search "query" --keyword --scope notes

# Vec (best quality, ~67ms)
memory search "conceptual question" --vec

# Options
memory search "query" --json              # Machine-readable output
memory search "query" -n 5               # Limit results
```

### Vector Index Management

```bash
memory vec sync [--force] [--verbose]    # Index summaries + notes into sqlite-vec
memory vec status                        # Show vector index stats
```

### Extraction & Maintenance

```bash
memory extract abc12345                   # Extract from specific session
memory extract --backfill                 # Process all sessions
memory curate                             # Refresh summaries + MEMORY.md
memory curate --summaries-only            # Only refresh dirty entity summaries
memory decay status                       # Show hot/warm/cold distribution
memory decay refresh                      # Rewrite dirty summaries
memory decay touch <entity> <fact-id>     # Mark fact as accessed
```

### Diagnostics

```bash
memory stats                              # Full system overview
memory stats --json                       # Machine-readable
memory benchmark                          # Run search quality benchmark
```

## Architecture

Three-layer memory:

| Layer | Location | What it stores | Loaded when |
|-------|----------|----------------|-------------|
| **Working Memory** | `memory/MEMORY.md` | Active context, decisions, focus | Every session (via CLAUDE.md) |
| **Knowledge Graph** | `context/{projects,people,areas,resources,archives}/` | Entities with atomic facts | On demand (entity show, search) |
| **Daily Notes** | `memory/daily-notes/` | Append-only session timeline | On demand (search) |

### Entity Structure

Each entity directory contains:
- `summary.md` — Hot + warm facts with YAML front matter (quick reference)
- `items.json` — Complete atomic fact history with decay metadata

### Vector Index

sqlite-vec database at `memory/data/vectors.db` indexes entity summaries and daily notes using embeddinggemma-300M (768 dims). Run `memory vec sync` after adding entities to update. Incremental sync only re-embeds changed content.

### Memory Decay

| Tier | Window | In summary.md? | Searchable? |
|------|--------|-----------------|-------------|
| Hot | 0-7 days since access | Yes (Current section) | Yes |
| Warm | 8-30 days | Yes (Recent section) | Yes |
| Cold | 30+ days | No | Yes (via search) |

Frequently accessed facts (10+ accesses) get a 14-day bonus to their tier window.

### PARA Buckets

| Bucket | Use for | Examples |
|--------|---------|---------|
| `projects/` | Active work with end dates | memory-v3, q1-budget-review |
| `people/` | Person entities | mark-doyle, jessica-stepnoski |
| `areas/` | Ongoing responsibilities | companies/, departments/, teams/ |
| `resources/` | Topics of interest | typescript, react, api-design |
| `archives/` | Completed/inactive items | old projects, former contacts |

## How It Works (Background)

You don't need to run these — hooks handle them automatically:

1. **SessionEnd** → `session-mirror` + `session-digest` (extract facts via Haiku, sync vector index)
2. **SessionStart** → `session-mirror` + `session-check` (detect stale summaries)
3. **Curate** → refresh dirty entity summaries + regenerate MEMORY.md

If `session-check` warns about stale summaries, run `memory curate --summaries-only`.
