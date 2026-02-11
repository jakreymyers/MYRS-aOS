---
title: Google CLI (gogcli)
type: reference
domain: communications
created: 2026-02-05
updated: 2026-02-05
author: exa
version: 1.0
status: final
tags: [google, gmail, calendar, drive, docs, sheets, chat, cli]
summary: Fast, JSON-first CLI for Google services. Covers Gmail, Calendar, Drive, Docs, Sheets, Chat, Contacts, Tasks, and more.
---

# Google CLI (`gog`)

**Source:** [steipete/gogcli](https://github.com/steipete/gogcli)
**Binary:** `gog`
**Install:** `brew install steipete/tap/gogcli`

## Overview

Script-friendly CLI for Google services. JSON-first output, multi-account support, least-privilege auth. All data goes to stdout, errors/progress to stderr.

## Services

| Service | Command | Key Actions |
|---------|---------|-------------|
| Gmail | `gog gmail` | search, send, labels, drafts, filters, vacation, watch |
| Calendar | `gog calendar` | events, create, update, freebusy, conflicts, focus-time, OOO |
| Chat | `gog chat` | spaces, messages, threads, dm (Workspace only) |
| Drive | `gog drive` | ls, search, upload, download, mkdir, permissions, share |
| Docs | `gog docs` | cat, create, copy, export (PDF/DOCX/TXT) |
| Sheets | `gog sheets` | get, update, append, clear, format, create, export |
| Slides | `gog slides` | create, copy, export (PDF/PPTX) |
| Contacts | `gog contacts` | search, create, update, directory |
| Tasks | `gog tasks` | lists, add, update, done, undo, delete |
| Keep | `gog keep` | list, get, search (Workspace only) |
| Groups | `gog groups` | list, members (Workspace only) |

## Common Patterns

```bash
# Gmail — search and read
gog gmail search "from:boss subject:budget" --json
gog gmail thread <thread-id> --json

# Gmail — send
gog gmail send --to "alice@example.com" --subject "Q3 Report" --body "See attached." --attach report.pdf

# Calendar — today's events
gog calendar events --json

# Calendar — create event
gog calendar create --title "1:1 with Alice" --start "2026-02-06T10:00" --end "2026-02-06T10:30"

# Drive — list and download
gog drive ls --json
gog drive download <file-id> -o ./local-copy.pdf

# Sheets — read data
gog sheets get <spreadsheet-id> "Sheet1!A1:D10" --json
```

## Global Flags

| Flag | Purpose |
|------|---------|
| `--account <email\|alias>` | Select account |
| `--json` | JSON output |
| `--plain` | Stable TSV output (for piping) |
| `--force` | Skip confirmations |
| `--no-input` | Never prompt (CI/agent mode) |
| `--enable-commands <csv>` | Restrict available commands (sandboxing) |

## Auth

```bash
gog auth add           # Interactive OAuth flow — opens browser
gog auth status        # Show authenticated accounts
gog auth remove <id>   # Remove account
```

Credentials stored in OS keyring (macOS Keychain). Tokens auto-refresh.

## Agent Usage Notes

- Always use `--json` for structured output parsing.
- Use `--no-input` to prevent interactive prompts during automated runs.
- Use `--enable-commands` to sandbox to only needed services.
- Sending emails or modifying calendar events are **external side effects** — require user approval per guardrails.
- Read-only operations (search, list, get) can proceed autonomously.
