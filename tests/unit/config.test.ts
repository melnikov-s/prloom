import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig, resolveWorktreesDir } from "../../src/lib/config.js";

const TEST_DIR = "/tmp/prloom-test-config";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("loadConfig returns defaults when no config file exists", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("prloom/.local/worktrees");
  expect(config.github_poll_interval_ms).toBe(60000);
  expect(config.base_branch).toBe("main");
});

test("loadConfig reads values from prloom/config.json", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      worktrees_dir: "/custom/path",
      github_poll_interval_ms: 10000,
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("/custom/path");
  expect(config.github_poll_interval_ms).toBe(10000);
  expect(config.base_branch).toBe("develop");
});

test("loadConfig uses defaults for missing fields", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({ worktrees_dir: "/custom", base_branch: "develop" })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.worktrees_dir).toBe("/custom");
  expect(config.github_poll_interval_ms).toBe(60000); // default
  expect(config.base_branch).toBe("develop");
});

test("resolveWorktreesDir resolves relative path", () => {
  const config = {
    agents: { default: "opencode" as const },
    worktrees_dir: "../worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
  };
  const resolved = resolveWorktreesDir("/repo/root", config);

  expect(resolved).toBe("/repo/worktrees");
});

test("loadConfig returns default agents when not specified", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("opencode");
  expect(config.agents.designer).toBeUndefined();
});

test("loadConfig reads agents from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "claude",
        designer: "codex",
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("claude");
  expect(config.agents.designer).toBe("codex");
});

test("loadConfig ignores invalid agent names", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "invalid-agent",
        designer: "codex",
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  // Falls back to default since "invalid-agent" isn't valid
  expect(config.agents.default).toBe("opencode");
  expect(config.agents.designer).toBe("codex");
});
