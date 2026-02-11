# Agentic Operating System (aOS) - Standards

## File Standards

All markdown files must have YAML front matter:

```yaml
---
title: Document Title
type: reference|workflow|prompt|log|artifact
domain: communications|research|admin|technical
created: YYYY-MM-DD
updated: YYYY-MM-DD
author: human-name|agent-id
version: major.minor
status: draft|review|final|archived
headings:
  - "Section Name": start-end  # Line numbers for targeted reading
tags: [searchable, keywords]
summary: Brief description of contents and purpose.
---
```

## Progressive Disclosure

Minimize token usage when searching files. Four levels — stop as soon as you have enough:

1. **Folder names** — `ls` directory, scan names for relevance
2. **Index files** — Read `_index.md` in relevant folders (4-8 word descriptions per file)
3. **Front matter** — Read first 20 lines for YAML metadata: `title`, `type`, `domain`, `tags`, `summary`, `headings` with line numbers
4. **Full document** — Only when metadata confirms relevance

Flow: `ls folder/` → `_index.md` → first 20 lines → targeted sections → full file.

## Project Documentation

Every project has two complementary locations:

| Location | Purpose | Managed by |
|----------|---------|------------|
| `workspace/projects/[name]/` | Authoritative narrative record | Human + agent |
| `context/projects/[name]/` | Agent fast recall (atomic facts) | Memory system |

### Workspace Project Structure

```
workspace/projects/[name]/
  _index.md          # Progressive disclosure entry point
  charter.md         # Why: goals, scope, success criteria
  decisions.md       # Append-only decision log (lightweight ADR)
  status.md          # Current state, milestones, next steps
  [deliverables]     # Named artifacts: report-v1.md, analysis.md, etc.
```

### Knowledge Graph Entity

`context/projects/[name]/` contains `summary.md` (auto-generated from hot+warm facts) and `items.json` (10-15 atomic facts with decay metadata). Atomic facts capture "what happened" and "what is true now" in 1-2 sentences. Full rationale and narrative belong in workspace documents.

See `workspace/projects/agentic-os/` for the reference implementation.
