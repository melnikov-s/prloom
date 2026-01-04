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

  expect(config.worktrees_dir).toBe(".swarm/worktrees");
  expect(config.poll_interval_ms).toBe(60000);
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
  expect(config.poll_interval_ms).toBe(60000); // default
});

test("resolveWorktreesDir resolves relative path", () => {
  const config = {
    agents: { default: "opencode" as const },
    worktrees_dir: "../worktrees",
    poll_interval_ms: 60000,
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
  writeFileSync(
    join(TEST_DIR, "swarm.config.json"),
    JSON.stringify({
      agents: {
        default: "claude",
        designer: "codex",
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("claude");
  expect(config.agents.designer).toBe("codex");
});

test("loadConfig ignores invalid agent names", () => {
  writeFileSync(
    join(TEST_DIR, "swarm.config.json"),
    JSON.stringify({
      agents: {
        default: "invalid-agent",
        designer: "codex",
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  // Falls back to default since "invalid-agent" isn't valid
  expect(config.agents.default).toBe("opencode");
  expect(config.agents.designer).toBe("codex");
});
