import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  resolveWorktreesDir,
  getAgentConfig,
} from "../../src/lib/config.js";

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
    github: { enabled: true },
    worktrees_dir: "../worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    bus: { tickIntervalMs: 1000 },
    bridges: { github: { enabled: true } },
  };
  const resolved = resolveWorktreesDir("/repo/root", config);

  expect(resolved).toBe("/repo/worktrees");
});

test("loadConfig returns default agents when not specified", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("opencode");
  expect(config.agents.opencode).toBeUndefined();
});

test("loadConfig reads agents from config file with new structure", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "claude",
        claude: {
          default: "sonnet",
          designer: "opus",
        },
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("claude");
  expect(config.agents.claude?.default).toBe("sonnet");
  expect(config.agents.claude?.designer).toBe("opus");
});

test("loadConfig ignores invalid agent names", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "invalid-agent",
        opencode: {
          default: "gpt-4",
        },
      },
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  // Falls back to default since "invalid-agent" isn't valid
  expect(config.agents.default).toBe("opencode");
  expect(config.agents.opencode?.default).toBe("gpt-4");
});

test("loadConfig reads agent models from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "opencode",
        opencode: {
          default: "gpt-4",
          triage: "claude-sonnet-4-20250514",
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.agents.default).toBe("opencode");
  expect(config.agents.opencode?.default).toBe("gpt-4");
  expect(config.agents.opencode?.triage).toBe("claude-sonnet-4-20250514");
});

test("getAgentConfig returns stage-specific model or falls back to default", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "opencode",
        opencode: {
          default: "gpt-4",
          triage: "claude-sonnet-4-20250514",
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  // Triage has specific model
  const triageConfig = getAgentConfig(config, "triage");
  expect(triageConfig.agent).toBe("opencode");
  expect(triageConfig.model).toBe("claude-sonnet-4-20250514");

  // Worker uses default model
  const workerConfig = getAgentConfig(config, "worker");
  expect(workerConfig.agent).toBe("opencode");
  expect(workerConfig.model).toBe("gpt-4");
});

test("getAgentConfig respects agent override parameter", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "opencode",
        opencode: {
          default: "gpt-4",
        },
        claude: {
          default: "sonnet",
          worker: "opus",
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  // Default agent (opencode)
  const defaultWorker = getAgentConfig(config, "worker");
  expect(defaultWorker.agent).toBe("opencode");
  expect(defaultWorker.model).toBe("gpt-4");

  // Override to claude
  const claudeWorker = getAgentConfig(config, "worker", "claude");
  expect(claudeWorker.agent).toBe("claude");
  expect(claudeWorker.model).toBe("opus");
});

// =============================================================================
// Bridge Configuration Tests
// =============================================================================

test("loadConfig reads bridges with pollIntervalMs", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      bridges: {
        github: {
          enabled: true,
          pollIntervalMs: 30000,
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const github = config.bridges.github;

  expect(github).toBeDefined();
  expect(github!.enabled).toBe(true);
  expect(github!.pollIntervalMs).toBe(30000);
});

test("loadConfig preserves all bridge config fields", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      bridges: {
        github: {
          enabled: true,
          pollIntervalMs: 45000,
          customField: "custom-value",
          nested: { key: "value" },
        },
        buildkite: {
          enabled: true,
          pollIntervalMs: 120000,
          module: "./bridges/buildkite.ts",
          orgSlug: "my-org",
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const github = config.bridges.github;
  const buildkite = config.bridges.buildkite;

  // GitHub bridge preserves all fields
  expect(github).toBeDefined();
  expect(github!.enabled).toBe(true);
  expect(github!.pollIntervalMs).toBe(45000);
  expect((github as any).customField).toBe("custom-value");
  expect((github as any).nested).toEqual({ key: "value" });

  // Buildkite bridge preserves all fields
  expect(buildkite).toBeDefined();
  expect(buildkite!.enabled).toBe(true);
  expect(buildkite!.pollIntervalMs).toBe(120000);
  expect(buildkite!.module).toBe("./bridges/buildkite.ts");
  expect((buildkite as any).orgSlug).toBe("my-org");
});

test("loadConfig defaults bridge enabled to true", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      bridges: {
        github: {
          pollIntervalMs: 30000,
          // enabled not specified - should default to true
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const github = config.bridges.github;

  expect(github).toBeDefined();
  expect(github!.enabled).toBe(true);
});

test("loadConfig respects bridge enabled=false", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      bridges: {
        github: {
          enabled: false,
          pollIntervalMs: 30000,
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const github = config.bridges.github;

  expect(github).toBeDefined();
  expect(github!.enabled).toBe(false);
  expect(github!.pollIntervalMs).toBe(30000);
});

test("loadConfig reads bus.tickIntervalMs", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      bus: {
        tickIntervalMs: 500,
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.bus.tickIntervalMs).toBe(500);
});

test("loadConfig defaults bus.tickIntervalMs to 1000", () => {
  const config = loadConfig(TEST_DIR);

  expect(config.bus.tickIntervalMs).toBe(1000);
});

test("loadConfig defaults bridges.github to enabled with 60s poll interval", () => {
  const config = loadConfig(TEST_DIR);
  const github = config.bridges.github;

  expect(github).toBeDefined();
  expect(github!.enabled).toBe(true);
  expect(github!.pollIntervalMs).toBe(60000);
});
