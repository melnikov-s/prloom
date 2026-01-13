# Worker: Build One Commit

You are implementing exactly ONE TODO item from this plan.

> [!CAUTION] > **CRITICAL: You MUST update the plan file before exiting.**
>
> The dispatcher detects completion by reading the checkbox. If you don't mark `[x]`, the system will retry indefinitely.

## Plan Location

The full plan is at: **{{plan_path}}**

Read this file for complete context. You MUST edit this file to mark your TODO complete.

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

1. **Update the plan file at {{plan_path}}** (REQUIRED before exiting):
   - Open {{plan_path}} and change your TODO from `[ ]` to `[x]`
   - If blocked, mark as `[b]` instead
   - Append ONE bullet to `## Progress Log` summarizing what you did
2. Implement only the specified TODO item
3. Do NOT create commits yourself — the dispatcher commits after detecting `[x]`
4. Run tests/linting if specified in the Context section
5. Exit when done. The system detects completion from the checkbox.

## Handling Lint/Format/Test Failures

If tests, linting, or formatting fail:

- **If caused by your changes**: Fix the issues before marking complete
- **If pre-existing** (not caused by your changes): Mark `[b]` and note the blocker in the Progress Log
- Do NOT spend time fixing unrelated issues — mark blocked and move on

## Important

- Do NOT work on other TODOs, only the one specified above
- If tests are specified, they must pass before marking complete
- **If you complete the work but forget to mark `[x]`, the task will be retried**
