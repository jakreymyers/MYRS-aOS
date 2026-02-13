# Memory CLI Testing Guide

This document describes the memory test suite, how to run it, and what each test file validates.

## Run Commands

From `.aOS/app/memory`:

```bash
bun run typecheck
bun test
```

Focused runs:

```bash
bun test tests/pipeline/orchestrate.test.ts
bun test tests/cli/digest.test.ts
bun test tests/rebuild/swarm-orchestrator.test.ts
```

## Test Environment Notes

- Test runner: `bun test`.
- Type checking: `tsc --noEmit` via `bun run typecheck`.
- Vector tests (`tests/vector/*.test.ts`) use `node-llama-cpp` embeddings.
  - If the embedding model is unavailable locally, vector semantic tests are skipped by design.
- Most tests use temporary directories and set `CONTEXT_ROOT` / `MEMORY_ROOT` explicitly.

## Suite Map

### Unit (`tests/unit`)

- `tests/unit/atomic.test.ts`: verifies atomic write behavior and temp file cleanup.
- `tests/unit/hashing.test.ts`: validates deterministic content hashing format.
- `tests/unit/lock.test.ts`: validates lock ownership, stale recovery, heartbeat, and release behavior.
- `tests/unit/state-mutate.test.ts`: validates `mutateState` defaulting, concurrency safety, and corrupt-state fail-closed behavior.

### Session (`tests/session`)

- `tests/session/logger.test.ts`: validates native session log mirroring/parsing into normalized session files.
- `tests/session/parser.test.ts`: validates parsing of supported session message shapes and role filtering.
- `tests/session/state.test.ts`: validates session-state pruning for deleted/missing logs.

### Knowledge (`tests/knowledge`)

- `tests/knowledge/types.test.ts`: validates v4.2 category support (`decision`, `lesson`).
- `tests/knowledge/facts.test.ts`: validates fact CRUD, ID generation, supersession, access tracking, category filters, and dirty-mark side effects.
- `tests/knowledge/state.test.ts`: validates graph-state load/save, dirty tracking, and refresh timestamp behavior.
- `tests/knowledge/extract.test.ts`: validates extraction response parsing, path/category normalization, and decisions/lessons capture.
- `tests/knowledge/consolidate.test.ts`: validates consolidation parsing invariants, fallback behavior, and fact prefiltering.
- `tests/knowledge/apply.test.ts`: validates apply semantics for `create/merge/supersede/drop` and provenance handling.
- `tests/knowledge/decay.test.ts`: validates tiering math including importance/access bonuses and superseded handling.
- `tests/knowledge/daily-notes.test.ts`: validates daily note upsert/append formatting and decisions/lessons sections.
- `tests/knowledge/entities.test.ts`: validates entity lifecycle operations (create/list/get/move/exists).
- `tests/knowledge/summarize.test.ts`: validates structured and LLM summary generation behavior.

### Search (`tests/search`)

- `tests/search/native.test.ts`: validates keyword search scopes, sorting, category filters, limits, and superseded exclusion.
- `tests/search/fusion.test.ts`: validates fusion score thresholding, scope/category pass-through, and weight edge cases.

### Pipeline (`tests/pipeline`)

- `tests/pipeline/extract-stage.test.ts`: validates delta boundary slicing, stale-boundary full fallback, and zero-fact user-only retry behavior.
- `tests/pipeline/orchestrate.test.ts`: validates staged pipeline orchestration, idempotency, fallback accounting, delta summary persistence, and minimal session-state schema.
- `tests/pipeline/recovery.test.ts`: validates crash/retry idempotency and no-duplicate recovery guarantees.
- `tests/pipeline/observability.test.ts`: validates run-context claim flow and JSONL append contracts for events/summaries.

### CLI (`tests/cli`)

- `tests/cli/digest.test.ts`: validates digest CLI arg parsing, lock behavior, and orchestration wiring.
- `tests/cli/mirror.test.ts`: validates mirror hook-input parsing and run-context/event emission.
- `tests/cli/curate.test.ts`: validates diff-based curate inputs and skip behavior when no diffs exist.
- `tests/cli/consolidate.test.ts`: validates consolidate CLI argument validation.
- `tests/cli/recall.test.ts`: validates recall CLI JSON output contract.
- `tests/cli/doctor.test.ts`: validates doctor diagnostics for corruption/staleness scenarios.
- `tests/cli/alerts.test.ts`: validates alerts detection logic for milestones/stale-critical facts.
- `tests/cli/check.test.ts`: validates session-check startup diagnostics and staleness checks.
- `tests/cli/entity-cmd.test.ts`: validates `entity list --json` manifest schema contract.
- `tests/cli/rebuild.test.ts`: validates rebuild subcommands (`manifest-diff`, `validate-staging`, `provenance`, `orchestrate`).

### Rebuild (`tests/rebuild`)

- `tests/rebuild/staging-schema.test.ts`: validates staged payload schema and provenance requirements.
- `tests/rebuild/manifest-diff.test.ts`: validates pre/post manifest diff correctness.
- `tests/rebuild/provenance.test.ts`: validates provenance coverage reporting.
- `tests/rebuild/swarm-orchestrator.test.ts`: validates orchestration concurrency, retry behavior, and budget/error accounting.
- `tests/rebuild/gog-agent-runner.test.ts`: validates Google-workspace agent fact quality filters, iterative traversal behavior, and fallback extraction.

### Vector (`tests/vector`)

- `tests/vector/db.test.ts`: validates sqlite-vec schema, CRUD, stats, and nearest-neighbor behavior.
- `tests/vector/sync.test.ts`: validates incremental/force sync, content-change detection, and orphan cleanup.
- `tests/vector/search.test.ts`: validates semantic retrieval quality, scoring bounds, and limits.

### Helpers

- `tests/helpers/fixtures.ts`: shared fixture data for tests; not a standalone test file.

## Practical Test Workflow

1. Run `bun run typecheck`.
2. Run focused tests for the changed area.
3. Run full `bun test` before commit.
4. For retrieval/vector changes, also run both:
   - `bun test tests/search/*.test.ts`
   - `bun test tests/vector/*.test.ts`
