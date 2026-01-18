/**
 * E2E Test: Local-Only Happy Path
 *
 * Tests the dispatcher with GitHub disabled:
 * - Inbox plan is ingested into a worktree/branch
 * - Worker runs and marks TODO as done
 * - Git commit is created
 * - No gh CLI calls are made
 *
 * See RFC: docs/e2e-tests.md
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  getGitLog,
  applyEnvOverrides,
  readGhState,
  type TempRepoResult,
} from "./harness.js";

import { ingestInboxPlans, processActivePlans } from "../../src/lib/dispatcher.js";
import { loadState, type State } from "../../src/lib/state.js";
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

test("local-only: ingests inbox plan and creates worktree", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  // Configure with GitHub disabled
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Create inbox plan
  const planId = "test-plan-1";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Test local-only mode.",
    todos: ["First task to complete"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Load config and state
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  // Create test logger
  const { logger, logs } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest inbox plans
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Verify plan was ingested
  expect(state.plans[planId]).toBeDefined();
  expect(state.plans[planId]!.status).toBe("active");
  expect(state.plans[planId]!.worktree).toBeDefined();
  expect(state.plans[planId]!.branch).toBeDefined();

  // Verify worktree exists
  const worktreePath = state.plans[planId]!.worktree!;
  expect(existsSync(worktreePath)).toBe(true);

  // Verify plan file exists in worktree
  const planPath = join(worktreePath, "prloom", ".local", "plan.md");
  expect(existsSync(planPath)).toBe(true);

  // Verify no PR was created (GitHub disabled)
  expect(state.plans[planId]!.pr).toBeUndefined();

  // Verify gh was not called for PR creation
  const ghState = readGhState(stateDir);
  const prCreateCalls = ghState.calls.filter(
    (c) => c.args.includes("pr") && c.args.includes("create")
  );
  expect(prCreateCalls.length).toBe(0);

  // Verify logs mention local-only mode
  const localOnlyLogs = logs.filter((l) => l.msg.includes("local-only"));
  expect(localOnlyLogs.length).toBeGreaterThan(0);
});

test("local-only: worker marks TODO done and creates commit", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Configure with GitHub disabled
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Create inbox plan
  const planId = "test-plan-2";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Test worker execution.",
    todos: ["Implement feature X"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Load config and state
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  // Create test logger
  const { logger, logs } = createTestLogger(join(logsDir, "e2e.log"));

  // Step 1: Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;

  // Step 2: Process (run worker)
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Verify TODO was marked complete
  const planPath = join(worktreePath, "prloom", ".local", "plan.md");
  const updatedPlan = readFileSync(planPath, "utf-8");
  expect(updatedPlan).toContain("[x] Implement feature X");

  // Verify status changed to review (all TODOs complete)
  expect(state.plans[planId]!.status).toBe("review");

  // Verify git commit was created
  const gitLog = await getGitLog(worktreePath);
  expect(gitLog.some((line) => line.includes("Implement feature X"))).toBe(true);

  // Verify logs show success
  const successLogs = logs.filter((l) => l.level === "success");
  expect(successLogs.some((l) => l.msg.includes("complete"))).toBe(true);
});

test("local-only: multiple TODOs are processed sequentially", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Configure with GitHub disabled
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Create inbox plan with multiple TODOs
  const planId = "test-plan-3";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Test full execution.",
    todos: ["First task", "Second task", "Third task"],
  });


  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Load config and state
  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const worktreePath = state.plans[planId]!.worktree!;
  const planPath = join(worktreePath, "prloom", ".local", "plan.md");

  // Process first TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  
  let plan = readFileSync(planPath, "utf-8");
  expect(plan).toContain("[x] First task");
  expect(plan).toContain("[ ] Second task");
  expect(state.plans[planId]!.status).toBe("active");

  // Process second TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  
  plan = readFileSync(planPath, "utf-8");
  expect(plan).toContain("[x] First task");
  expect(plan).toContain("[x] Second task");
  expect(plan).toContain("[ ] Third task");
  expect(state.plans[planId]!.status).toBe("active");

  // Process third TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  
  plan = readFileSync(planPath, "utf-8");
  expect(plan).toContain("[x] First task");
  expect(plan).toContain("[x] Second task");
  expect(plan).toContain("[x] Third task");

  // All done - status should be review
  expect(state.plans[planId]!.status).toBe("review");

  // Verify commits for each task
  const gitLog = await getGitLog(worktreePath);
  expect(gitLog.some((line) => line.includes("First task"))).toBe(true);
  expect(gitLog.some((line) => line.includes("Second task"))).toBe(true);
  expect(gitLog.some((line) => line.includes("Third task"))).toBe(true);
});

test("local-only: inbox plan file is removed after ingestion", async () => {
  const { repoRoot, logsDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  const planId = "test-plan-4";
  const planContent = buildPlanContent({
    title: "Test Plan",
    objective: "Test inbox cleanup.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Verify inbox files exist before ingestion
  const inboxPath = join(repoRoot, "prloom", ".local", "inbox", `${planId}.md`);
  const inboxMetaPath = join(repoRoot, "prloom", ".local", "inbox", `${planId}.json`);
  expect(existsSync(inboxPath)).toBe(true);
  expect(existsSync(inboxMetaPath)).toBe(true);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Verify inbox files are removed after ingestion
  expect(existsSync(inboxPath)).toBe(false);
  expect(existsSync(inboxMetaPath)).toBe(false);
});
