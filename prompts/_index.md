---
title: Prompts Index
type: index
updated: 2026-02-05
summary: System prompt files and reusable templates
---

# Prompts

## aos-configuration/

Agent persona, user profile, and safety guardrails. Auto-injected via CLAUDE.md.

| File | Purpose |
|------|---------|
| identity.md | Agent persona, voice, decision-making style |
| user.md | Jak's profile, schedule, preferences, delegation model |
| guardrails.md | Hard stops, autonomy tiers, prompt injection defense |

## aos-constitution/

Operating principles, standards, and architecture. Auto-injected via CLAUDE.md.

| File | Purpose |
|------|---------|
| principles.md | Mission, core principles, operating guidelines, context layers |
| standards.md | File standards (YAML front matter), progressive disclosure strategy |
| architecture.md | System architecture, directory layout, workspace and context structure |

## aos-memory/

Prompt templates used by the memory CLI. Code-referenced — do not modify without updating source.

| File | Purpose |
|------|---------|
| daily-report-system.txt | System prompt for daily report synthesis |
| daily-report-user.txt | User prompt template with runtime placeholders |
| README.md | Placeholder mappings and integration notes |
