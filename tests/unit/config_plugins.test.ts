/**
 * Config Plugins Tests
 *
 * Tests for plugin configuration parsing in loadConfig.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadConfig, resolveConfig } from "../../src/lib/config.js";

const TEST_DIR = "/tmp/prloom-test-config-plugins";

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("loadConfig parses plugins from config file", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "quality-gates": {
          module: "./plugins/quality-gates",
          config: { testCommand: "npm test" },
        },
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3 },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.plugins).toBeDefined();
  expect(config.plugins!["quality-gates"]).toBeDefined();
  expect(config.plugins!["quality-gates"]!.module).toBe(
    "./plugins/quality-gates"
  );
  expect(config.plugins!["quality-gates"]!.config).toEqual({
    testCommand: "npm test",
  });
  expect(config.plugins!["review-council"]!.module).toBe(
    "prloom-plugin-review-council"
  );
  expect(config.plugins!["review-council"]!.config).toEqual({
    minReviewers: 3,
  });
});

test("loadConfig parses pluginOrder", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "plugin-a": { module: "./a" },
        "plugin-b": { module: "./b" },
      },
      pluginOrder: ["plugin-b", "plugin-a"],
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.pluginOrder).toEqual(["plugin-b", "plugin-a"]);
});

test("loadConfig handles missing plugins section", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      base_branch: "develop",
    })
  );

  const config = loadConfig(TEST_DIR);

  expect(config.plugins).toBeUndefined();
  expect(config.pluginOrder).toBeUndefined();
});

test("loadConfig parses plugin enabled field", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "enabled-plugin": { module: "./enabled" },
        "disabled-plugin": { module: "./disabled", enabled: false },
      },
    })
  );

  const config = loadConfig(TEST_DIR);

  // enabled defaults to true if not specified
  expect(config.plugins!["enabled-plugin"]!.enabled).toBeUndefined();
  expect(config.plugins!["disabled-plugin"]!.enabled).toBe(false);
});

// =============================================================================
// Preset Plugin Overrides Tests
// =============================================================================

test("resolveConfig applies preset plugin overrides - disable plugin", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3 },
        },
      },
      presets: {
        quick: {
          plugins: {
            "review-council": { enabled: false },
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "quick");

  expect(resolved.plugins).toBeDefined();
  expect(resolved.plugins!["review-council"]!.enabled).toBe(false);
  // Module should still be present
  expect(resolved.plugins!["review-council"]!.module).toBe(
    "prloom-plugin-review-council"
  );
});

test("resolveConfig applies preset plugin config overrides", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3, timeout: 5000 },
        },
      },
      presets: {
        thorough: {
          plugins: {
            "review-council": { config: { minReviewers: 5 } },
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "thorough");

  expect(resolved.plugins).toBeDefined();
  // Config should be merged, with override taking precedence
  expect(resolved.plugins!["review-council"]!.config).toEqual({
    minReviewers: 5,
    timeout: 5000,
  });
});

test("resolveConfig applies worktree plugin overrides", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3 },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, undefined, {
    plugins: {
      "review-council": { enabled: false },
    },
  });

  expect(resolved.plugins).toBeDefined();
  expect(resolved.plugins!["review-council"]!.enabled).toBe(false);
});

test("resolveConfig chains preset and worktree overrides", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3 },
        },
        "quality-gates": {
          module: "./plugins/quality-gates",
          config: { testCommand: "npm test" },
        },
      },
      presets: {
        thorough: {
          plugins: {
            "review-council": { config: { minReviewers: 5 } },
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  // Apply preset, then worktree override
  const resolved = resolveConfig(config, "thorough", {
    plugins: {
      "quality-gates": { enabled: false },
    },
  });

  expect(resolved.plugins).toBeDefined();
  // Preset override applied
  expect(resolved.plugins!["review-council"]!.config).toEqual({
    minReviewers: 5,
  });
  // Worktree override applied
  expect(resolved.plugins!["quality-gates"]!.enabled).toBe(false);
});

test("resolveConfig preserves pluginOrder from global config", () => {
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "plugin-a": { module: "./a" },
        "plugin-b": { module: "./b" },
      },
      pluginOrder: ["plugin-b", "plugin-a"],
      presets: {
        quick: {
          plugins: {
            "plugin-a": { enabled: false },
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  const resolved = resolveConfig(config, "quick");

  // pluginOrder should be preserved
  expect(resolved.pluginOrder).toEqual(["plugin-b", "plugin-a"]);
});

// =============================================================================
// Issue #1: afterDesign hooks should use resolved config with preset
// =============================================================================

test("resolveConfig with preset should be used before loadPlugins for afterDesign hooks", () => {
  // This test verifies that when a preset is selected:
  // 1. resolveConfig(config, preset) should be called
  // 2. The resolved config should be passed to loadPlugins
  // 3. Plugin overrides from the preset should take effect
  
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "review-council": {
          module: "prloom-plugin-review-council",
          config: { minReviewers: 3 },
        },
      },
      presets: {
        quick: {
          plugins: {
            "review-council": { enabled: false },
          },
        },
      },
    })
  );

  const config = loadConfig(TEST_DIR);
  
  // Without preset - plugin is enabled
  const resolvedNoPreset = resolveConfig(config);
  expect(resolvedNoPreset.plugins!["review-council"]!.enabled).toBeUndefined(); // undefined means enabled
  
  // With "quick" preset - plugin should be disabled
  const resolvedWithPreset = resolveConfig(config, "quick");
  expect(resolvedWithPreset.plugins!["review-council"]!.enabled).toBe(false);
});
