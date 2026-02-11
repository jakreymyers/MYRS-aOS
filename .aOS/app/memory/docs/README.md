# Memory CLI

A local, structured memory store with hybrid search (SQLite FTS5 + QMD). Designed for fast capture, retrieval, and file-backed indexing of markdown content plus session-driven daily reports.

## Installation

From the memory directory:

```bash
bun install
```

Optional: add the `memory` wrapper to your PATH.

## Quick Start

```bash
./memory add "I prefer dark roast coffee" --type preference -i 7 --tags "coffee,preference"
./memory search "coffee"
./memory log "Reviewed memory CLI"
./memory index
./memory session-sync --force
./memory watch
```

## Commands

### Search

```bash
memory search "query"                       # Hybrid search (QMD)
memory search "query" --keyword             # FTS5 only
memory search "query" --semantic            # QMD vector only
memory search "query" -n 20                 # Limit results
memory search "query" --min-score 0.5       # Score threshold
memory search "query" --type fact           # Filter by entry type
memory search "query" --json                # JSON output
```

### Add

```bash
memory add "content"                        # Add as fact
memory add "content" --type preference      # Specify type
memory add "content" -i 8                   # Set importance (1-10)
memory add "content" --tags "tag1,tag2"     # Add tags
memory add "content" --context "why"        # Add context
```

### Log

```bash
memory log "event description"              # Log event
memory log "error occurred" --type error    # Log with type
```

### Export

```bash
memory export                               # Export all as JSON
memory export --format markdown             # Export as markdown
memory export --type fact                   # Filter by type
memory export --since 2024-01-01            # Filter by date
memory export -o output.json                # Write to file
```

### Index

```bash
memory index                                # Index memory + context roots
memory index ~/notes                        # Index specific path
memory index --status                       # Show index status
memory index --force                        # Force reindex all
```

### Session + Flush

```bash
memory session-sync                         # Summarize session logs into daily reports
memory session-start                        # Trigger session start sync
memory session-end                          # Trigger session end sync
memory session-log <user|assistant> <text>  # Append JSONL session entry
memory flush                                # Pre-compaction memory flush
```

Hook script (for session end integration):

```bash
.aOS/app/memory/hooks/session-end.sh
```

### Watch

```bash
memory watch                                # Watch memory/context/session logs and auto-sync
```

### Stats and Get

```bash
memory stats                                # Show memory stats
memory get <id>                             # Get entry by ID
```

## Daily Reports

Session logs are summarized into daily reports at:

- `memory/daily-reports/YYYY-MM-DD.md`

These reports use a flexible template designed for broad knowledge work and retrieval.

## QMD Integration

Memory search uses QMD for hybrid and semantic search when available. If QMD is not installed, the CLI falls back to SQLite FTS5 keyword search.

QMD sync behavior:

- `memory index`, `memory session-sync`, and `memory watch` will attempt to run `qmd update` (and `qmd embed` by default).
- Collections `memory-root` and `context-root` are ensured automatically.

Environment variables:

- `QMD_BIN`: path to the qmd binary (default: `qmd`)
- `QMD_COLLECTION`: restrict search to a specific QMD collection
- `QMD_TIMEOUT_MS`: timeout for qmd queries (default: 5000)
- `QMD_AUTO_SYNC`: set to `0` to disable automatic QMD sync
- `QMD_EMBED_ON_SYNC`: set to `0` to skip `qmd embed`

## Configuration

Environment variables:

- `CLAUDE_CODE_LOG_DIR`: source Claude Code session logs
- `SESSION_LOG_DIR`: canonical session log store (default: `.aOS/logs/sessions`)
- `MEMORY_ROOT`: override memory root (default: `memory/`)
- `CONTEXT_ROOT`: override context root (default: `context/`)
- `SESSION_LOG_DIR`: session logs directory (default: `.aOS/logs/sessions`)
- `MEMORY_INDEX_PATHS`: extra index roots, comma-separated
- `CLAUDE_MODEL`: Claude model for daily report summaries
- `ANTHROPIC_API_KEY`: API key for Claude SDK
- `MEMORY_EMBEDDINGS_PRIMARY`: primary embedding provider (default `openai`)
- `MEMORY_EMBEDDINGS_FALLBACK`: fallback provider (default `gemini`)
