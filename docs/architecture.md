# Architecture

prloom is a dispatcher-based system that manages coding work through **plans**.

## Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Dispatcher                           │
│  (src/lib/dispatcher.ts)                                    │
│                                                             │
│  Main loop that:                                            │
│  - Ingests plans from inbox → creates worktrees + PRs        │
│  - Executes TODOs via adapters                              │
│  - Polls bus bridges + routes actions                       │
│  - Runs triage + plugin hooks                               │
│  - (Optional) runs global tick                              │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
   ┌────────────┐      ┌────────────┐      ┌────────────┐
   │  Adapters  │      │    Bus     │      │   State    │
   │            │      │            │      │            │
   │ claude     │      │ prloom/.local/bus │ worktree state.json │
   │ opencode   │      │ (events/actions) │ inbox metadata.json  │
   │ codex      │      │ global bus (opt) │ prloom/config.json   │
   │ gemini     │      │ bridges/plugins  │                     │
   └────────────┘      └────────────┘      └────────────┘
```

## Key Concepts

### Plans

A plan is a markdown file with sections: Title, Plan Summary, Objective, Context, Scope (In/Out), Success Criteria, Constraints, Assumptions, Architecture Notes, Decision Log, Implementation Notes, Plan-Specific Checks, Review Focus, Open Questions, TODO, Progress Log. Inbox plans live at `prloom/.local/inbox/<id>.md` with metadata in `prloom/.local/inbox/<id>.json`. When activated, the plan is copied to `<worktree>/prloom/.local/plan.md` (still gitignored).

### Worktrees

Each plan gets its own git worktree. This isolates work and allows parallel execution. Worktrees are created in the configured `worktrees_dir`.

### State

Runtime state is stored per plan and rebuilt on startup:
- Inbox metadata in `prloom/.local/inbox/<id>.json`
- Active plan state in `<worktree>/prloom/.local/state.json`

It tracks plan status (draft, queued, active, review, triaging, done), worktree paths/branches, PR numbers, cursors, and flags like `blocked` or `hidden`.

### Adapters

Adapters execute prompts via different coding agents. Each adapter implements the same interface but spawns different CLI tools.

### Bus

The bus system handles external events (PR comments, CI results) and outbound actions (posting comments). Each worktree has `prloom/.local/bus/` for events/actions, and optional global bridges can use a repo-level bus for `upsert_plan` actions and global plugins.

### Plugin State

Plugins can persist state across dispatcher restarts:

- **Per-plan state**: `<worktree>/prloom/.local/plugin-state/<pluginName>.json`
- **Global state**: `<repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json`

## Data Flow

1. **Plan created** → `prloom/.local/inbox/<id>.md` + metadata json
2. **Dispatcher ingests** → creates worktree/branch, copies plan to `<worktree>/prloom/.local/plan.md`, opens draft PR (if enabled)
3. **Worker executes TODO** → adapter runs agent, marks checkbox, commits/pushes
4. **Bus ticks** → bridges append events + route actions, plugins can intercept
5. **Triage runs** → adds TODOs and responses from remaining events
6. **All TODOs done** → status set to review, PR marked ready
7. **PR merged/closed** → plan removed from state
