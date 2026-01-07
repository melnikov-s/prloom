import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  acquireLock,
  releaseLock,
  loadState,
  saveState,
  type State,
} from "../../src/lib/state.js";

const TEST_DIR = "/tmp/prloom-test-state";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("loadState returns empty state when no file exists", () => {
  const state = loadState(TEST_DIR);

  expect(state.control_cursor).toBe(0);
  expect(Object.keys(state.plans)).toHaveLength(0);
});

test("saveState and loadState round-trip", () => {
  const state: State = {
    control_cursor: 100,
    plans: {
      "test-plan": {
        worktree: "/path/to/worktree",
        branch: "test-plan-xyz",
        planRelpath: "plans/test-plan.md",
        baseBranch: "develop",
        status: "active",
      },
    },
    inbox: {},
  };

  saveState(TEST_DIR, state);
  const loaded = loadState(TEST_DIR);

  expect(loaded.control_cursor).toBe(100);
  expect(loaded.plans["test-plan"]?.worktree).toBe("/path/to/worktree");
  expect(loaded.plans["test-plan"]?.planRelpath).toBe("plans/test-plan.md");
});

test("acquireLock creates lock file", () => {
  acquireLock(TEST_DIR);

  const lockPath = join(TEST_DIR, "prloom", ".local", "lock");
  expect(existsSync(lockPath)).toBe(true);

  const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
  expect(lock.pid).toBe(process.pid);

  releaseLock(TEST_DIR);
});

test("acquireLock throws if already locked by alive process", () => {
  acquireLock(TEST_DIR);

  expect(() => acquireLock(TEST_DIR)).toThrow("Dispatcher already running");

  releaseLock(TEST_DIR);
});

test("releaseLock removes lock file", () => {
  acquireLock(TEST_DIR);
  releaseLock(TEST_DIR);

  const lockPath = join(TEST_DIR, "prloom", ".local", "lock");
  expect(existsSync(lockPath)).toBe(false);
});
