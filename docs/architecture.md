# Architecture

prloom is a dispatcher-based system that manages coding work through **plans**.

## Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Dispatcher                           │
│  (src/lib/dispatcher.ts)                                    │
│                                                             │
│  Main loop that:                                            │
│  - Ingests plans from inbox → creates worktrees + PRs       │
│  - Executes TODOs via adapters                              │
│  - Polls for feedback via bus bridges                       │
│  - Runs triage/review agents                                │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌────────────┐      ┌────────────┐      ┌────────────┐
   │  Adapters  │      │    Bus     │      │   State    │
   │            │      │            │      │            │
   │ claude     │      │ bridges    │      │ state.json │
   │ opencode   │      │ (github)   │      │ config.json│
   │ codex      │      │ events.jsonl      │            │
   │ gemini     │      │ actions.jsonl     │            │
   │ manual     │      │            │      │            │
   └────────────┘      └────────────┘      └────────────┘
```

## Key Concepts

### Plans

A plan is a markdown file with sections: Title, Objective, Context, TODO, Progress Log. Plans live in `prloom/.local/inbox/` before dispatch, then move to a dedicated git worktree.

### Worktrees

Each plan gets its own git worktree. This isolates work and allows parallel execution. Worktrees are created in the configured `worktrees_dir`.

### State

Runtime state lives in `prloom/.local/state.json`. Tracks:
- Plan status (draft, queued, active, review, triaging, done)
- Worktree paths, branches, PR numbers
- Cursor positions for IPC and feedback polling

### Adapters

Adapters execute prompts via different coding agents. Each adapter implements the same interface but spawns different CLI tools.

### Bus

The bus system handles external events (PR comments, CI results) and outbound actions (posting comments). Bridges poll sources and route actions.

### Plugin State

Plugins can persist state across dispatcher restarts:

- **Per-plan state**: `<worktree>/prloom/.local/plugin-state/<pluginName>.json`
- **Global state**: `<repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json`

## Data Flow

1. **Plan created** → `prloom/.local/inbox/<id>.md`
2. **Dispatcher ingests** → creates worktree, branch, draft PR
3. **Worker executes TODO** → adapter runs agent, marks checkbox
4. **Commit & push** → PR updated
5. **Feedback arrives** → bus bridge polls, creates events
6. **beforeTriage hooks** → plugins can intercept/claim events
7. **Triage runs** → adds new TODOs from remaining events
8. **All TODOs done** → PR marked ready for review
