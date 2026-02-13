# Memory CLI API (v4.2)

## Core Commands

### `memory recall <query>`

Primary retrieval command (fusion + expansion).

Options:
- `--json`
- `-n <limit>` (default 3, max 5 expanded entities)
- `--category <type>`

JSON contract:
```ts
interface RecallResult {
  query: string;
  resultCount: number;
  entities: Array<{
    path: string;
    name: string;
    score: number;
    summary: string;
    facts: Array<{
      id: string;
      fact: string;
      category: 'relationship' | 'milestone' | 'status' | 'preference' | 'context' | 'decision' | 'lesson';
      importance: 1 | 2 | 3;
      timestamp: string;
    }>;
    relatedEntities: string[];
  }>;
  notes: Array<{
    date: string;
    score: number;
    content: string;
  }>;
}
```

Example:
```bash
memory recall "daniel berger data platform" --json
```

### `memory search <query>`

Advanced retrieval surface.

Options:
- strategy: `--keyword`, `--vec`, default fusion
- output: `--json`
- result bounds: `-n <limit>`, `--min-score <n>`
- scope: `--scope all|entities|facts|notes`
- fusion tuning: `--vector-weight <n>`, `--text-weight <n>`
- fact filter: `--category <type>`
- expansion: `--expand`

Example:
```bash
memory search "platform decision" --category decision --scope facts
```

### `memory consolidate --entity <path> --input <json-file>`

Runs consolidation for one entity.

Options:
- `--dry-run` (no writes)

Input contract (`--input`):
```ts
type CandidateFact = {
  fact: string;
  category: 'relationship' | 'milestone' | 'status' | 'preference' | 'context' | 'decision' | 'lesson';
  importance: 1 | 2 | 3;
  timestamp: string;
  relatedEntities: string[];
}
```

Example:
```bash
memory consolidate --entity people/jak-myers --input /tmp/candidates.json --dry-run
```

## Entity Commands

### `memory entity list --json`

Manifest contract:
```ts
type EntityManifestRow = {
  path: string;
  name: string;
  type: string;
  bucket: 'projects' | 'people' | 'areas' | 'resources' | 'archives';
  tags: string[];
  factCount: number;
  lastUpdated: string;
}
```

Example:
```bash
memory entity list --json > workspace/projects/agentic-os/data/entity-manifest.json
```

## Operations

### `memory session-digest`

Runs staged pipeline orchestration over session logs.

Options:
- `--force`
- `--no-consolidate` (fallback create-only path)
- `--no-curate`

Notes:
- legacy `--full` is removed.
- command prunes session-state entries for deleted session logs.
- extraction uses delta mode when `digestedMessageCount` metadata is available.
- changed-hash sessions are never skipped; stale boundaries fall back to full extraction.
- emits observability lifecycle events to `.aOS/logs/pipeline/events.jsonl`.
- emits one terminal hook-run summary to `.aOS/logs/pipeline/hook-runs.jsonl`.

### `memory session-mirror`

Mirrors Claude Code session logs and emits mirror observability context/events.

Notes:
- parses hook stdin fields (`session_id`, `hook_event_name`) when available.
- writes run context files to `.aOS/logs/pipeline/inbox/` for digest correlation.
- preserves existing `digestedMessageCount` and `sessionSummary` in session state.
- emits `mirror.start` and `mirror.end` events.

### Session State Contract (`memory/data/session-state.json`)

```ts
interface SessionStateEntry {
  contentHash: string;
  digestedAt: string | null;
  digestedHash: string | null;
  digestedMessageCount: number | null;
  sessionSummary: string | null;
}

interface SessionStateFile {
  schemaVersion: 3;
  sessions: Record<string, SessionStateEntry>;
  lastDigest: string | null;
  lastCurate: string | null;
}
```

### `memory doctor`

Integrity/staleness diagnostics.

Options:
- `--json`

JSON response shape:
```ts
{
  summary: { issueCount: number; errorCount: number; warnCount: number };
  issues: Array<{
    code: string;
    severity: 'error' | 'warn';
    path?: string;
    message: string;
  }>;
}
```

Common issue codes:
- `MALFORMED_ITEMS_JSON`
- `ORPHAN_TMP_FILE`
- `STALE_DIGEST_LOCK`
- `MEMORY_MD_MISSING`
- `MEMORY_MD_STALE`
- `VECTOR_INDEX_MISSING`
- `VECTOR_INDEX_STALE`
- `GRAPH_DIRTY_ENTITY_MISSING`

Example:
```bash
memory doctor --json
```

### `memory alerts`

Operational alerts for upcoming and stale risk.

Options:
- `--json`
- `--today YYYY-MM-DD`

JSON response shape:
```ts
{
  today: string;
  upcomingMilestones: Array<{ entityPath: string; factId: string; fact: string; due: string; daysUntil: number }>;
  neglectedCriticalFacts: Array<{ entityPath: string; factId: string; fact: string; daysSinceAccess: number }>;
  staleEntities: Array<{ entityPath: string; lastUpdated: string; daysStale: number }>;
}
```

Example:
```bash
memory alerts --json --today 2026-02-12
```

### `memory rebuild <subcommand>`

Rebuild validation helpers.

Subcommands:
- `manifest-diff --before <json> --after <json> [--json]`
- `validate-staging --input <json>`
- `provenance --dir <staging-dir> [--json]`
- `orchestrate --manifest <json> --staging-dir <dir> [--max-concurrent N] [--max-calls-per-entity N] [--retries N] [--dry-run] [--json]`

Runner configuration:
- set `MEMORY_SWARM_AGENT_CMD` to a headless subagent command that reads a task JSON from stdin and writes JSON result to stdout.

Examples:
```bash
memory rebuild manifest-diff --before workspace/projects/agentic-os/data/entity-manifest.json --after workspace/projects/agentic-os/data/post-rebuild-manifest.json --json
memory rebuild validate-staging --input memory/data/staging/people-jane.json
memory rebuild provenance --dir memory/data/staging --json
MEMORY_SWARM_AGENT_CMD="codex-agent --headless" memory rebuild orchestrate --manifest workspace/projects/agentic-os/data/entity-manifest.json --staging-dir memory/data/staging --json
```

## Error Behavior

- CLI errors set non-zero `process.exitCode`.
- Corrupt state mutation paths fail closed and emit `.corrupt-*` backups.
- Consolidation parsing failures fall back to `create` decisions.

## Observability Log Contracts

Source module:
- `.aOS/app/memory/src/pipeline/observability.ts`

Primary runtime contracts:
- `PipelineEvent` (events JSONL row)
- `HookRunSummary` (hook-runs JSONL row)
- `PipelineRunContext` (inbox/claimed context file)

Retention + rotation controls:
- `MEMORY_OBSERVABILITY_RETENTION_DAYS` (default `30`)
- `MEMORY_OBSERVABILITY_MAX_FILE_BYTES` (default `5242880`)

See:
- `docs/OBSERVABILITY.md` for event taxonomy, status/skip semantics, and troubleshooting queries.

## Programmatic Return Envelope

Most internal helpers return:
```ts
type Result<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; code?: string };
```
