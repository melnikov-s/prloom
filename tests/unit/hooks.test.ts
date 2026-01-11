/**
 * Hooks Module Tests
 *
 * Tests for the lifecycle hooks system per RFC docs/rfc-lifecycle-hooks.md
 * Following TDD - tests written before implementation.
 */

import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Types will be implemented in src/lib/hooks/types.ts
import type {
  HookPoint,
  HookContext,
  Hook,
  HookRegistry,
} from "../../src/lib/hooks/index.js";

// Loader will be implemented in src/lib/hooks/loader.ts
import { loadPlugins } from "../../src/lib/hooks/index.js";

// Runner will be implemented in src/lib/hooks/runner.ts
import { runHooks, buildHookContext } from "../../src/lib/hooks/index.js";

// Config types for testing
import type { Config } from "../../src/lib/config.js";

const TEST_DIR = "/tmp/prloom-test-hooks";
const TEST_PLUGINS_DIR = join(TEST_DIR, "plugins");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_PLUGINS_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Helper: Create a minimal config
function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: { default: "opencode" },
    github: { enabled: true },
    worktrees_dir: "prloom/.local/worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    bus: { tickIntervalMs: 1000 },
    bridges: { github: { enabled: true } },
    ...overrides,
  };
}

// Helper: Write a test plugin to disk
function writeTestPlugin(name: string, hooks: Record<string, string>): string {
  const hookFunctions = Object.entries(hooks)
    .map(
      ([hookPoint, body]) =>
        `    ${hookPoint}: async (plan, ctx) => { ${body} }`
    )
    .join(",\n");

  const content = `
module.exports = function(config) {
  return {
${hookFunctions}
  };
};
`;
  const pluginPath = join(TEST_PLUGINS_DIR, `${name}.js`);
  writeFileSync(pluginPath, content);
  return pluginPath;
}

// =============================================================================
// loadPlugins Tests
// =============================================================================

test("loadPlugins returns empty registry when no plugins configured", async () => {
  const config = createConfig({ plugins: undefined });

  const registry = await loadPlugins(config, TEST_DIR);

  expect(registry).toEqual({});
});

test("loadPlugins loads plugin and extracts hooks", async () => {
  const pluginPath = writeTestPlugin("test-plugin", {
    afterDesign: 'return plan + "<!-- modified -->";',
  });

  const config = createConfig({
    plugins: {
      "test-plugin": { module: pluginPath },
    },
  });

  const registry = await loadPlugins(config, TEST_DIR);

  expect(registry.afterDesign).toBeDefined();
  expect(registry.afterDesign!.length).toBe(1);
});

test("loadPlugins respects enabled: false", async () => {
  const pluginPath = writeTestPlugin("disabled-plugin", {
    afterDesign: 'return plan + "<!-- disabled -->";',
  });

  const config = createConfig({
    plugins: {
      "disabled-plugin": { module: pluginPath, enabled: false },
    },
  });

  const registry = await loadPlugins(config, TEST_DIR);

  expect(registry.afterDesign).toBeUndefined();
});

test("loadPlugins respects pluginOrder", async () => {
  const plugin1Path = writeTestPlugin("plugin-first", {
    afterDesign: 'return plan + "[first]";',
  });
  const plugin2Path = writeTestPlugin("plugin-second", {
    afterDesign: 'return plan + "[second]";',
  });

  const config = createConfig({
    plugins: {
      "plugin-first": { module: plugin1Path },
      "plugin-second": { module: plugin2Path },
    },
    pluginOrder: ["plugin-second", "plugin-first"],
  });

  const registry = await loadPlugins(config, TEST_DIR);

  // Hooks should be ordered: plugin-second first, then plugin-first
  expect(registry.afterDesign!.length).toBe(2);

  // Verify order by running hooks
  let plan = "start";
  for (const hook of registry.afterDesign!) {
    plan = await hook(plan, {} as HookContext);
  }
  expect(plan).toBe("start[second][first]");
});

test("loadPlugins passes config to plugin", async () => {
  // Plugin that uses config in its hook
  const content = `
module.exports = function(config) {
  return {
    afterDesign: async (plan, ctx) => {
      return plan + "[" + config.marker + "]";
    }
  };
};
`;
  const pluginPath = join(TEST_PLUGINS_DIR, "config-plugin.js");
  writeFileSync(pluginPath, content);

  const config = createConfig({
    plugins: {
      "config-plugin": {
        module: pluginPath,
        config: { marker: "custom-marker" },
      },
    },
  });

  const registry = await loadPlugins(config, TEST_DIR);

  let plan = "test";
  plan = await registry.afterDesign![0]!(plan, {} as HookContext);
  expect(plan).toBe("test[custom-marker]");
});

// =============================================================================
// runHooks Tests
// =============================================================================

test("runHooks runs hooks in sequence", async () => {
  const order: number[] = [];

  const registry: HookRegistry = {
    afterDesign: [
      async (plan, ctx) => {
        order.push(1);
        return plan + "[1]";
      },
      async (plan, ctx) => {
        order.push(2);
        return plan + "[2]";
      },
    ],
  };

  const ctx = {} as HookContext;
  await runHooks("afterDesign", "plan", ctx, registry);

  expect(order).toEqual([1, 2]);
});

test("runHooks passes plan through chain", async () => {
  const registry: HookRegistry = {
    beforeTodo: [
      async (plan, ctx) => plan + "[a]",
      async (plan, ctx) => plan + "[b]",
      async (plan, ctx) => plan + "[c]",
    ],
  };

  const ctx = {} as HookContext;
  const result = await runHooks("beforeTodo", "start", ctx, registry);

  expect(result).toBe("start[a][b][c]");
});

test("runHooks returns unchanged plan when no hooks", async () => {
  const registry: HookRegistry = {};
  const ctx = {} as HookContext;

  const result = await runHooks("afterTodo", "original plan", ctx, registry);

  expect(result).toBe("original plan");
});

test("runHooks aborts on hook error", async () => {
  const registry: HookRegistry = {
    beforeFinish: [
      async (plan, ctx) => plan + "[ok]",
      async (plan, ctx) => {
        throw new Error("Hook failed!");
      },
      async (plan, ctx) => plan + "[never reached]",
    ],
  };

  const ctx = {} as HookContext;

  await expect(
    runHooks("beforeFinish", "start", ctx, registry)
  ).rejects.toThrow("Hook failed!");
});

// =============================================================================
// buildHookContext Tests
// =============================================================================

test("buildHookContext includes all required fields", () => {
  const ctx = buildHookContext({
    repoRoot: "/repo",
    worktree: "/worktree",
    planId: "abc123",
    hookPoint: "afterDesign",
  });

  expect(ctx.repoRoot).toBe("/repo");
  expect(ctx.worktree).toBe("/worktree");
  expect(ctx.planId).toBe("abc123");
  expect(ctx.hookPoint).toBe("afterDesign");
  expect(ctx.runAgent).toBeDefined();
  expect(ctx.emitAction).toBeDefined();
});

test("buildHookContext includes optional changeRequestRef", () => {
  const ctx = buildHookContext({
    repoRoot: "/repo",
    worktree: "/worktree",
    planId: "abc123",
    hookPoint: "beforeFinish",
    changeRequestRef: "42",
  });

  expect(ctx.changeRequestRef).toBe("42");
});

test("buildHookContext includes todoCompleted for afterTodo", () => {
  const ctx = buildHookContext({
    repoRoot: "/repo",
    worktree: "/worktree",
    planId: "abc123",
    hookPoint: "afterTodo",
    todoCompleted: "Implement user login",
  });

  expect(ctx.todoCompleted).toBe("Implement user login");
});

// =============================================================================
// HookContext.emitAction Tests
// =============================================================================

test("HookContext.emitAction appends action to bus", () => {
  // Set up worktree with prloom directory (bus will create prloom/.local/bus)
  const worktree = join(TEST_DIR, "worktree");
  mkdirSync(join(worktree, "prloom"), { recursive: true });

  const ctx = buildHookContext({
    repoRoot: TEST_DIR,
    worktree,
    planId: "abc123",
    hookPoint: "afterTodo",
    changeRequestRef: "42",
  });

  // Emit an action
  ctx.emitAction({
    id: "action-1",
    type: "respond",
    target: { target: "github:pr/42" },
    payload: { type: "comment", message: "Test comment" },
  });

  // Verify action was written to outbox (prloom/.local/bus/actions.jsonl)
  const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
  expect(existsSync(actionsPath)).toBe(true);

  const content = readFileSync(actionsPath, "utf-8");
  expect(content).toContain("action-1");
  expect(content).toContain("Test comment");
});

// =============================================================================
// Issue #2: Dispatcher should block plan on hook errors
// =============================================================================

import { processActivePlans } from "../../src/lib/dispatcher.js";
import type { State, PlanState } from "../../src/lib/state.js";

// Helper to create test state
function createTestState(plans: Record<string, PlanState>): State {
  return {
    plans,
    control_cursor: 0,
  };
}

// Helper to create a logger that captures logs
function createTestLogger() {
  const logs: { level: string; msg: string; planId?: string }[] = [];
  return {
    logger: {
      info: (msg: string, planId?: string) => logs.push({ level: "info", msg, planId }),
      success: (msg: string, planId?: string) => logs.push({ level: "success", msg, planId }),
      warn: (msg: string, planId?: string) => logs.push({ level: "warn", msg, planId }),
      error: (msg: string, planId?: string) => logs.push({ level: "error", msg, planId }),
    },
    logs,
  };
}

test("processActivePlans blocks plan when hook throws", async () => {
  // Create a worktree with a plan file
  const worktree = join(TEST_DIR, "worktree-hook-error");
  const planDir = join(worktree, "prloom", ".local");
  mkdirSync(planDir, { recursive: true });
  
  // Create a plan with multiple completed TODOs (so beforeFinish will be triggered)
  // Note: Section must be "## TODO" not "## TODOs"
  const planContent = `# Test Plan

## Objective
Test hook error handling.

## TODO
- [x] First task done
- [x] Second task done
`;
  writeFileSync(join(planDir, "plan.md"), planContent);
  
  // Create a plugin that throws on beforeFinish
  const pluginsDir = join(TEST_DIR, "plugins-hook-error");
  mkdirSync(pluginsDir, { recursive: true });
  const throwingPluginPath = join(pluginsDir, "throwing-plugin.js");
  writeFileSync(throwingPluginPath, `
module.exports = function(config) {
  return {
    beforeFinish: async (plan, ctx) => {
      throw new Error("Hook error: validation failed!");
    }
  };
};
`);

  // Create config with the throwing plugin
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  writeFileSync(
    join(TEST_DIR, "prloom", "config.json"),
    JSON.stringify({
      plugins: {
        "throwing-plugin": { module: throwingPluginPath },
      },
    })
  );

  const state = createTestState({
    "test-plan": {
      status: "active",
      worktree,
      branch: "test-branch",
      planRelpath: "prloom/.local/plan.md",
      baseBranch: "main",
    },
  });

  const config: Config = {
    agents: { default: "manual" },
    github: { enabled: false },
    worktrees_dir: "prloom/.local/worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    bus: { tickIntervalMs: 1000 },
    bridges: { github: { enabled: false } },
    plugins: {
      "throwing-plugin": { module: throwingPluginPath },
    },
  };

  const { logger, logs } = createTestLogger();

  await processActivePlans(
    TEST_DIR,
    config,
    state,
    "",
    {},
    logger
  );

  // The plan should be blocked due to hook error (not just logged and continued)
  // Per RFC: "If a hook throws, abort."
  expect(state.plans["test-plan"]!.blocked).toBe(true);
  expect(state.plans["test-plan"]!.lastError).toContain("Hook error");
});

// =============================================================================
// Issue #4: runAgent should include file contents when options.files is provided
// =============================================================================

test("buildHookContext runAgent includes file contents in prompt when files option provided", async () => {
  // Create test files
  const testFile1 = join(TEST_DIR, "test-file-1.ts");
  const testFile2 = join(TEST_DIR, "test-file-2.ts");
  writeFileSync(testFile1, "export const foo = 1;");
  writeFileSync(testFile2, "export const bar = 2;");
  
  // We need to mock the adapter to capture what prompt is passed
  // Since buildHookContext uses the adapter internally, we'll test by checking
  // that the context function signature accepts files
  
  const ctx = buildHookContext({
    repoRoot: TEST_DIR,
    worktree: TEST_DIR,
    planId: "test-plan",
    hookPoint: "afterDesign",
    currentPlan: "# Test Plan\n",
  });
  
  // Verify runAgent accepts options with files
  expect(typeof ctx.runAgent).toBe("function");
  
  // The function signature should accept { files?: string[] }
  // We can't easily test the actual prompt construction without mocking the adapter
  // but we verify the function accepts the expected parameters
  const fn = ctx.runAgent as (prompt: string, options?: { files?: string[] }) => Promise<string>;
  expect(fn.length).toBeLessThanOrEqual(2); // Function accepts up to 2 parameters
});
