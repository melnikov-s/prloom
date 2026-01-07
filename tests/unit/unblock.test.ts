import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadState,
  saveState,
  type State,
  type PlanState,
} from "../../src/lib/state.js";

const TEST_DIR = "/tmp/prloom-test-unblock";

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "prloom", ".local"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("saveState persists retry counters", () => {
  const state: State = {
    control_cursor: 0,
    plans: {
      "test-plan": {
        worktree: "/path/to/worktree",
        branch: "test-branch",
        planRelpath: "prloom/plans/test-plan.md",
        baseBranch: "main",
        status: "active",
        lastTodoIndex: 2,
        todoRetryCount: 5,
      },
    },
    inbox: {},
  };

  saveState(TEST_DIR, state);
  const loaded = loadState(TEST_DIR);

  expect(loaded.plans["test-plan"]?.lastTodoIndex).toBe(2);
  expect(loaded.plans["test-plan"]?.todoRetryCount).toBe(5);
});

test("saveState with undefined retry counters clears them", () => {
  // First save with counters
  const stateWithCounters: State = {
    control_cursor: 0,
    plans: {
      "test-plan": {
        worktree: "/path/to/worktree",
        branch: "test-branch",
        planRelpath: "prloom/plans/test-plan.md",
        baseBranch: "main",
        status: "active",
        lastTodoIndex: 2,
        todoRetryCount: 5,
      },
    },
    inbox: {},
  };
  saveState(TEST_DIR, stateWithCounters);

  // Then save with counters reset
  const stateReset: State = {
    control_cursor: 0,
    plans: {
      "test-plan": {
        worktree: "/path/to/worktree",
        branch: "test-branch",
        planRelpath: "prloom/plans/test-plan.md",
        baseBranch: "main",
        status: "active",
        lastTodoIndex: undefined,
        todoRetryCount: undefined,
      },
    },
    inbox: {},
  };
  saveState(TEST_DIR, stateReset);

  const loaded = loadState(TEST_DIR);
  expect(loaded.plans["test-plan"]?.lastTodoIndex).toBeUndefined();
  expect(loaded.plans["test-plan"]?.todoRetryCount).toBeUndefined();
});

test("loadState returns empty state when file missing", () => {
  const emptyDir = "/tmp/prloom-test-empty-" + Date.now();
  mkdirSync(emptyDir, { recursive: true });

  const state = loadState(emptyDir);

  expect(state.control_cursor).toBe(0);
  expect(Object.keys(state.plans)).toHaveLength(0);

  rmSync(emptyDir, { recursive: true, force: true });
});
