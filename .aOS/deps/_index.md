---
title: "aOS Dependencies"
type: index
domain: technical
created: 2026-02-08
updated: 2026-02-08
author: exa
version: 2.0
status: active
tags: [agentic-os, dependencies, tools]
summary: >
  Managed external dependencies for the aOS system. Currently no active external dependencies.
---

# aOS Dependencies

Each dependency lives in `.aOS/deps/<name>/` with:
- `dep.json` — Tracks source, installed commit, dates
- `install.sh` — Install or update the dependency
- `check-update.sh` — Check if a newer version exists upstream

## Commands

```bash
# Check all dependencies for updates
.aOS/deps/check-all.sh
```

## Dependencies

No active external dependencies. The memory system uses in-process sqlite-vec for vector search.

| Name | Source | Purpose | Status |
|------|--------|---------|--------|
| ~~`qmd`~~ | ~~[tobi/qmd](https://github.com/tobi/qmd)~~ | ~~Semantic + hybrid search~~ | Removed (2026-02-08) — replaced by sqlite-vec |
