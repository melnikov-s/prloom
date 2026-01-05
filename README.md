# prloom

`prloom` is a terminal-first “agentic PR factory” for developers.

You write a plan (a Markdown checklist), `prloom` turns it into a dedicated git worktree + branch, opens a draft PR, and then iterates one TODO at a time using a configurable coding agent. Review happens in GitHub: comments and review submissions are triaged into new TODOs and pushed back onto the same PR.

`prloom` is designed to be safe to run from multiple clones: all runtime state lives in `prloom/.local/` (gitignored), so each developer can run their own dispatcher against the PRs they create/track in their local state.

## How It Works

- Plans start locally in `prloom/.local/inbox/` (gitignored; clean `git status`).
- The dispatcher ingests a plan into a new branch/worktree at `prloom/plans/<id>.md` and opens a draft PR.
- The worker agent executes exactly one TODO per iteration and updates the plan in-branch.
- PR comments/reviews trigger a triage agent which updates the plan with new TODOs and posts a reply.
- When all TODOs are complete, the PR is marked ready; you merge when satisfied.

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
  - Initializes `.prloom/`, ensures `.prloom/` is gitignored, and writes `prloom.config.json`.
- `prloom new [plan-id] [--agent <codex|opencode|claude>]`
  - Creates `.prloom/inbox/<id>.md` and launches an interactive designer session.
- `prloom start`
  - Starts the dispatcher loop (ingests inbox plans, runs TODOs, polls PR feedback).
- `prloom status`
  - Shows inbox plans and active plans tracked in `.prloom/state.json`.
- `prloom edit <plan-id> [--agent <...>]`
  - Edits a plan either in inbox (pre-dispatch) or in the plan’s worktree (post-dispatch).
- `prloom stop <plan-id>` / `prloom unpause <plan-id>`
  - Pauses/resumes automation for an active plan.
- `prloom open <plan-id>`
  - Opens the configured agent’s interactive TUI in the plan worktree (requires paused).
- `prloom poll [plan-id]`
  - Forces an immediate PR-feedback poll.
  - With `<plan-id>`: poll once for that plan without shifting its schedule.
  - Without `<plan-id>`: poll now and reset the schedule for all active plans.

## Basic Workflow

1. Initialize prloom:
   - `npx -y prloom init`
2. Create a plan:
   - `npx -y prloom new my-feature`
3. Start the dispatcher:
   - `npx -y prloom start`
4. Review the draft PR in GitHub.
5. Leave PR comments or a review; `prloom` triages feedback into TODOs.
6. When the PR is ready, merge it.

## Configuration

Create `prloom/config.json`:

```json
{
  "agents": {
    "default": "opencode",
    "designer": "codex"
  },
  "worktrees_dir": "prloom/.local/worktrees",
  "poll_interval_ms": 60000,
  "base_branch": "main"
}
```

## Repository Context

You can provide repository-specific context to agents by creating markdown files in the `prloom/` directory:

```
repo/
├── prloom/
│   ├── config.json   # Configuration
│   ├── plans/        # Committed plans (on PR branches)
│   ├── planner.md    # Appended to designer prompts
│   ├── worker.md     # Appended to worker prompts
│   └── .local/       # Gitignored (runtime state)
```

- **`prloom/planner.md`**: Architecture info, coding conventions, design patterns
- **`prloom/worker.md`**: Build commands, test patterns, implementation guidelines

These files are appended to the respective agent prompts automatically.

## Notes

- Runtime state is stored under `prloom/.local/` (gitignored).
- The plan file is committed on the PR branch at `prloom/plans/<id>.md` and lands on the configured `base_branch` when you merge the PR.
