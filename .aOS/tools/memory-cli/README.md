# Memory CLI

A local, structured knowledge store with fusion search (native keyword + sqlite-vec vector). Designed for fast capture, retrieval, and file-backed indexing of markdown content plus session-driven fact extraction.

## Installation

From the memory-cli directory:

```bash
bun install
```

## Quick Start

```bash
./memory search "coffee preference"
./memory entity list
./memory entity show people/jane
./memory stats
```

## Commands

### Search

```bash
memory search "query"                       # Fusion search (keyword + vector, default)
memory search "query" --keyword             # Keyword only
memory search "query" --vec                 # Vector embedding only
memory search "query" --scope facts         # Scope to atomic facts
memory search "query" --scope entities      # Scope to entity summaries
memory search "query" --scope notes         # Scope to daily notes
memory search "query" -n 20                 # Limit results
memory search "query" --min-score 0.5       # Score threshold
memory search "query" --json                # JSON output
```

### Entity Management

```bash
memory entity list                          # List all entities
memory entity list --bucket areas           # Filter by PARA bucket
memory entity show people/jane              # View entity + tiered facts
memory entity create people/jane            # Create new entity
memory entity archive projects/old          # Move to archives
memory entity graph people/jane             # Show related entities
```

### Extraction

```bash
memory extract abc12345                     # Extract from specific session
memory extract --backfill                   # Process all sessions
```

### Maintenance

```bash
memory curate                               # Refresh summaries + MEMORY.md
memory curate --summaries-only              # Only refresh dirty summaries
memory decay status                         # Show tier distribution
memory decay refresh                        # Rewrite dirty summaries
memory decay touch <entity> <fact-id>       # Mark fact as accessed
```

### Vector Index

```bash
memory vec sync [--force]                   # Index summaries + notes into sqlite-vec
memory vec status                           # Show vector index stats
```

### Session Commands

```bash
memory session-mirror                       # Mirror current session log
memory session-digest [--force]             # Extract facts from session logs
memory session-check                        # Check state at session start
```

### Diagnostics

```bash
memory stats                                # Show memory stats
memory stats --json                         # Machine-readable
memory benchmark                            # Run search quality benchmark
```

## Daily Notes

Session logs are extracted into atomic facts and appended to daily notes at:

- `/Users/jak/agentic-os/memory/daily-notes/YYYY-MM-DD.md`

## Configuration

Environment variables:

- `CLAUDE_CODE_LOG_DIR`: source Claude Code session logs (default: `~/.claude/projects/-Users-jak-agentic-os`)
- `SESSION_LOG_DIR`: canonical session log store (default: `/Users/jak/agentic-os/.aOS/logs/sessions`)
- `MEMORY_ROOT`: override memory root (default: `/Users/jak/agentic-os/memory`)
- `CONTEXT_ROOT`: override context root (default: `/Users/jak/agentic-os/context`)
- `CLAUDE_MODEL`: Claude model for extraction/curation
- `ANTHROPIC_API_KEY`: API key for Claude SDK
