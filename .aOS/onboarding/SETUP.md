---
title: aOS Setup Guide
type: reference
domain: technical
created: 2026-02-10
updated: 2026-02-10
author: exa
version: 1.0
status: final
tags: [setup, onboarding, installation]
summary: How to set up aOS from scratch — prerequisites, installation, and agent-guided onboarding.
---

# aOS Setup Guide

## Prerequisites

| Requirement | How to install | Required? |
|-------------|---------------|-----------|
| **Bun** (v1.1+) | `curl -fsSL https://bun.sh/install \| bash` | Yes |
| **Git** | `brew install git` (macOS) | Yes |
| **Homebrew SQLite** | `brew install sqlite` (macOS only) | Yes (macOS) |
| **Claude Code CLI** | `npm install -g @anthropic-ai/claude-code` | Yes |
| **gog CLI** | `brew install steipete/tap/gogcli` | Optional |

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/MYRS-aOS/aOS.git my-aos
cd my-aos

# 2. Run setup (installs deps, creates dirs)
.aOS/onboarding/setup.sh

# 3. Open Claude Code — the agent guides you from here
claude
```

When Claude Code starts, say **"let's get started"** and the agent will walk you through the rest.

## What to Expect

The agent guides you through 5 onboarding phases:

| Phase | What happens | Time |
|-------|-------------|------|
| **1. System Verification** | Agent checks that setup ran correctly | ~1 min |
| **2. Personalization** | Agent interviews you, generates your config files | ~10 min |
| **3. Google Connection** | Agent walks you through OAuth setup for Gmail/Calendar/Drive | ~10 min |
| **4. Context Population** | Agent explores your email/calendar to seed your knowledge graph | ~15 min |
| **5. Verification & Handoff** | Agent verifies everything works, switches to production mode | ~5 min |

**Total: ~40 minutes** for a fully personalized AI workspace.

Phase 3 (Google) is optional — you can skip it and add it later. Phase 4 adapts: with Google connected it auto-discovers your contacts and projects; without Google you'll provide them manually.

## Manual Setup (Advanced)

If you prefer to skip the agent-guided onboarding:

1. Run `.aOS/onboarding/setup.sh` for dependencies and directory structure
2. Copy the template files and edit manually:
   ```bash
   cp .aOS/onboarding/templates/user.md.template prompts/aos-configuration/user.md
   cp .aOS/onboarding/templates/identity.md.template prompts/aos-configuration/identity.md
   cp .aOS/onboarding/templates/MEMORY.md.template memory/MEMORY.md
   ```
3. Edit each file — replace `<!-- CUSTOMIZE: ... -->` sections with your info
4. Create `prompts/aos-configuration/guardrails.md` (use the template defaults as a starting point)
5. Copy the production CLAUDE.md into place:
   ```bash
   cp .aOS/onboarding/CLAUDE.md.production CLAUDE.md
   ```
6. Optionally install gog and configure Google OAuth
7. Create initial knowledge graph entities with `memory entity create`
8. Run `memory vec sync` to index everything

## Troubleshooting

### SQLite extension errors on macOS

The memory system uses `sqlite-vec` which requires loadable extensions. Bun's built-in SQLite doesn't support this — you need Homebrew's SQLite:

```bash
brew install sqlite
```

The memory CLI handles the SQLite override automatically via `Database.setCustomSQLite()`.

### Hook failures

aOS uses Claude Code hooks for session logging and extraction. If hooks aren't firing:

1. Check `.claude/settings.json` — verify hooks are configured
2. Check that `$CLAUDE_PROJECT_DIR` resolves correctly
3. Run `.aOS/onboarding/verify-setup.sh` to check system state
4. Check `.aOS/logs/sessions/` for recent session logs

### Google OAuth issues

Common problems with gog CLI setup:

- **"Access blocked"**: Make sure you've enabled the required APIs in Google Cloud Console (Gmail, Calendar, Drive, Contacts, Docs, Sheets)
- **"Invalid client"**: Re-download the OAuth client secret JSON from Google Cloud Console
- **Token refresh failures**: Run `gog auth add <email> --services gmail,calendar,...` again to re-authorize

### Vector search not returning results

```bash
# Check index status
memory vec status

# Force re-index everything
memory vec sync --force
```

### Memory stats shows 0 entities after onboarding

Entity creation may have failed silently. Check:
```bash
# List what's in the context directory
ls context/people/ context/projects/

# Try creating a test entity
memory entity create people/test-person --type person --name "Test Person"
memory entity list
```
