---
title: Workflows Index
type: index
updated: 2026-02-04
summary: Process definitions that orchestrate tools and prompts
---

# Workflows

Step-by-step process definitions for common tasks. Workflows orchestrate CLI primitives.

## Files

| File | Purpose |
|------|---------|
| *No workflows yet* | Add workflow definitions as needed |

---

## Usage

When asked to perform a task, check here first for an existing workflow.

### Workflow Structure

```markdown
---
title: Workflow Name
type: workflow
tools: [memory, calendar, email]
---

# Workflow Name

## When to Use
[Trigger conditions]

## Steps
1. Use `tool command` to do X
2. Use `tool command` to do Y
3. Create output using template

## Expected Output
[What this workflow produces]
```
