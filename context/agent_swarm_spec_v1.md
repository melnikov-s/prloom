# Agent Swarm v1 Specification

**Minimal viable agent swarm for semi-autonomous coding.**

---

## 1. What It Does

1. You describe a feature in a markdown plan (`plans/<id>.md`)
2. Dispatcher picks it up, creates worktree + branch
3. Worker executes one TODO at a time, commits after each
4. Draft PR created after first commit, marked ready when done
5. You review and merge

---

## 2. Philosophy

**Git + files are the system. Agents are glue. Humans are fallback.**

| Tool         | Purpose                    |
| ------------ | -------------------------- |
| Markdown     | Plans (git-tracked)        |
| Git          | Branches, commits, history |
| Worktrees    | Isolated workspaces        |
| `gh` CLI     | PR lifecycle               |
| OpenCode SDK | Worker execution           |
| `.swarm/`    | Runtime state (gitignored) |

No databases. No network protocols. State derived from git + local files.

---

## 3. Structure

```
repo/
├── plans/                    # Git-tracked plan files
│   └── feat-auth-fix.md
├── prompts/                  # Git-tracked prompt templates
│   ├── designer.md
│   └── worker.md
├── swarm.config.json         # Optional repo-local config
└── .swarm/                   # Gitignored runtime state
    ├── state.json            # Authoritative state index
    ├── plans/                # Per-plan shards
    │   └── feat-auth-fix.json
    ├── control.jsonl         # IPC command queue
    └── lock                  # Dispatcher lock
```

**Worktrees:** Created outside repo (default `../.swarm-worktrees/`) to avoid nesting.

---

## 4. State Model

### Plan Frontmatter (git-tracked)

```yaml
---
id: feat-auth-fix
status: queued # queued|active|blocked|done
branch: feat-auth-fix-a3f2b
pr: 42
---
```

| Status    | Meaning                           |
| --------- | --------------------------------- |
| `queued`  | Waiting for dispatch              |
| `active`  | Work in progress                  |
| `blocked` | Worker stuck, needs intervention  |
| `done`    | Implementation complete, PR ready |

> **`done` ≠ merged.** `status: done` means ready for review. Merge is outside swarm's control.

### Runtime State (`.swarm/state.json`)

```json
{
  "control_cursor": 1024,
  "plans": {
    "feat-auth-fix": {
      "session_id": "abc123",
      "worktree": "../.swarm-worktrees/feat-auth-fix-a3f2b",
      "branch": "feat-auth-fix-a3f2b",
      "pr": 42,
      "paused": false,
      "next_todo": 2
    }
  }
}
```

- **`paused`**: Runtime-only flag (not in frontmatter) to avoid noise commits
- **`next_todo`**: Hint for crash recovery; plan file is authoritative
- **`control_cursor`**: Byte offset into `control.jsonl`

### Dispatcher Lock (`.swarm/lock`)

```json
{ "pid": 12345, "started_at": "2026-01-03T12:00:00Z" }
```

`swarm start` refuses if lock exists and PID is alive.

---

## 5. Plan Schema

```markdown
---
id: feat-auth-fix
status: queued
---

## Objective

[What we're building]

## Context

[Files, test commands, relevant info — all inlined]

## TODO

- [ ] Task 1
- [ ] Task 2

## Progress Log

<!-- Worker appends here -->
```

---

## 6. Dispatcher Behavior

Long-running process (`swarm start`) managing one repo.

### Main Loop

```
1. Acquire lock (fail if already held)
2. Load state from .swarm/state.json
3. Loop:
   a. Consume IPC commands from control.jsonl (from cursor)
   b. For each plan in plans/:
      - Parse frontmatter
      - Skip if done, blocked, or paused
      - Ensure branch + worktree exist
      - Ensure OpenCode session exists (one per plan)
      - Create draft PR after first commit (if not exists)
      - Find next unchecked TODO (from plan file, not index)
      - If no TODOs left:
        - Set status: done, commit, push
        - Mark PR ready
        - Continue
      - Update next_todo hint, save state
      - Run worker for exactly that TODO
      - After worker exits:
        - Re-parse plan
        - Commit + push changes
        - Update PR body
        - If status: blocked, stop dispatching this plan
   c. Save state
   d. Sleep (poll_interval_ms)
```

### IPC Handling

`.swarm/control.jsonl` is append-only:

```jsonl
{"type":"stop","plan_id":"feat-auth-fix","ts":"2026-01-03T12:00:00Z"}
{"type":"unpause","plan_id":"feat-auth-fix","ts":"..."}
```

**Consumption:**

- `control_cursor` is byte offset
- Read from cursor, parse commands, update cursor
- Commands processed exactly once

**Commands:**

- `stop`: Set `paused = true`, abort session (best-effort)
- `unpause`: Set `paused = false`

### Crash Recovery

On restart:

1. Acquire lock
2. Load state + shards
3. Plans with `status: active` continue automatically
4. If `next_todo` set but TODO not complete, re-run (optimistic v1)

---

## 7. Worker Behavior

One TODO per invocation.

### Contract

1. Receive: plan + specific TODO to execute
2. Implement that TODO
3. Update plan file:
   - Mark TODO as `[x]`
   - Append Progress Log entry
4. If stuck: set `status: blocked`
5. If final TODO complete: set `status: done`
6. Exit

---

## 8. Prompts

### `prompts/worker.md`

```markdown
# Worker Instructions

You are implementing exactly ONE task from this plan.

## Your Task

{{current_todo}}

## Rules

1. Implement only the specified task
2. Update the plan file:
   - Mark the task as [x]
   - Add a Progress Log entry
3. Run tests if specified in Context
4. If stuck, set frontmatter `status: blocked`
5. If this is the final TODO, set frontmatter `status: done`
6. Exit when complete

---

# Plan

{{plan}}
```

---

## 9. Configuration

`swarm.config.json`:

```json
{
  "worktrees_dir": "../.swarm-worktrees",
  "poll_interval_ms": 5000
}
```

> **Concurrency:** Reserved for v2. V1 is single-threaded.

---

## 10. CLI

```bash
swarm new [plan-id]          # Designer session → plans/<id>.md
swarm edit <plan-id>         # Refine existing plan

swarm start                  # Run dispatcher
swarm status                 # Show plan states

swarm stop <plan-id>         # Pause automation (IPC)
swarm unpause <plan-id>      # Resume automation (IPC)
swarm open <plan-id>         # Manual TUI (requires paused)

swarm logs <plan-id>         # Print session ID (debug)
```

### Command Details

**`swarm stop`** — Enqueue stop command. Dispatcher sets `paused = true`, aborts session.

**`swarm unpause`** — Enqueue unpause. Dispatcher clears pause, resumes.

**`swarm open`** — Requires `paused = true`. Launches `opencode --session <id> <worktree>`. Prevents automation/human collision.

---

## 11. PR Lifecycle

1. **Create draft** after first successful TODO commit
2. **Update body** after each TODO (Objective + Progress Log)
3. **Mark ready** when `status: done`

---

## 12. OpenCode Integration

### SDK Usage

```typescript
import { createOpencode } from "@opencode-ai/sdk";

// Init server scoped to worktree
const { client } = await createOpencode({ cwd: worktreePath });

// Create session
const session = await client.session.create({
  body: { title: planId },
});

// Prompt (blocks until complete)
await client.session.prompt({
  path: { id: session.id },
  body: { parts: [{ type: "text", text: prompt }] },
});

// Abort
await client.session.abort({ path: { id: session.id } });
```

> **`prompt()` blocks** until assistant completes full run. Commits occur only after.

### Session Tracking

- One session per plan (never shared)
- Users interact via `plan_id` only

---

## 13. What's NOT in v1

| Feature          | Reason           |
| ---------------- | ---------------- |
| Web dashboard    | CLI sufficient   |
| Concurrency      | Reserved for v2  |
| Reviewer agent   | User reviews PRs |
| Worktree cleanup | Manual           |
