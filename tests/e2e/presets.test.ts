/**
 * E2E tests for presets configuration.
 *
 * Tests that presets correctly override global configuration settings.
 * Presets allow per-plan configuration overrides, useful for different
 * project types or requirements.
 *
 * @see src/lib/config.ts: PresetConfig interface
 * @see src/lib/dispatcher.ts lines 300-343: preset handling during ingestion
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  createTracePlugin,
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

/**
 * Write an inbox plan with preset metadata.
 */
function writeInboxPlanWithPreset(
  repoRoot: string,
  planId: string,
  planContent: string,
  agent: string,
  preset: string
): void {
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  mkdirSync(inboxDir, { recursive: true });

  // Write plan markdown
  writeFileSync(join(inboxDir, `${planId}.md`), planContent);

  // Write metadata JSON with preset
  writeFileSync(
    join(inboxDir, `${planId}.json`),
    JSON.stringify({ status: "queued", agent, preset }, null, 2)
  );
}

test("presets: plan with preset uses preset config", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Write config with a preset that changes github settings
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true }, // Global: enabled
    base_branch: "main",
    presets: {
      "no-github": {
        github: { enabled: false }, // Preset: disabled
      },
    },
  });

  // Write a plan that uses the preset
  const planId = "preset-test";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing preset overrides.",
    todos: ["Single task"],
  });
  writeInboxPlanWithPreset(repoRoot, planId, planContent, "opencode", "no-github");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Verify the plan was ingested with the preset
  expect(state.plans[planId]).toBeDefined();
  expect(state.plans[planId]!.preset).toBe("no-github");

  // Check logs mention the preset
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("Preset: no-github");
}, 30000);

test("presets: worktree config is written for preset plans", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Write config with a preset
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    presets: {
      "custom-agent": {
        agents: { default: "claude" },
      },
    },
  });

  // Write a plan that uses the preset
  const planId = "worktree-config-test";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing worktree config for presets.",
    todos: ["Task"],
  });
  writeInboxPlanWithPreset(repoRoot, planId, planContent, "opencode", "custom-agent");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Check that worktree config was written
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("Wrote worktree config for preset");

  // Verify worktree config file exists
  const worktreePath = state.plans[planId]!.worktree!;
  const worktreeConfigPath = join(worktreePath, "prloom", "config.json");
  expect(existsSync(worktreeConfigPath)).toBe(true);

  // Verify config contents
  const worktreeConfig = JSON.parse(readFileSync(worktreeConfigPath, "utf-8"));
  expect(worktreeConfig.agents?.default).toBe("claude");
}, 30000);

test("presets: plugin overrides in preset", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create plugins directory and trace plugin
  const pluginsDir = join(repoRoot, "plugins", "e2e-trace");
  const pluginPath = createTracePlugin(pluginsDir);

  // Write config with plugin enabled globally, but disabled in preset
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "e2e-trace": { module: pluginPath },
    },
    presets: {
      "no-plugins": {
        plugins: {
          "e2e-trace": { enabled: false },
        },
      },
    },
  });

  // Write a plan that uses the preset
  const planId = "plugin-override-test";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing preset plugins.",
    todos: ["Task"],
  });

  writeInboxPlanWithPreset(repoRoot, planId, planContent, "opencode", "no-plugins");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // With the plugin disabled, no trace file should exist
  // (or it should be empty from plugin hooks - only worker writes to it)
  const worktreePath = state.plans[planId]!.worktree!;
  const tracePath = join(worktreePath, "prloom", ".local", "e2e-trace.jsonl");
  
  if (existsSync(tracePath)) {
    const traceContent = readFileSync(tracePath, "utf-8");
    const traces = traceContent.trim().split("\n").filter(Boolean);
    
    // Should only have worker traces, no plugin hook traces
    const hookTraces = traces
      .map((line) => JSON.parse(line))
      .filter((t: { hook: string }) => t.hook !== "worker");
    
    expect(hookTraces.length).toBe(0);
  }
}, 30000);

test("presets: plan without preset uses global config", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  // Write config with presets available but not used
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true }, // Global: enabled
    base_branch: "main",
    presets: {
      "no-github": {
        github: { enabled: false },
      },
    },
  });

  // Write a plan WITHOUT a preset
  const planId = "no-preset-test";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Testing no preset.",
    todos: ["Task"],
  });


  // Use regular writeInboxPlan (no preset)
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, `${planId}.md`), planContent);
  writeFileSync(
    join(inboxDir, `${planId}.json`),
    JSON.stringify({ status: "queued", agent: "opencode" }, null, 2)
  );

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Verify no preset was applied
  expect(state.plans[planId]).toBeDefined();
  expect(state.plans[planId]!.preset).toBeUndefined();

  // Logs should not mention preset
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).not.toContain("Preset:");
}, 30000);
