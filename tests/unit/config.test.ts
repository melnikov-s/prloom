import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig, resolveWorktreesDir, getAgentConfig } from "../../src/lib/config.js";

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
    agents: { default: { agent: "opencode" as const } },
    worktrees_dir: "../worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
  };
  const resolved = resolveWorktreesDir("/repo/root", config);

  expect(resolved).toBe("/repo/worktrees");
});

test("loadConfig returns default agents when not specified", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.agents.default.agent).toBe("opencode");
  expect(config.agents.designer).toBeUndefined();
});

test("loadConfig reads agents from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: { agent: "claude" },
        designer: { agent: "codex" },
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default.agent).toBe("claude");
  expect(config.agents.designer?.agent).toBe("codex");
});

test("loadConfig ignores invalid agent names", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: { agent: "invalid-agent" },
        designer: { agent: "codex" },
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  // Falls back to default since "invalid-agent" isn't valid
  expect(config.agents.default.agent).toBe("opencode");
  expect(config.agents.designer?.agent).toBe("codex");
});

test("loadConfig reads agent model from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: { agent: "opencode", model: "gpt-4" },
        reviewer: { agent: "claude", model: "claude-sonnet-4-20250514" },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default.agent).toBe("opencode");
  expect(config.agents.default.model).toBe("gpt-4");
  expect(config.agents.reviewer?.agent).toBe("claude");
  expect(config.agents.reviewer?.model).toBe("claude-sonnet-4-20250514");
});

test("getAgentConfig returns stage config or falls back to default", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: { agent: "opencode", model: "gpt-4" },
        reviewer: { agent: "claude", model: "claude-sonnet-4-20250514" },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  // Reviewer is configured
  const reviewerConfig = getAgentConfig(config, "reviewer");
  expect(reviewerConfig.agent).toBe("claude");
  expect(reviewerConfig.model).toBe("claude-sonnet-4-20250514");

  // Worker is not configured, falls back to default
  const workerConfig = getAgentConfig(config, "worker");
  expect(workerConfig.agent).toBe("opencode");
  expect(workerConfig.model).toBe("gpt-4");
});
