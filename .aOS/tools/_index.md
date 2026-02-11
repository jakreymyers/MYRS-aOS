---
title: Tools Index
type: index
updated: 2026-02-04
summary: Modular CLI primitives for deterministic operations
---

# Tools

Each tool is a standalone CLI focused on one domain. Workflows orchestrate these primitives.

## Available CLIs

| CLI | Domain | Status |
|-----|--------|--------|
| `memory-cli` | Persistent knowledge operations | Ready |
| `google-cli` | Google services (Gmail, Calendar, Drive, etc.) | Ready |

## Design Principles

1. **Single domain** - Each CLI does one thing well
2. **Atomic commands** - Commands are primitives, not workflows
3. **Composable** - Workflows combine primitives as needed
4. **Agnostic** - CLIs don't encode business logic

---

## memory-cli

Persistent knowledge operations. See `memory-cli/README.md` for full docs.

```bash
memory search "query"           # Search memory entries
memory add "fact" --type pref   # Add new entry
memory log "event"              # Log session event
memory export --format json     # Export entries
```

---

## google-cli

Google services CLI (`gog`). See `google-cli/README.md` for full docs.

```bash
gog gmail search "query" --json     # Search Gmail
gog gmail send --to "x" --subject "y" --body "z"  # Send email
gog calendar events --json          # Today's events
gog drive ls --json                 # List Drive files
gog sheets get <id> "A1:D10" --json # Read spreadsheet
```

---

## Adding New CLIs

When adding a new CLI tool:

1. Create folder: `.aOS/tools/[name]/`
2. Add `README.md` with usage documentation
3. Add `package.json` for packaging
4. Add source files in `src/`
5. Update this index
