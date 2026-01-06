# PRLoom Integration

PRLoom is a CLI tool that orchestrates coding work through **plans** - markdown files that describe what needs to be built. Each plan contains an objective, context, and a TODO checklist. PRLoom manages the lifecycle: creating worktrees, opening PRs, and tracking progress.

## What is a Plan?

A plan is a markdown file with YAML frontmatter that describes a unit of work:

```markdown
---
id: add-user-auth
status: queued
agent: manual
base_branch: main
---

## Objective

Add user authentication with email/password login.

## Context

- Auth library: `better-auth`
- Database: SQLite via Drizzle ORM
- Run tests: `bun test`

## TODO

- [ ] Create users table migration
- [ ] Add login/signup API routes
- [ ] Add session middleware

## Session Notes

<!-- Append notable observations here -->
```

## Plan Lifecycle

1. **Create** - `prloom new <id> --agent manual --no-designer` creates a plan in `.prloom/inbox/<id>.md`
2. **Edit** - Fill in the Objective, Context, and TODO sections
3. **Dispatch** - When `prloom start` runs, the plan is moved to a git worktree and a draft PR is opened
4. **Execute** - Complete each TODO, mark checkboxes, add Session Notes if notable
5. **Complete** - When all TODOs are done, the PR is marked ready for review

## CLI Commands

| Command                                        | Description                                 |
| ---------------------------------------------- | ------------------------------------------- |
| `prloom init`                                  | Initialize prloom in a repository           |
| `prloom new <id> --agent manual --no-designer` | Create a new plan skeleton                  |
| `prloom status`                                | Show all plans with their worktree paths    |
| `prloom edit <id> --no-designer`               | Print the path to an existing plan          |
| `prloom poll <id>`                             | Fetch and display PR feedback               |
| `prloom start`                                 | Start the dispatcher (manages PR lifecycle) |

## Creating a New Plan

```bash
prloom new my-feature --agent manual --no-designer
```

Output:

```
Created plan in inbox: .prloom/inbox/my-feature.md
Base branch: main
Worker agent: manual

Plan skeleton created. Edit manually or use your IDE.
Run 'prloom start' to dispatch when ready.
```

The plan is now at `.prloom/inbox/my-feature.md`. Edit it to add your Objective, Context, and TODOs.

## Finding Your Worktree

After `prloom start` ingests the plan:

```bash
prloom status
```

Output:

```
INBOX (pending dispatch)
────────────────────────────────────────────────────────────
  (no inbox plans)

ACTIVE PLANS
────────────────────────────────────────────────────────────
my-feature
  Status:   active
  Agent:    manual
  PR:       PR #42
  Worktree: /Users/dev/.prloom-worktrees/my-feature
  Plan:     /Users/dev/.prloom-worktrees/my-feature/plans/my-feature.md

────────────────────────────────────────────────────────────
COMMANDS:
  prloom new <id> --agent manual --no-designer  Create a new plan
  prloom poll <id>                              View PR feedback
  prloom edit <id> --no-designer                Get plan path
```

Open the worktree directory in your editor. The plan file is at `plans/<id>.md`.

## Completing a TODO

For each unchecked item (`- [ ] ...`):

1. Read the task description
2. Implement the change in code
3. Mark the checkbox: `- [x] Task description`
4. (Optional) Add a Session Note if you encountered something notable:

   ```
   ## Session Notes

   - ⚠️ better-auth requires explicit session cleanup on logout
   ```

5. Run any tests listed in the Context section
6. Commit and push:
   ```bash
   git add -A
   git commit -m "[prloom] my-feature: users table migration"
   git push
   ```

## Checking PR Feedback

```bash
prloom poll my-feature
```

Output:

```
PR FEEDBACK: my-feature
PR #42 | Status: active
────────────────────────────────────────────────────────────

[1/4/2026] reviewer-name (comment)
  Can you add input validation here?

[1/4/2026] reviewer-name (inline comment)
  File: src/routes/login.ts:45
  This should handle the case where email is missing.

────────────────────────────────────────────────────────────

NEXT STEPS:
  1. Review the feedback above
  2. Add new TODO items to the plan if needed
  3. Implement fixes in the worktree
  4. Commit and push changes

Worktree: /Users/dev/.prloom-worktrees/my-feature
Plan:     /Users/dev/.prloom-worktrees/my-feature/plans/my-feature.md
```

Address the feedback by adding TODO items and implementing fixes.
