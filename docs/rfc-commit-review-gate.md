
**Status:** Proposal
**Author:** prloom team
**Created:** 2026-01-19

---

## Summary

Introduce a first-class **Commit Review Gate** for prloom’s “one TODO = one commit” workflow.

After a worker completes a TODO (marks it `[x]`) but **before** the dispatcher creates a git commit / pushes to GitHub, prloom optionally runs a **review agent**. The review agent can:

- Approve (allow commit/push to proceed)
- Request changes by **unchecking** the TODO and adding focused feedback directly under that TODO in the plan

The worker then resumes **the same LLM session** and fixes the issues. This can loop review → fix → review up to a configurable maximum.

This feature is **core** (not a plugin hook).

---

## Motivation

Today prloom commits after each TODO is completed. There is no built-in automated sanity review step per commit; quality gates exist mainly via hooks/plugins (e.g. `afterTodo`) or later PR feedback triage.

We want:

- An optional automated “sanity review” per commit that catches clear spec/correctness issues
- Ability for review to use a different model/agent than the worker
- A deterministic loop where review can request changes and the worker resumes with full context (same session)
- A built-in mechanism that does not rely on a plugin hook for correctness gating

---

## Goals

1. **Pre-commit gate**: Review runs after worker marks TODO complete and before commit/push.
2. **First-class**: Not implemented as `afterTodo` plugin.
3. **Session reuse**:
   - Worker resumes the same LLM session across retries and review loops.
   - Reviewer also has its own resumable session across loops.
4. **Actionable feedback**:
   - Reviewer can uncheck TODOs.
   - Reviewer adds feedback under the TODO that is visible in subsequent worker prompts.
5. **Configurable**:
   - Enable/disable per plan.
   - Separate agent/model for reviewer.
   - Configurable max review loops.
6. **Low-nitpick**: Reviewer focuses on clear spec mismatches, correctness issues, or failing checks.

---

## Non-goals

- Replace existing PR feedback triage (`review_triage` prompt) or review providers.
- Provide a full inline diff/patch-based review UI.
- Enforce strict style/lint review (belongs in checks/hooks).

---

## Background: Current Execution Model

Relevant behavior today:

- The per-commit unit is one TODO item in the plan (`prloom/.local/plan.md`).
- The dispatcher runs a worker agent for a TODO. Completion is detected by re-parsing the plan and seeing `[x]`.
- After completion, the dispatcher commits and pushes.

Session reuse exists in this codebase via `src/lib/adapters/call.ts`, but the dispatcher currently runs workers via `AgentAdapter.execute()` which is defined as ephemeral and does not accept/return a session ID.

---

## Proposal

### 1) New Lifecycle Step: Commit Review Gate

Add a new core step between “TODO marked complete” and “commit/push”:

```
beforeTodo hooks
→ worker run
→ TODO marked [x]
→ commit review gate (new)
→ afterTodo hooks (once, only after approval)
→ commit/push
```

`afterTodo` runs only after commit review approval, and remains a pre-commit gate (it runs immediately before commit). This avoids duplicate hook side effects during review/fix loops while preserving the common use case for `afterTodo` (tests/lint/checks before committing).

---

### 2) New Agent Stage: `commitReview`

Add a new stage to agent config:

- Existing: `designer`, `worker`, `triage`
- New: `commitReview`

This stage allows selecting a different agent + model for the commit review gate.

---

### 3) Session-Aware Adapter Execution

Extend the adapter abstraction so the dispatcher can reuse LLM sessions.

#### Type changes

Update `src/lib/adapters/types.ts`:

```ts
export interface ExecutionResult {
  exitCode?: number;
  pid?: number;
  tmuxSession?: string;

  // NEW: LLM conversation identifier (agent session/thread id)
  sessionId?: string;
}

export interface AgentAdapter {
  name: AgentName;

  execute(opts: {
    cwd: string;
    prompt: string;
    tmux?: TmuxConfig;
    model?: string;

    // NEW: if provided, resume that conversation
    sessionId?: string;

    // NEW: tag for log naming / separation
    purpose?: "worker" | "commitReview" | "triage" | "designer";
  }): Promise<ExecutionResult>;
}
```

#### Adapter behavior requirements

For each adapter:

- If `opts.sessionId` is undefined:
  - start a new session
  - return `ExecutionResult.sessionId`
- If `opts.sessionId` is provided:
  - resume that session
  - return the same `sessionId`

The CLI flags and session-id extraction logic should reuse the existing knowledge in `src/lib/adapters/call.ts`.

#### Tmux + session id extraction

In tmux mode, stdout is written to `/tmp/<tmuxSession>/...log`. To return a session id:

- Ensure the underlying agent command runs in a machine-readable output mode (JSON/stream-json) that includes session/thread identifiers.
- After completion, parse the log to extract the session ID.

Special case: Claude can use a pre-generated session id passed to the CLI.

---

## Dispatcher State Changes

### 1) Persist worker + reviewer session ids

Extend plan state to persist session ids across loops:

- `workerSessionId?: string`
- `commitReviewSessionId?: string`

### 2) Separate review loops from worker failure retries

Current behavior blocks a plan if the same TODO is attempted 3 times consecutively.

With commit review gate, a TODO may be legitimately reopened by review. This must not be treated as “worker failed”.

Add:

- `commitReviewLoopCount?: number`

Dispatcher logic:

- If worker didn’t mark TODO `[x]`: this is a worker failure retry (existing `todoRetryCount`).
- If TODO was `[x]`, review runs, then review re-opens it (`[ ]`): increment `commitReviewLoopCount` and do **not** increment `todoRetryCount`.

If `commitReviewLoopCount >= maxLoops`, block plan with a clear error.

---

## Plan File Contract (Worker ↔ Reviewer)

### Reviewer outputs

If reviewer requests changes:

- Uncheck the TODO (`[x]` → `[ ]`).
- Add indented feedback under the TODO.
- Include a structured marker to make intent clear.

Recommended format:

```md
- [ ] <todo text>
  review: status=request_changes
  review: summary=<one line>
  review: details:
    - <bullet>
    - <bullet>
```

If reviewer approves:

- Leave TODO checked (`[x]`).
- Optionally annotate:

```md
- [x] <todo text>
  review: status=approved
  review: summary=LGTM
```

### Worker behavior

- Worker sees TODO context in prompts today (`renderWorkerPrompt()` includes `todo.context`).
- If `review: status=request_changes` is present, worker must address it before re-checking `[x]`.

---

## Commit Review Prompt

Add a new built-in prompt `commitReview`.

Reviewer prompt must include:

- Plan path and plan context (title, objective, success criteria, review focus)
- The current TODO text and its context

The reviewer agent has full access to the worktree and may run commands (including `git diff`) if needed. prloom does not inject diffs into the prompt by default.
Reviewer instructions must be strict and low-noise:

- Request changes only for:
  - unmet success criteria
  - incomplete TODO outcome
  - clear correctness/security issues
  - missing or failing required checks
- Avoid style-only or speculative nitpicks.

The reviewer communicates exclusively by **editing the plan file** (same contract as the worker). There is no separate structured output artifact; the plan is the shared interface.

---

## Configuration

Add a new config block (global + preset + per-worktree override supported):

```json
{
  "commitReview": {
    "enabled": false,
    "maxLoops": 2,
    "requireManualResume": false,
    "agent": "opencode",
    "model": "gpt-5-mini"
  }
}
```

Semantics:

- `enabled`: enable commit review gate.
- `maxLoops`: max review → fix cycles per TODO before blocking.
- `requireManualResume`: pause the dispatcher after each commit until manually resumed.
- `agent` / `model`: reviewer agent selection (independent from worker).

Note: commit review uses the dispatcher’s existing tmux behavior (same as worker). There is no per-feature tmux toggle.

Add a sessions toggle (optional but recommended):

```json
{
  "sessions": {
    "enabled": true
  }
}
```

If `sessions.enabled` is false, prloom runs in current ephemeral mode.

---

## Detailed Execution Flow (One TODO)

1. Find next unchecked TODO.
2. Run `beforeTodo` hooks.
3. Run worker agent:
   - `adapter.execute(..., sessionId: ps.workerSessionId)`
   - persist returned `ExecutionResult.sessionId` to `ps.workerSessionId`
4. Re-parse plan:
   - If TODO still unchecked: existing worker retry logic applies.
   - If TODO is checked:
     - If commit review disabled: proceed to approval path.
     - If enabled:
       1) Run commit review agent:
          - `adapter.execute(..., sessionId: ps.commitReviewSessionId)`
          - persist returned session id
       2) Re-parse plan:
          - If TODO remains `[x]`: approved
          - If TODO becomes `[ ]`: requested changes
             - increment `commitReviewLoopCount`
             - if exceeds `maxLoops`: block
             - else: continue loop; worker resumes with same session id
5. After approval:
   - Run `afterTodo` hooks once (pre-commit).
   - Commit and push.
   - If `requireManualResume` is true and more TODOs remain, set status to `paused`.

---

## Testing Plan (TDD)

Add tests that cover:

1. Commit review disabled: current behavior unchanged.
2. Commit review enabled + approve:
   - reviewer runs between worker completion and commit
   - `afterTodo` hooks run once
3. Commit review requests changes:
   - reviewer unchecks TODO and adds feedback
   - no commit is created
   - worker is re-run and receives feedback in prompt context
   - `todoRetryCount` does not increment; `commitReviewLoopCount` increments
4. Max loops reached: plan is blocked with clear error.
5. Session reuse plumbing:
   - dispatcher passes `sessionId` back into adapter.execute on subsequent runs

Mocking policy: only mock external services (GitHub API, filesystem via temp dirs, tmux/shell adapter boundaries). Do not mock internal modules.

---
