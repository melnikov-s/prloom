/**
 * E2E tests for hook error handling.
 *
 * Tests that when a plugin hook throws an error, the plan is blocked.
 * Per RFC: "If a hook throws, abort."
 *
 * @see src/lib/dispatcher.ts lines 1030-1034
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  createThrowingPlugin,
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

test("hook_error: beforeTodo hook error blocks the plan", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugins directory and add throwing plugin
  const pluginsDir = join(repoRoot, "plugins", "throwing");
  const pluginPath = createThrowingPlugin(pluginsDir, "beforeTodo");

  // Write config with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "throwing": { module: pluginPath },
    },
  });

  // Write a plan
  const planId = "hook-error-before";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing beforeTodo hook error.",
    todos: ["This task will trigger the throwing hook"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process - this should trigger the hook error
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Check logs for error message
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("intentional hook error");

  // Plan should be blocked
  expect(state.plans[planId]!.blocked).toBe(true);
}, 30000);

test("hook_error: afterTodo hook error blocks the plan", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugins directory and add throwing plugin for afterTodo
  const pluginsDir = join(repoRoot, "plugins", "throwing");
  const pluginPath = createThrowingPlugin(pluginsDir, "afterTodo");

  // Write config with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "throwing": { module: pluginPath },
    },
  });

  // Write a plan with two TODOs
  const planId = "hook-error-after";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing afterTodo hook error.",
    todos: ["First task", "Second task"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process - should complete first TODO but then error on afterTodo hook
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Check logs for error message
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("intentional hook error");

  // Check that plan was blocked and didn't continue to second TODO
  const worktreePath = state.plans[planId]!.worktree!;
  const planPath = join(worktreePath, "prloom", ".local", "plan.md");
  const updatedPlan = readFileSync(planPath, "utf-8");

  // First TODO might be checked (worker ran before hook errored)
  // Second TODO should still be unchecked (plan blocked after first)
  expect(updatedPlan).toContain("- [ ] Second task");

  // Plan should be blocked
  expect(state.plans[planId]!.blocked).toBe(true);
}, 30000);

test("hook_error: beforeFinish hook error blocks the plan", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugins directory and add throwing plugin for beforeFinish
  const pluginsDir = join(repoRoot, "plugins", "throwing");
  const pluginPath = createThrowingPlugin(pluginsDir, "beforeFinish");

  // Write config with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "throwing": { module: pluginPath },
    },
  });

  // Write a plan with one TODO (will complete quickly)
  const planId = "hook-error-finish";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing triage hook error.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process - should complete TODO then error on beforeFinish
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Check logs for error message
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("intentional hook error");

  // Plan should be blocked, not finished
  expect(state.plans[planId]!.blocked).toBe(true);
  expect(state.plans[planId]!.status).not.toBe("finished");
}, 30000);

test("hook_error: hook error prevents retry loops", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugins directory and add throwing plugin
  const pluginsDir = join(repoRoot, "plugins", "throwing");
  const pluginPath = createThrowingPlugin(pluginsDir, "beforeTodo");

  // Write config with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "throwing": { module: pluginPath },
    },
  });

  // Write a plan
  const planId = "no-retry-on-error";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing worker hook error.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process multiple times
  for (let i = 0; i < 3; i++) {
    await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  }

  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");

  // Should see the error
  expect(logOutput).toContain("intentional hook error");

  // Should NOT see retry messages (hook errors block immediately)
  expect(logOutput).not.toContain("retry 1/3");

  // Plan should be blocked
  expect(state.plans[planId]!.blocked).toBe(true);
}, 30000);
