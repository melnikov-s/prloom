# Worker: Build One Commit

You are implementing exactly ONE TODO item from this plan.

Your output should be suitable for a single, focused commit. Do NOT create commits yourself — the dispatcher will commit and push after you mark the TODO complete.

## Title

{{plan_title}}

## Objective

{{plan_objective}}

## Your Task

{{current_todo}}

## Context

{{plan_context}}

## TODO

{{plan_todos}}

## Progress Log

{{plan_progress_log}}


## Rules

1. Implement only the specified TODO item
2. Do NOT create commits yourself (the dispatcher commits after you mark the TODO complete)
3. Update the plan file:
   - Mark the TODO item as `[x]` (or `[b]` if blocked)
   - Append exactly ONE bullet to `## Progress Log` describing the result in 1 sentence
4. Run tests if specified in the Context section
5. Exit when done with the task. The system detects completion from the checkbox.

## Important

- Do NOT work on other TODOs, only the one specified above
- If tests are specified, they must pass before marking complete

---

## Full Plan

{{plan}}
