# simple-swarm

`simple-swarm` is a terminal-first “agentic PR factory” for developers.

You write a plan (a Markdown checklist), `swarm` turns it into a dedicated git worktree + branch, opens a draft PR, and then iterates one TODO at a time using a configurable coding agent. Review happens in GitHub: comments and review submissions are triaged into new TODOs and pushed back onto the same PR.

`simple-swarm` is designed to be safe to run from multiple clones: all runtime state lives in `.swarm/` (gitignored), so each developer can run their own dispatcher against the PRs they create/track in their local state.

## How It Works

- Plans start locally in `.swarm/inbox/` (gitignored; clean `git status`).
- The dispatcher ingests a plan into a new branch/worktree at `plans/<id>.md` and opens a draft PR.
- The worker agent executes exactly one TODO per iteration and updates the plan in-branch.
- PR comments/reviews trigger a triage agent which updates the plan with new TODOs and posts a reply.
- When all TODOs are complete, the PR is marked ready; you merge when satisfied.

## Requirements

- Bun
- Git
- GitHub CLI (`gh`) authenticated for the repo
- At least one supported agent CLI installed:
  - `opencode`
  - `codex`
  - `claude`

## Install

```bash
bun install
```

## Usage

Run commands via:

```bash
bun run dev <command>
```

Or build the standalone CLI:

```bash
bun run build
# then run: ./dist/cli/index.js <command>
```

### Commands

- `swarm new [plan-id] [--agent <codex|opencode|claude>]`
  - Creates `.swarm/inbox/<id>.md` and launches an interactive designer session.
- `swarm start`
  - Starts the dispatcher loop (ingests inbox plans, runs TODOs, polls PR feedback).
- `swarm status`
  - Shows inbox plans and active plans tracked in `.swarm/state.json`.
- `swarm edit <plan-id> [--agent <...>]`
  - Edits a plan either in inbox (pre-dispatch) or in the plan’s worktree (post-dispatch).
- `swarm stop <plan-id>` / `swarm unpause <plan-id>`
  - Pauses/resumes automation for an active plan.
- `swarm open <plan-id>`
  - Opens the configured agent’s interactive TUI in the plan worktree (requires paused).
- `swarm poll [plan-id]`
  - Forces an immediate PR-feedback poll.
  - With `<plan-id>`: poll once for that plan without shifting its schedule.
  - Without `<plan-id>`: poll now and reset the schedule for all active plans.

## Basic Workflow

1. Create a plan:
   - `bun run dev new my-feature`
2. Start the dispatcher:
   - `bun run dev start`
3. Review the draft PR in GitHub.
4. Leave PR comments or a review; `swarm` triages feedback into TODOs.
5. When the PR is ready, merge it.

## Configuration

Create `swarm.config.json` in the repo root:

```json
{
  "agents": {
    "default": "opencode",
    "designer": "codex"
  },
  "worktrees_dir": ".swarm/worktrees",
  "poll_interval_ms": 60000
}
```

## Notes

- Runtime state is stored under `.swarm/` (gitignored).
- The plan file is committed on the PR branch at `plans/<id>.md` and lands on `main` only when you merge the PR.
