# Memory Pipeline Observability

## Purpose

This document defines how to observe and debug the hook-driven memory pipeline:

`SessionStart|SessionEnd|PreCompact -> session-mirror -> session-digest -> vector sync -> curate`

Primary operator goals:

1. Identify what triggered a run.
2. Reconstruct stage order and timing.
3. Distinguish success vs partial vs skipped vs failed.
4. Explain lock contention and no-op behavior without reading code.

## Pipeline Sequence

1. Hook fires and runs: `memory session-mirror && memory session-digest` (async in Claude settings).
2. `session-mirror` parses hook stdin (`session_id`, `hook_event_name`), mirrors the session log, and writes a run context file.
3. `session-digest` claims one run context, acquires digest run lock, processes session files, syncs vectors, and conditionally runs curate.
4. Digest emits terminal summary entry (including skip/partial/failure states).

## Log Files

| File | Path | Granularity | Notes |
|---|---|---|---|
| Session pipeline log (existing) | `memory/data/pipeline-runs.jsonl` | Per session file | Stage-level extract/consolidate/apply diagnostics from orchestrator |
| Hook run summaries | `.aOS/logs/pipeline/hook-runs.jsonl` | Per digest invocation | Operator-first status/timing summary |
| Lifecycle events | `.aOS/logs/pipeline/events.jsonl` | Per event | Timeline events for mirror/digest/vector/curate |
| Pending context inbox | `.aOS/logs/pipeline/inbox/*.json` | Per mirror invocation | Cross-process handoff from mirror to digest |
| Claimed context files | `.aOS/logs/pipeline/claimed/*.json` | Per claimed context | Removed at digest completion (best effort) |

## Retention and Cleanup

- Default retention is 30 days.
- Default per-file size cap is 5 MB for active log files.
- Active files (`events.jsonl`, `hook-runs.jsonl`) are rotated when:
  - appending the next line would exceed size cap, or
  - the file age exceeds retention window.
- Rotated files are named with timestamp + pid suffix, e.g. `events.2026-02-12T15-30-12-123Z-12345.jsonl`.
- Rotated files older than retention are deleted during append operations.
- Context files in `inbox/` older than 5 minutes are treated as stale and deleted during claim.
- Claimed context files are deleted when digest finalizes.

Environment overrides:

- `MEMORY_OBSERVABILITY_RETENTION_DAYS` (default `30`)
- `MEMORY_OBSERVABILITY_MAX_FILE_BYTES` (default `5242880`)

## Schema Contracts

Source of truth:

- `.aOS/app/memory/src/pipeline/observability.ts`

Key types:

- `PipelineRunContext`
- `PipelineEvent`
- `HookRunSummary`
- `RunStatus` (`success|partial|skipped|failed`)
- `SkipReason` (`run_lock_held|no_sessions|no_changes|all_locked|null`)

Guardrail:

- Do not log raw prompt/session content in observability events/summaries.

## Event Taxonomy

- `mirror.start`
- `mirror.end`
- `digest.start`
- `digest.stage.end`
  - `scan_sessions`
  - `digest_sessions`
  - `vector_sync`
  - `curate`
- `digest.skip`
- `digest.error`
- `digest.end`

## Lock Model

Two locks exist and mean different things:

1. `memory/data/digest-run.lock`
   - Global digest process lock.
   - If held, digest exits with `status=skipped` and `skipReason=run_lock_held`.

2. `memory/data/digest.lock`
   - Pipeline apply/state critical section lock (inside orchestrator).
   - Session-level lock outcomes surface as `sessionsLocked` counts and may produce `skipReason=all_locked` when no sessions can apply.

## Troubleshooting Playbook

Recent summaries:

```bash
tail -n 20 .aOS/logs/pipeline/hook-runs.jsonl | jq .
```

Recent events:

```bash
tail -n 50 .aOS/logs/pipeline/events.jsonl | jq .
```

Filter skipped runs:

```bash
jq -c 'select(.status=="skipped")' .aOS/logs/pipeline/hook-runs.jsonl
```

Filter partial/failed runs:

```bash
jq -c 'select(.status=="partial" or .status=="failed")' .aOS/logs/pipeline/hook-runs.jsonl
```

Correlate one run:

```bash
RUN_ID="<run-id>"
jq -c --arg id "$RUN_ID" 'select(.runId==$id)' .aOS/logs/pipeline/events.jsonl
jq -c --arg id "$RUN_ID" 'select(.runId==$id)' .aOS/logs/pipeline/hook-runs.jsonl
```

## Failure Mode Matrix

| Scenario | Summary status | Skip reason | Key signal |
|---|---|---|---|
| Run lock already held | `skipped` | `run_lock_held` | `digest.skip` event |
| No session files | `skipped` | `no_sessions` | `sessionsScanned=0` |
| All sessions unchanged | `skipped` | `no_changes` | `sessionsProcessed=0`, `sessionsLocked=0` |
| All sessions locked in apply path | `skipped` | `all_locked` | `sessionsProcessed=0`, `sessionsLocked>0` |
| Vector sync warning | `partial` | `null` | `vectorSync.error` populated |
| Curate warning | `partial` | `null` | `curate.error` populated |
| Fatal digest error | `failed` | `null` | `digest.error` event + summary `errors[]` |

## Extending Observability

When adding a pipeline stage:

1. Emit `digest.stage.end` with bounded `meta`.
2. Add stage counters/timing to `HookRunSummary`.
3. Add/adjust tests in:
   - `tests/pipeline/observability.test.ts`
   - `tests/cli/digest.test.ts`
4. Update this file and `docs/API.md`.
