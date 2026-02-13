# Memory CLI Architecture (v4.2)

## Overview

Memory CLI is a file-backed memory system with:
- PARA entity graph in `context/`
- working memory in `memory/MEMORY.md`
- append-only operational notes in `memory/daily-notes/`
- hybrid retrieval (keyword + vector)

## Storage Model

- `context/{projects,people,areas,resources,archives}/...`
- Entity files:
- `summary.md` for fast contextual read
- `items.json` for atomic facts
- Runtime state:
- `memory/data/session-state.json`
- `memory/data/graph-state.json`
- `memory/data/vectors.db`

## Session State (Schema v3)

`session-state.json` tracks per-session digest progress:

- `contentHash`
- `digestedAt`
- `digestedHash`
- `digestedMessageCount` (parsed user/assistant messages digested so far)
- `sessionSummary` (cumulative summary used as delta preamble)

Migration behavior:
- Older entries are normalized on load.
- Missing v3 fields default to `null`.

## Atomic Facts

Each fact stores:
- identity: `id`, `fact`, `category`
- lifecycle: `status`, `supersededBy`, optional `mergedFrom`
- retrieval signals: `importance` (1-3), `lastAccessed`, `accessCount`
- provenance: `source`, `timestamp`, `relatedEntities`

## Concurrency + Safety

### Atomic writes

All hot-path writes use `atomicWrite()`:
- `items.json`
- `summary.md`
- `daily-notes/*.md`
- `session-state.json`
- `graph-state.json`
- `MEMORY.md`

### Digest lock

Global digest lock is `memory/data/digest.lock` (JSON), with:
- owner PID
- `startedAt`
- heartbeat (`lastHeartbeat`)

Stale lock recovery only occurs when:
- owner PID is dead
- heartbeat age exceeds threshold

### State mutation

`mutateState(path, default, mutator)` provides:
- file-level advisory lock (`.lock` sidecar)
- read-modify-write under lock
- atomic persistence
- corrupt JSON fail-closed with `.corrupt-*` backup

## Pipeline Shape

Current pipeline stages:
1. mirror session logs
2. digest sessions via staged orchestrator (`extract` -> `consolidate` -> `apply`)
3. append daily notes
4. sync vectors
5. curate entity summaries + `MEMORY.md` (diff-input: changed entities + new notes)

Pipeline guardrails:
- lock only around apply + state writes
- per-run deadline budget (100s)
- parse fallback tracking (`consolidationFailures`)

### Delta extraction behavior

Extraction stage supports incremental digestion:
- full mode when no prior boundary (or force/stale boundary)
- delta mode when `digestedMessageCount < totalMessages`
- prior `sessionSummary` is supplied as context in delta mode
- extracted `sessionSummary` is persisted for next run

Reliability fallback:
- if mixed-role extraction returns zero facts, a single user-only retry is attempted

### Pipeline observability

Hook-driven runs emit three complementary telemetry layers:
- `memory/data/pipeline-runs.jsonl` (per-session orchestrator detail)
- `.aOS/logs/pipeline/events.jsonl` (lifecycle events across mirror/digest/vector/curate)
- `.aOS/logs/pipeline/hook-runs.jsonl` (one terminal summary per digest invocation)

Cross-process correlation:
- `session-mirror` writes per-run context files to `.aOS/logs/pipeline/inbox/`
- `session-digest` atomically claims a context from inbox and removes it at completion
- missing context falls back to `trigger=manual`

Status model:
- `success`
- `partial` (warnings/non-fatal stage errors)
- `skipped` (`run_lock_held|no_sessions|no_changes|all_locked`)
- `failed`

## Retrieval Architecture

Two primary retrieval paths:
1. known entity: `memory entity show <path>`
2. unknown/general: `memory recall "<query>"`

`memory recall` runs fusion search and expands:
- top entities with `summary.md`
- active facts (importance sorted)
- matching daily notes

`memory search` supports advanced flags:
- `--scope`
- `--min-score`
- `--category`
- `--expand`
- backend override: `--keyword`, `--vec`

## Vector Layer

- sqlite-vec (768 dims)
- WAL enabled
- `busy_timeout=5000`
- scope-aware vector filtering (`entities`, `notes`; facts excluded)

## Operational Commands

- `memory doctor` for integrity/staleness checks
- `memory alerts` for near-term milestones, neglected critical facts, stale entities
- `memory entity list --json` for rebuild manifests

## Rebuild Model (Phase 5)

Rebuild flow is staged, not direct-write:
1. export manifest (`entity list --json`)
2. archive old context by move
3. seed skeleton entities
4. orchestrate subagent swarm (`rebuild orchestrate`) to produce `memory/data/staging/*.json`
5. validate + consolidate + apply
6. vector sync + curate + doctor

Swarm orchestrator controls:
- max parallel agents (default 3)
- max `gog` calls per entity (default 10)
- retry limit (default 1)
- strict staging schema + provenance validation
