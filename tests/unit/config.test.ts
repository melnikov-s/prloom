import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, resolveWorktreesDir } from "../../src/lib/config.js";

const TEST_DIR = "/tmp/swarm-test-config";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("loadConfig returns defaults when no config file exists", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("../.swarm-worktrees");
  expect(config.poll_interval_ms).toBe(5000);
});

test("loadConfig reads values from swarm.config.json", () => {
  writeFileSync(
    join(TEST_DIR, "swarm.config.json"),
    JSON.stringify({
      worktrees_dir: "/custom/path",
      poll_interval_ms: 10000,
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("/custom/path");
  expect(config.poll_interval_ms).toBe(10000);
});

test("loadConfig uses defaults for missing fields", () => {
  writeFileSync(
    join(TEST_DIR, "swarm.config.json"),
    JSON.stringify({ worktrees_dir: "/custom" })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("/custom");
  expect(config.poll_interval_ms).toBe(5000); // default
});

test("resolveWorktreesDir resolves relative path", () => {
  const config = { worktrees_dir: "../worktrees", poll_interval_ms: 5000 };
  const resolved = resolveWorktreesDir("/repo/root", config);

  expect(resolved).toBe("/repo/worktrees");
});
