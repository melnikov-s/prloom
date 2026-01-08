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
const WORKTREE_DIR = join(TEST_DIR, "prloom/.local/worktrees/test-plan-xyz");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(WORKTREE_DIR, "prloom", ".local"), { recursive: true });
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
        worktree: WORKTREE_DIR,
        branch: "test-plan-xyz",
        planRelpath: "prloom/.local/test-plan.md",
        baseBranch: "develop",
        status: "active",
      },
    },
  };

  saveState(TEST_DIR, state);
  const loaded = loadState(TEST_DIR);

  // Note: control_cursor is not persisted in per-worktree storage, always 0
  expect(loaded.control_cursor).toBe(0);
  expect(loaded.plans["test-plan"]?.worktree).toBe(WORKTREE_DIR);
  expect(loaded.plans["test-plan"]?.planRelpath).toBe("prloom/.local/test-plan.md");
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
