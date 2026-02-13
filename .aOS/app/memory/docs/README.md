# Memory CLI

## What It Is

Memory CLI is the agent memory subsystem for agentic-os:
- persistent working memory (`memory/MEMORY.md`)
- structured entity graph (`context/`)
- session-derived daily notes (`memory/daily-notes/`)
- hybrid retrieval (keyword + vector)

## Quickstart

```bash
cd .aOS/app/memory
bun install

# session lifecycle
./memory session-mirror
./memory session-digest
./memory curate

# retrieval
./memory recall "daniel berger data platform"
./memory search "platform decision" --category decision --scope facts

# operations
./memory doctor --json
./memory alerts --json
```

## Operator Workflow

1. Mirror logs: `memory session-mirror`
2. Digest sessions: `memory session-digest`
3. Refresh summaries + working memory: `memory curate`
4. Validate health: `memory doctor`

## Command Families

- Session: `session-mirror`, `session-digest`, `session-check`
- Retrieval: `recall`, `search`, `entity show`, `entity graph`
- Graph maintenance: `entity create`, `entity archive`, `consolidate`
- Vector: `vec sync`, `vec status`
- Rebuild helpers: `rebuild manifest-diff`, `rebuild validate-staging`, `rebuild provenance`, `rebuild orchestrate`
- Ops: `doctor`, `alerts`, `stats`

## Testing

Detailed test suite coverage and execution guidance:
- `docs/TESTING.md`

## Observability

Pipeline observability design, schemas, events, and operator playbook:
- `docs/OBSERVABILITY.md`

## Upgrade Notes (v4.2)

- PID heartbeat lock replaces mkdir lock.
- State mutation now uses advisory-locked `mutateState`.
- Fact model adds `importance`, `decision`, `lesson`, optional `mergedFrom`.
- `memory recall` is now the primary retrieval interface.
- `memory entity list --json` provides rebuild manifest contract.
- `memory session-digest --full` removed (auto-change detection now default).
- Session extraction now runs in delta mode using `digestedMessageCount` + `sessionSummary` (schema v3).
- Zero-fact extraction from mixed user/assistant slices triggers one user-only retry for reliability.
- `memory curate` now builds prompts from changed entities + new notes (diff-based).

## Troubleshooting

### 1. Suspect corruption

Run:
```bash
memory doctor --json
```

Look for:
- `MALFORMED_ITEMS_JSON`
- `STALE_DIGEST_LOCK`
- `ORPHAN_TMP_FILE`
- `GRAPH_DIRTY_ENTITY_MISSING`
- `VECTOR_INDEX_STALE`

### 2. Retrieval quality regression

Run:
```bash
memory search "query" --keyword
memory search "query" --vec
memory recall "query" --json
```

Check:
- scope behavior (`--scope`)
- threshold behavior (`--min-score`)
- category filtering (`--category`)

### 3. Stale memory context

Run:
```bash
memory curate
memory alerts --json
```

## Rebuild Prep

For graph rebuild workflows:
```bash
memory entity list --json > workspace/projects/agentic-os/data/entity-manifest.json
MEMORY_SWARM_AGENT_CMD="codex-agent --headless" memory rebuild orchestrate --manifest workspace/projects/agentic-os/data/entity-manifest.json --staging-dir memory/data/staging --json
```

Use staged ingestion + consolidation (do not direct-write facts).
