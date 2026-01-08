import { test, expect } from "bun:test";
import { type State, type PlanState } from "../../src/lib/state.js";
import type { ActivatedPlanState } from "../../src/lib/dispatcher.js";

test("State type accepts 'triaging' status", () => {
  const state: State = {
    control_cursor: 0,
    plans: {
      "test-plan": {
        status: "triaging",
        worktree: "/path/to/worktree",
        branch: "test-branch",
        planRelpath: "prloom/plans/test.md",
        baseBranch: "main",
      },
    },
  };

  expect(state.plans["test-plan"]?.status).toBe("triaging");
});

test("ActivatedPlanState type accepts 'triaging' status", () => {
  const planState: ActivatedPlanState = {
    status: "triaging",
    worktree: "/path/to/worktree",
    branch: "test-branch",
    planRelpath: "prloom/plans/test.md",
    baseBranch: "main",
  };

  expect(planState.status).toBe("triaging");
});

test("PlanState allows all valid status values including 'triaging'", () => {
  const validStatuses: PlanState["status"][] = [
    "draft",
    "queued",
    "active",
    "blocked",
    "review",
    "reviewing",
    "triaging",
    "done",
  ];

  // If this compiles, the test passes - we're verifying type safety
  validStatuses.forEach((status) => {
    const planState: PlanState = { status };
    expect(planState.status).toBe(status);
  });
});
