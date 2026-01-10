import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  resolveConfig,
  deepMerge,
  getPresetNames,
  loadWorktreeConfig,
  writeWorktreeConfig,
} from "../../src/lib/config.js";

const TEST_DIR = "/tmp/prloom-test-config-presets";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================================
// deepMerge tests
// ============================================================================

test("deepMerge merges flat objects", () => {
  const a = { foo: 1, bar: 2 };
  const b = { bar: 3, baz: 4 };
  const result = deepMerge(a, b);

  expect(result).toEqual({ foo: 1, bar: 3, baz: 4 });
});

test("deepMerge handles nested objects", () => {
  const a = { outer: { inner: 1, keep: "yes" } };
  const b = { outer: { inner: 2 } };
  const result = deepMerge(a, b);

  expect(result).toEqual({ outer: { inner: 2, keep: "yes" } });
});

test("deepMerge handles undefined values", () => {
  const a = { foo: 1 };
  const b = undefined;
  const c = { bar: 2 };
  const result = deepMerge(a, b, c);

  expect(result).toEqual({ foo: 1, bar: 2 });
});

test("deepMerge replaces arrays (does not merge)", () => {
  const a = { items: [1, 2, 3] };
  const b = { items: [4, 5] };
  const result = deepMerge(a, b);

  expect(result).toEqual({ items: [4, 5] });
});

// ============================================================================
// getPresetNames tests
// ============================================================================

test("getPresetNames returns empty array when no presets", () => {
  const config = loadConfig(TEST_DIR);
  expect(getPresetNames(config)).toEqual([]);
});

test("getPresetNames returns preset names from config", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      presets: {
        default: {},
        quick: { github: { enabled: false } },
        thorough: {},
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const names = getPresetNames(config);

  expect(names).toContain("default");
  expect(names).toContain("quick");
  expect(names).toContain("thorough");
  expect(names.length).toBe(3);
});

// ============================================================================
// resolveConfig tests
// ============================================================================

test("resolveConfig returns global config when no preset or worktree config", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config);

  expect(resolved.base_branch).toBe("develop");
  expect(resolved.github.enabled).toBe(true); // default
});

test("resolveConfig applies preset overrides", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      github: { enabled: true },
      presets: {
        "local-only": {
          github: { enabled: false },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "local-only");

  expect(resolved.github.enabled).toBe(false);
});

test("resolveConfig applies worktree overrides on top of preset", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      github_poll_interval_ms: 60000,
      presets: {
        quick: {
          github_poll_interval_ms: 30000,
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const worktreeConfig = { github_poll_interval_ms: 10000 };
  const resolved = resolveConfig(config, "quick", worktreeConfig);

  // Worktree override takes precedence
  expect(resolved.github_poll_interval_ms).toBe(10000);
});

test("resolveConfig ignores missing preset name", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      base_branch: "main",
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "nonexistent");

  // Should use global config values
  expect(resolved.base_branch).toBe("main");
});

test("resolveConfig correctly merges nested agent config", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      agents: {
        default: "opencode",
        opencode: {
          default: "gpt-4",
        },
      },
      presets: {
        premium: {
          agents: {
            default: "claude",
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "premium");

  expect(resolved.agents.default).toBe("claude");
});

// ============================================================================
// loadWorktreeConfig and writeWorktreeConfig tests
// ============================================================================

test("loadWorktreeConfig returns empty object when no config file", () => {
  const worktreePath = join(TEST_DIR, "worktree1");
  mkdirSync(worktreePath, { recursive: true });

  const config = loadWorktreeConfig(worktreePath);
  expect(config).toEqual({});
});

test("loadWorktreeConfig reads config from worktree", () => {
  const worktreePath = join(TEST_DIR, "worktree2");
  mkdirSync(join(worktreePath, "prloom"), { recursive: true });
  writeFileSync(
    join(worktreePath, "prloom", "config.json"),
    JSON.stringify({
      github: { enabled: false },
      base_branch: "feature",
    })
  );

  const config = loadWorktreeConfig(worktreePath);
  expect(config.github?.enabled).toBe(false);
  expect(config.base_branch).toBe("feature");
});

test("writeWorktreeConfig creates config file", () => {
  const worktreePath = join(TEST_DIR, "worktree3");
  mkdirSync(worktreePath, { recursive: true });

  writeWorktreeConfig(worktreePath, {
    github: { enabled: false },
  });

  const config = loadWorktreeConfig(worktreePath);
  expect(config.github?.enabled).toBe(false);
});

// ============================================================================
// loadConfig github.enabled tests
// ============================================================================

test("loadConfig defaults github.enabled to true", () => {
  const config = loadConfig(TEST_DIR);
  expect(config.github.enabled).toBe(true);
});

test("loadConfig reads github.enabled from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      github: { enabled: false },
    })
  );

  const config = loadConfig(TEST_DIR);
  expect(config.github.enabled).toBe(false);
});

test("loadConfig parses presets from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      presets: {
        default: {},
        quick: { github: { enabled: false } },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  expect(config.presets).toBeDefined();
  expect(config.presets?.default).toEqual({});
  expect(config.presets?.quick?.github?.enabled).toBe(false);
});
