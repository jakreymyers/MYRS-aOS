# AOS Memory Prompts (v4.2)

## Prompt Inventory

- `extract-system.txt`
- `extract-user.txt`
- `consolidate-system.txt`
- `consolidate-user.txt`
- `curate-system.txt`
- `curate-user.txt`
- `summarize-system.txt`

Loaded by `.aOS/app/memory/src/llm/prompts.ts`.

## Contracts

### Extraction

Input:
- `date`
- `session_id`
- existing entity list (`entity_list`)
- previous summary (`previous_summary`)
- transcript label (`transcript_label`)
- transcript messages (`messages`)

Output JSON:
```json
{
  "facts": [{"entityPath":"...","fact":"...","category":"...","importance":1,"timestamp":"...","relatedEntities":[]}],
  "newEntities": [{"path":"...","name":"...","type":"...","bucket":"...","tags":[]}],
  "sessionSummary": "...",
  "decisions": ["..."],
  "lessons": ["..."]
}
```

Parser behavior:
- invalid JSON -> empty fallback
- invalid category -> `context`
- invalid importance -> `1`
- invalid path shape -> dropped
- `supersededBy` forced to `null`

Runtime extraction behavior:
- Delta mode uses `previous_summary` + only new messages.
- `previous_summary` is capped before prompt render (500-word ceiling).
- If extraction returns zero facts from mixed user/assistant messages, one user-only retry is attempted.

### Consolidation

Input:
- entity path
- existing facts block
- candidate facts block

Output JSON:
```json
{
  "decisions": [
    {"candidateIndex":0,"action":"create"},
    {"candidateIndex":1,"action":"merge","targetFactId":"...","mergedFact":"...","importance":3},
    {"candidateIndex":2,"action":"supersede","targetFactId":"..."},
    {"candidateIndex":3,"action":"drop","reason":"..."}
  ]
}
```

Parser normalization:
- `mergedFact` -> internal `fact`
- unknown action -> `create`
- unknown targetFactId -> `create`
- missing candidate decisions -> filled as `create`

### Curation

Input:
- current `MEMORY.md`
- changed entity summaries (diff since last curate)
- new/updated daily reports (diff since last curate)
- today date

Output:
- complete `MEMORY.md` content only
- fixed section structure from `curate-system.txt`

## Failure Modes

- LLM parse failure (extract/consolidate): parser fallback paths apply.
- Empty curate output: command fails and keeps previous `MEMORY.md`.
- Prompt file missing: hard error from `readPrompt()`.

## Prompt Testing Guidance

- Use `bun test` suites:
- `tests/knowledge/extract.test.ts`
- `tests/pipeline/extract-stage.test.ts`
- `tests/knowledge/consolidate.test.ts`
- `tests/knowledge/decay.test.ts`
- CLI coverage for `recall`, `consolidate`, `doctor`, `alerts`

- Validate all changed prompts with:
```bash
cd .aOS/app/memory
bun test
```
