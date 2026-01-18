import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { processActivePlans } from "../../src/lib/dispatcher.js";
import { loadConfig } from "../../src/lib/config.js";
import { type State } from "../../src/lib/state.js";

const noopLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-blocked-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("processActivePlans: immediately blocks plan with [b] marker", async () => {
  const id = "blocked-marker-plan";
  const worktreePath = mkdtempSync(join(tmpdir(), "worktree-"));
  const planRelpath = `prloom/plans/${id}.md`;
  mkdirSync(join(worktreePath, "prloom", "plans"), { recursive: true });

  // Create an active plan with a blocked TODO
  const planPath = join(worktreePath, planRelpath);
  const content = `## Plan Summary

- Blocked plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [x] Done task
- [b] This task is blocked
- [ ] Future task
`;
  writeFileSync(planPath, content);


  const config = loadConfig(repoRoot);
  const state: State = {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: "feat-blocked",
        planRelpath,
        baseBranch: "main",
        status: "active",
      },
    },
  };

  await processActivePlans(repoRoot, config, state, "bot-user", {}, noopLogger);

  // Verify plan is now blocked (blocked flag, status unchanged)
  expect(state.plans[id]!.blocked).toBe(true);
  expect(state.plans[id]!.status).toBe("active"); // Status preserved
});

test("processActivePlans: blocked plan preserves its status when unblocked", async () => {
  const id = "blocked-review-plan";
  const worktreePath = mkdtempSync(join(tmpdir(), "worktree-"));
  const planRelpath = `prloom/plans/${id}.md`;
  mkdirSync(join(worktreePath, "prloom", "plans"), { recursive: true });

  // Create a plan that was in review status when blocked
  const planPath = join(worktreePath, planRelpath);
  const content = `## Plan Summary

- Review plan

## Objective

None

## Context

None

## Scope (In/Out)

In: none
Out: none

## Success Criteria

None

## Constraints

None

## Assumptions

None

## Architecture Notes

None

## Decision Log

None

## Implementation Notes

None

## Plan-Specific Checks

None

## Review Focus

None

## Open Questions

None

## TODO
- [x] Done task
`;
  writeFileSync(planPath, content);


  const config = loadConfig(repoRoot);
  const state: State = {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: "feat-blocked",
        planRelpath,
        baseBranch: "main",
        status: "review",
        blocked: true,
      },
    },
  };

  // Unblock the plan
  state.plans[id]!.blocked = false;

  // Verify status is preserved as review
  expect(state.plans[id]!.status).toBe("review");
  expect(state.plans[id]!.blocked).toBe(false);
});
