# Simple Swarm

CLI-based agent swarm for semi-autonomous coding.

## Quick Start

```bash
bun install
bun run src/cli/index.ts --help
```

## Commands

| Command              | Description               |
| -------------------- | ------------------------- |
| `swarm new [id]`     | Create plan with Designer |
| `swarm edit <id>`    | Refine existing plan      |
| `swarm start`        | Run dispatcher            |
| `swarm status`       | Show plan states          |
| `swarm stop <id>`    | Pause automation          |
| `swarm unpause <id>` | Resume automation         |
| `swarm open <id>`    | Manual TUI takeover       |
| `swarm logs <id>`    | Debug info                |

## Testing

```bash
bun test
```

## Architecture

- Plans in `plans/` (git-tracked)
- Runtime state in `.swarm/` (gitignored)
- Prompts in `prompts/` (Handlebars templates)

See [V1 Spec](context/agent_swarm_spec_v1.md) for full details.

---

<docs-harness>
# AGENTS.md

## Context

Work in progress: [context/\_index.csv](context/_index.csv)

## Protocol

### Starting a Session

1. Read \_index.csv — see active work
2. Read docs listed in \_index.csv
3. If applicable, read overview.md and/or architecture.md
4. If user requests work on a topic, read relevant context docs
5. Start working

### Creating Context Docs

For substantial work, create `context/[name].md`:

```
# Name

## Goal
[What we are accomplishing]

## Decisions
[Key decisions and WHY - critical for future agents]

## Progress
### [Date]
- [What was done]
```

Add to \_index.csv: `filename.md,description`

### Before Ending (REQUIRED)

Update context docs with:

- Progress: what you accomplished
- Decisions: choices made and rationale

### When Done

Remove the row from \_index.csv. The doc stays in context/ for future reference.

### When NOT to Create Docs

Bug fixes, small changes, one-off questions.
</docs-harness>
