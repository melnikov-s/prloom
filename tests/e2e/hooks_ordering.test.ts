/**
 * E2E Test: Hooks Ordering
 *
 * Tests that lifecycle hooks run in the correct order:
 * - beforeTodo runs before the worker
 * - afterTodo runs after the worker completes
 * - beforeFinish runs before marking PR ready
 * - afterFinish runs after finishing
 *
 * Uses a trace file to verify ordering.
 *
 * See RFC: docs/e2e-tests.md
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, readFileSync } from "fs";

import {
  makeTempRepo,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  makeFakeBinaries,
  createTracePlugin,
  readTraceFile,
  type TempRepoResult,
} from "./harness.js";


import { ingestInboxPlans, processActivePlans } from "../../src/lib/dispatcher.js";
import { loadState } from "../../src/lib/state.js";
import { loadConfig, resolveWorktreesDir } from "../../src/lib/config.js";

let tempRepo: TempRepoResult;
let restoreEnv: () => void;

beforeEach(async () => {
  tempRepo = await makeTempRepo();
  makeFakeBinaries(tempRepo.binDir, tempRepo.stateDir);
  restoreEnv = applyEnvOverrides(tempRepo.envOverrides);
});

afterEach(() => {
  restoreEnv();
  tempRepo.cleanup();
});

test("hooks: beforeTodo → worker → afterTodo ordering", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugin directory and trace plugin
  const pluginsDir = join(repoRoot, "plugins", "e2e-hooks");
  const pluginPath = createTracePlugin(pluginsDir);

  // Configure with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "e2e-hooks": { module: pluginPath },
    },
  });

  const planId = "hooks-order-1";
  const planContent = buildPlanContent({
    title: "Hook Ordering Test",
    objective: "Test hook ordering.",
    todos: ["Single task to track"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  // Process TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Read trace file
  const traces = readTraceFile(worktreePath);

  // Extract hook names in order
  const hookOrder = traces.map((t) => t.hook);

  // Verify ordering: beforeTodo → worker → afterTodo → beforeFinish → afterFinish
  expect(hookOrder).toContain("beforeTodo");
  expect(hookOrder).toContain("worker");
  expect(hookOrder).toContain("afterTodo");
  expect(hookOrder).toContain("beforeFinish");
  expect(hookOrder).toContain("afterFinish");

  // Verify relative ordering
  const beforeTodoIdx = hookOrder.indexOf("beforeTodo");
  const workerIdx = hookOrder.indexOf("worker");
  const afterTodoIdx = hookOrder.indexOf("afterTodo");
  const beforeFinishIdx = hookOrder.indexOf("beforeFinish");
  const afterFinishIdx = hookOrder.indexOf("afterFinish");

  expect(beforeTodoIdx).toBeLessThan(workerIdx);
  expect(workerIdx).toBeLessThan(afterTodoIdx);
  expect(afterTodoIdx).toBeLessThan(beforeFinishIdx);
  expect(beforeFinishIdx).toBeLessThan(afterFinishIdx);
});

test("hooks: afterTodo receives todoCompleted context", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const pluginsDir = join(repoRoot, "plugins", "e2e-hooks");
  const pluginPath = createTracePlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "e2e-hooks": { module: pluginPath },
    },
  });

  const planId = "hooks-ctx-1";
  const planContent = buildPlanContent({
    title: "Hook Context Test",
    objective: "Test afterTodo context.",
    todos: ["Implement user authentication"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  const traces = readTraceFile(worktreePath);

  // Find afterTodo trace
  const afterTodoTrace = traces.find((t) => t.hook === "afterTodo");
  expect(afterTodoTrace).toBeDefined();
  expect(afterTodoTrace!.todoCompleted).toBe("Implement user authentication");
});

test("hooks: planId is passed to all hooks", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const pluginsDir = join(repoRoot, "plugins", "e2e-hooks");
  const pluginPath = createTracePlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "e2e-hooks": { module: pluginPath },
    },
  });

  const planId = "hooks-planid-1";
  const planContent = buildPlanContent({
    title: "Plan ID Test",
    objective: "Test planId context.",
    todos: ["Test task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  const traces = readTraceFile(worktreePath);

  // All hook traces should have planId
  const hookTraces = traces.filter((t) => t.hook !== "worker");
  for (const trace of hookTraces) {
    expect(trace.planId).toBe(planId);
  }
});

test("hooks: multiple TODOs run hooks for each", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const pluginsDir = join(repoRoot, "plugins", "e2e-hooks");
  const pluginPath = createTracePlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "e2e-hooks": { module: pluginPath },
    },
  });

  const planId = "hooks-multi-1";
  const planContent = buildPlanContent({
    title: "Multi-TODO Hooks Test",
    objective: "Test hooks run for each TODO.",
    todos: ["First task", "Second task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  // Process first TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  
  // Process second TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  const traces = readTraceFile(worktreePath);

  // Should have:
  // - 2 beforeTodo (one per TODO)
  // - 2 worker (one per TODO)
  // - 2 afterTodo (one per TODO)
  // - 1 beforeFinish (after all TODOs complete)
  // - 1 afterFinish
  const beforeTodoCount = traces.filter((t) => t.hook === "beforeTodo").length;
  const workerCount = traces.filter((t) => t.hook === "worker").length;
  const afterTodoCount = traces.filter((t) => t.hook === "afterTodo").length;
  const beforeFinishCount = traces.filter((t) => t.hook === "beforeFinish").length;
  const afterFinishCount = traces.filter((t) => t.hook === "afterFinish").length;

  expect(beforeTodoCount).toBe(2);
  expect(workerCount).toBe(2);
  expect(afterTodoCount).toBe(2);
  expect(beforeFinishCount).toBe(1);
  expect(afterFinishCount).toBe(1);
});

test("hooks: ordering with GitHub enabled includes all phases", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  const pluginsDir = join(repoRoot, "plugins", "e2e-hooks");
  const pluginPath = createTracePlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
    plugins: {
      "e2e-hooks": { module: pluginPath },
    },
  });

  const planId = "hooks-gh-1";
  const planContent = buildPlanContent({
    title: "GitHub Hooks Test",
    objective: "Test hooks with GitHub enabled.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  const traces = readTraceFile(worktreePath);
  const hookOrder = traces.map((t) => t.hook);

  // All hooks should still run with GitHub enabled
  expect(hookOrder).toContain("beforeTodo");
  expect(hookOrder).toContain("worker");
  expect(hookOrder).toContain("afterTodo");
  expect(hookOrder).toContain("beforeFinish");
  expect(hookOrder).toContain("afterFinish");

  // Verify status is review
  expect(state.plans[planId]!.status).toBe("review");
});
