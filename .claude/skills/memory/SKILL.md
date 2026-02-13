---
name: memory
description: >
  Memory retrieval and graph operations for agentic-os. Use to recall people/projects/decisions,
  inspect entity state, and run operational diagnostics.
license: MIT
compatibility: Requires memory CLI at .aOS/app/memory/
metadata:
  author: exa
  version: "4.2.0"
allowed-tools: Bash(memory:*)
---

# Memory Skill

## Invocation

Always run via wrapper path:

```bash
"$CLAUDE_PROJECT_DIR"/.aOS/app/memory/memory <command> [args]
```

## Primary Retrieval Model

Two paths only:

1. Known entity path:
```bash
memory entity show people/jane-smith
```

2. Everything else:
```bash
memory recall "jane platform roadmap"
```

## Trigger Model

Always retrieve when:
- person is mentioned by name
- question references past decisions/events/timelines
- output is for a specific audience
- status is requested

Conditional:
- project mention: check `memory/MEMORY.md` first; retrieve if insufficient

Usually skip:
- pure formatting/editing tasks
- pure technical coding tasks with no org context

## Sufficiency Rule

Stop retrieval only when answer can cite concrete facts, names, and dates.

## Command Reference

### Retrieval

```bash
memory recall "query" [--json] [-n 5] [--category decision]
memory search "query" [--scope entities|facts|notes] [--min-score 0.5]
memory search "query" --category decision --scope facts
memory search "query" --expand
```

### Entities

```bash
memory entity list [--bucket people] [--json]
memory entity show <path>
memory entity create <path> --type <type> --name <name> [--tags a,b]
memory entity archive <path>
memory entity graph <path>
```

### Consolidation

```bash
memory consolidate --entity <path> --input <candidates.json> [--dry-run]
```

### Operations

```bash
memory doctor [--json]
memory alerts [--json] [--today YYYY-MM-DD]
memory stats [--json]
```

## Notes

- Superseded facts are excluded from default keyword/fusion retrieval.
- Fact categories include: relationship, milestone, status, preference, context, decision, lesson.
- `memory entity list --json` is the manifest contract for rebuild workflows.
