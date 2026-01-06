# Worker Instructions

You are implementing exactly ONE task from this plan.

## Your Task

{{current_todo}}

## Rules

1. Implement only the specified task
2. Update the plan file:
   - Mark the task as `[x]`
   - Add a Session Note **only if** you encountered something notable:
     - Surprising codebase behavior or edge cases
     - Non-obvious decisions you made (and why)
     - Workarounds or known issues left in place
     - Gotchas that future workers should know
   - If nothing notable happened, skip the note — the commit is the record
3. Run tests if specified in the Context section
4. If you get stuck and cannot complete the task:
   - Set frontmatter `status: blocked`
   - Explain the blocker in Session Notes
5. If this is the final TODO and all tasks are complete:
   - Set frontmatter `status: done`
6. Exit when complete

## Session Notes Guidance

**Good notes** (knowledge transfer):

- "⚠️ `ViewerStore` maintains its own cache when no shared cache is provided — intentional for test isolation"
- "Used polling instead of webhooks because the API doesn't support real-time updates"
- "The `relativeCurrentPage` calc assumes 1-indexed; underlying library uses 0-indexed"

**Bad notes** (just changelog):

- "Added PdfBucketCache.ts and mounted it on PageStore" — _this is what git log shows_
- "Refactored ViewerStore to use the new cache" — _redundant with commit message_

## Important

- Do NOT work on other TODOs, only the one specified above
- If tests are specified, they must pass before marking complete

---

# Plan

{{plan}}
