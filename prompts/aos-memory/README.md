# AOS Memory Prompts

This directory contains prompt templates used by the memory system for daily report synthesis.

## Files

- `daily-report-system.txt`
  - System-level instructions for the daily report generator.
- `daily-report-user.txt`
  - User prompt template with placeholders replaced at runtime.

## Placeholders

The following placeholders are supported in `daily-report-user.txt`:

- `{{template}}` — Rendered daily report template for the target date.
- `{{existing_report}}` — Existing daily report content (or `(none)`).
- `{{session_list}}` — List of sessions with id, turn count, and path.
- `{{messages}}` — Chronological session messages.

## Notes

- Keep the output strictly aligned to the report template.
- Session Index must include every session with at least one turn.
- Use the exact log path provided for each session.
- Delineate per-session sections with semantic headers, e.g.:
  `### <Session Title> (Session <id>)`

## References

Exact mappings:

- `daily-report-system.txt` → `DAILY_REPORT_SYSTEM_PROMPT` in `.aOS/app/memory/src/llm/prompts.ts` → used by `.aOS/app/memory/src/llm/claude.ts`
- `daily-report-user.txt` → `DAILY_REPORT_USER_PROMPT` in `.aOS/app/memory/src/llm/prompts.ts` → used by `.aOS/app/memory/src/llm/claude.ts`
