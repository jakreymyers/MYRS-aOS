# Agentic Operating System (aOS) - Architecture

## System 

```
agentic-os/
├── context/     # PARA knowledge graph (projects, people, areas, resources, archives)
├── prompts/     # System configuration and reusable prompt templates
├── workflows/   # Process definitions
├── workspace/   # Personal working files and projects
├── memory/      # Persistent memory system
├── .aOS/        # System runtime and modules
│   └── tools/   # Modular CLI primitives
└── .claude/     # Skills, agents, hooks
```

## Workspace

```
workspace/
├── projects/            # Active projects with deliverables
│   └── [project-name]/
└── research/            # Research materials and notes
    └── [topic]/
```

See `workspace/_index.md` for current state.

## Context (PARA Knowledge Graph)

```
context/
├── projects/          # Active work with goals/deadlines
│   └── [name]/        # summary.md + items.json
├── people/            # Person entities (top-level domain)
│   └── [name]/        # summary.md + items.json
├── areas/             # Ongoing responsibilities
│   ├── companies/     # Company entities
│   ├── departments/   # Department context
│   └── teams/         # Team context
├── resources/         # Topics of interest / reference
│   └── [topic]/       # summary.md + items.json
└─── archives/         # Inactive items from other buckets
```

Each entity directory contains `summary.md` (hot+warm facts) and `items.json` (full atomic fact history).

See `context/_index.md` for current state.

## Tools & Capabilities

- **Tools**: `.aOS/tools/_index.md`
- **Skills**: `.claude/skills/`
- **Workflows**: `workflows/_index.md`
