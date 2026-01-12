# prloom

`prloom` is a terminal-first “agentic PR factory” for developers.

You write a plan (a Markdown checklist), `prloom` turns it into a dedicated git worktree + branch, opens a draft PR, and then iterates one TODO at a time using a configurable coding agent. Review happens in GitHub: comments and review submissions are triaged into new TODOs and pushed back onto the same PR.

`prloom` is designed to be safe to run from multiple clones: all runtime state lives in `prloom/.local/` (gitignored), so each developer can run their own dispatcher against the PRs they create/track in their local state.

## How It Works

- Plans start locally in `prloom/.local/inbox/` (gitignored; clean `git status`).
- The dispatcher ingests a plan into a new branch/worktree and opens a draft PR.
- The plan file stays in `prloom/.local/plan.md` (never committed) — the PR description contains the Objective, Context, and Progress Log.
- The worker agent executes exactly one TODO per iteration and updates the local plan file.
- PR comments/reviews trigger a triage agent which updates the plan with new TODOs and posts a reply.
- When all TODOs are complete, the PR is marked ready; you merge when satisfied.
- On squash merge, the plan content is preserved in the commit message.

## Requirements

- Node.js (for running via `npx`)
- Git
- GitHub CLI (`gh`) authenticated for the repo
- At least one supported agent CLI installed:
  - `opencode`
  - `codex`
  - `claude`

## Install

For end-users, prefer `npx` (see Usage).

For local development:

```bash
bun install
```

## Usage

### NPX (recommended)

In your target repository:

```bash
npx -y prloom init
npx -y prloom new my-feature
npx -y prloom start
```

### Local dev

```bash
bun run dev <command>
```

Or build the standalone CLI:

```bash
bun run build
# then run: ./dist/cli/index.js <command>
```

### Commands

- `prloom init`
  - Initializes `prloom/`, ensures `prloom/.local/` is gitignored, and writes `prloom/config.json`.
- `prloom new [plan-id] [--agent <codex|opencode|claude>]`
  - Creates `prloom/.local/inbox/<id>.md` and launches an interactive designer session.
- `prloom start`
  - Starts the dispatcher loop (ingests inbox plans, runs TODOs, polls PR feedback).
- `prloom status`
  - Shows inbox plans and active plans tracked in `prloom/.local/state.json`.
- `prloom edit <plan-id> [--agent <...>]`
  - Edits a plan either in inbox (pre-dispatch) or in the plan's worktree (post-dispatch).
- `prloom stop <plan-id>` / `prloom unpause <plan-id>`
  - Pauses/resumes automation for an active plan.
- `prloom open <plan-id>`
  - Opens the configured agent's interactive TUI in the plan worktree (requires paused).
- `prloom poll [plan-id]`
  - Forces an immediate PR-feedback poll.
  - With `<plan-id>`: poll once for that plan without shifting its schedule.
  - Without `<plan-id>`: poll now and reset the schedule for all active plans.

## Extensibility

`prloom` is designed to be highly extensible via **Plugins** and the **File Bus**.

### Lifecycle Hooks (Plugins)

You can hook into key points of the plan execution lifecycle. Plugins are configured in `prloom/config.json`.

**Available Hook Points:**
- `afterDesign`: After the designer creates a plan.
- `beforeTodo`: Before starting a specific TODO.
- `afterTodo`: After completing a specific TODO.
- `beforeFinish`: Before marking the plan as ready.
- `afterFinish`: After the plan is marked ready/completed.
- `beforeTriage`: After events are polled but before triage processes them. Allows plugins to intercept and claim events.

**Plugin Example:**
```ts
export default function myPlugin(config) {
  return {
    afterTodo: async (plan, ctx) => {
      // Run custom logic, call agents, or emit actions
      const feedback = await ctx.runAgent("Review this change for style.");
      if (feedback) {
        ctx.emitAction({
          type: "respond",
          target: { target: "github-pr", token: { prNumber: ctx.changeRequestRef } },
          payload: { type: "comment", message: feedback }
        });
      }
      return plan;
    }
  };
}
```

### Event Interception (beforeTriage)

The `beforeTriage` hook allows plugins to intercept PR feedback events before they reach the triage agent. This enables custom routing, policy enforcement, and automation workflows.

**Event Interception API:**
```ts
export default function policyPlugin() {
  return {
    beforeTriage: async (plan, ctx) => {
      for (const event of ctx.events) {
        if (shouldHandle(event)) {
          // Handle the event yourself - it won't be triaged
          ctx.markEventHandled(event.id);
        } else if (shouldDefer(event)) {
          // Skip for now, retry later with optional backoff
          ctx.markEventDeferred(event.id, "waiting for CI", 60000);
        }
        // Unmarked events flow into triage as normal
      }
      return plan;
    }
  };
}
```

**Plugin State Storage:**

Plugins can persist state across restarts using per-plan or global storage:

```ts
// Per-plan state (stored in worktree)
const count = ctx.getState("reviewCount") ?? 0;
ctx.setState("reviewCount", count + 1);

// Global state (shared across all plans)
const rateLimit = ctx.getGlobalState("apiCallsToday") ?? 0;
ctx.setGlobalState("apiCallsToday", rateLimit + 1);
```

**Action Helpers:**

Convenience methods for common actions:

```ts
// Post a comment
ctx.emitComment(event.replyTo, "Thanks for the feedback!");

// Submit a review
ctx.emitReview(event.replyTo, {
  verdict: "approve",
  summary: "LGTM",
  comments: []
});

// Merge the PR
ctx.emitMerge(event.replyTo, "squash");
```

**Read Events:**

Query bus events without parsing files directly:

```ts
const { events, lastId } = await ctx.readEvents({
  types: ["pr_comment", "pr_review"],
  sinceId: ctx.getState("lastProcessedId"),
  limit: 50
});
```

### File Bus & GitHub Actions

The File Bus handles communication with external systems. The built-in GitHub bridge supports several automated actions that plugins can emit:

| Action | Payload Example |
|--------|-----------------|
| `comment` | `{ "type": "comment", "message": "Hello!" }` |
| `review` | `{ "type": "review", "verdict": "approve", "summary": "LGTM", "comments": [] }` |
| `request_reviewers` | `{ "type": "request_reviewers", "reviewers": ["octocat"] }` |
| `merge` | `{ "type": "merge", "method": "squash" }` |
| `close_pr` | `{ "type": "close_pr" }` |
| `add_labels` | `{ "type": "add_labels", "labels": ["bug", "priority"] }` |
| `remove_labels` | `{ "type": "remove_labels", "labels": ["stale"] }` |
| `assign_users` | `{ "type": "assign_users", "users": ["coder"] }` |
| `set_milestone` | `{ "type": "set_milestone", "milestone": "v1.0" }` |

## Configuration

Create `prloom/config.json`:

```json
{
  "agents": {
    "default": "opencode",
    "opencode": {
      "default": "gpt-4",
      "designer": "claude-sonnet-4-20250514",
      "worker": "gpt-4-turbo"
    },
    "claude": {
      "default": "sonnet",
      "designer": "opus"
    }
  },
  "worktrees_dir": "prloom/.local/worktrees",
  "github_poll_interval_ms": 60000,
  "base_branch": "main"
}
```

### Agent Configuration

The `agents` config allows you to:
- Set a default agent app (e.g., `opencode`, `claude`, `codex`, `gemini`)
- Configure model preferences per agent, with stage-specific overrides

**Structure:**
- `agents.default`: Which agent app to use (e.g., `"opencode"`)
- `agents.<agent>`: Model configuration for that agent
  - `default`: Default model for all stages
  - `designer`: Model override for the designer stage
  - `worker`: Model override for the worker stage
  - `reviewer`: Model override for the reviewer stage
  - `triage`: Model override for the triage stage

This design keeps model identifiers scoped to their agent (since each agent uses different model names), while making it easy to switch between agents.

## Repository Context

You can provide repository-specific context to agents by creating markdown files in the `prloom/` directory:

```
repo/
├── prloom/
│   ├── config.json   # Configuration
│   ├── planner.md    # Appended to designer prompts
│   ├── worker.md     # Appended to worker prompts
│   └── .local/       # Gitignored (runtime state)
│       ├── inbox/    # Plans awaiting dispatch
│       ├── plan.md   # Active plan (per worktree)
│       └── worktrees/
```

- **`prloom/planner.md`**: Architecture info, coding conventions, design patterns
- **`prloom/worker.md`**: Build commands, test patterns, implementation guidelines

These files are appended to the respective agent prompts automatically.

## Notes

- Runtime state is stored under `prloom/.local/` (gitignored).
- Plan files are never committed to the repository — the PR description and squash commit message serve as the permanent record.
