import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  acquireLock,
  releaseLock,
  loadState,
  saveState,
  saveShard,
  loadShard,
  type State,
  type PlanState,
} from "../../src/lib/state.js";

const TEST_DIR = "/tmp/swarm-test-state";

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
        session_id: "abc123",
        worktree: "/path/to/worktree",
        branch: "test-plan-xyz",
        paused: false,
        next_todo: 2,
      },
    },
  };

  saveState(TEST_DIR, state);
  const loaded = loadState(TEST_DIR);

  expect(loaded.control_cursor).toBe(100);
  expect(loaded.plans["test-plan"]?.session_id).toBe("abc123");
  expect(loaded.plans["test-plan"]?.next_todo).toBe(2);
});

test("acquireLock creates lock file", () => {
  acquireLock(TEST_DIR);

  const lockPath = join(TEST_DIR, ".swarm", "lock");
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

  const lockPath = join(TEST_DIR, ".swarm", "lock");
  expect(existsSync(lockPath)).toBe(false);
});

test("saveShard and loadShard round-trip", () => {
  const ps: PlanState = {
    session_id: "sess123",
    worktree: "/wt",
    branch: "feat-x",
    paused: true,
    next_todo: 1,
  };

  saveShard(TEST_DIR, "my-plan", ps);
  const loaded = loadShard(TEST_DIR, "my-plan");

  expect(loaded?.session_id).toBe("sess123");
  expect(loaded?.paused).toBe(true);
});

test("loadShard returns null for missing shard", () => {
  const loaded = loadShard(TEST_DIR, "nonexistent");
  expect(loaded).toBeNull();
});
