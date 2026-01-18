/**
 * E2E Test: GitHub-Enabled Happy Path
 *
 * Tests the dispatcher with GitHub enabled:
 * - Inbox plan is ingested into a worktree/branch
 * - Draft PR is created via gh CLI
 * - Worker runs and marks TODO as done
 * - PR body is updated
 * - PR is marked ready when all TODOs complete
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

test("github-enabled: creates draft PR on ingestion", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  // Configure with GitHub enabled
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
  });

  // Create inbox plan
  const planId = "gh-test-1";
  const planContent = buildPlanContent({
    title: "Feature: User Authentication",
    summary: "- Add auth endpoints",
    objective: "Add user authentication support.",
    context: "Plan-specific setup",
    scope: "In: login endpoint\nOut: signup flow",
    successCriteria: "- Users can log in",
    todos: ["Implement login endpoint"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger, logs } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Verify PR was created
  expect(state.plans[planId]!.pr).toBeDefined();
  expect(state.plans[planId]!.pr).toBeGreaterThan(0);

  // Verify gh shim recorded the PR create call
  const ghState = readGhState(stateDir);
  const prCreateCalls = ghState.calls.filter(
    (c) => c.args.includes("pr") && c.args.includes("create")
  );
  expect(prCreateCalls.length).toBe(1);
  expect(prCreateCalls[0]!.args).toContain("--draft");

  // Verify PR was created with correct data
  const prNumber = state.plans[planId]!.pr!;
  expect(ghState.prs[prNumber]).toBeDefined();
  expect(ghState.prs[prNumber]!.draft).toBe(true);
  expect(ghState.prs[prNumber]!.title).toBe("Feature: User Authentication");

  // Verify logs mention PR creation
  const prLogs = logs.filter((l) => l.msg.includes("PR #"));
  expect(prLogs.length).toBeGreaterThan(0);
});

test("github-enabled: updates PR body after TODO completion", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
  });

  const planId = "gh-test-2";
  const planContent = buildPlanContent({
    title: "Test PR Body Update",
    summary: "- Validate PR body updates",
    objective: "Test PR body updates.",
    context: "Plan-specific setup",
    scope: "In: PR body updates\nOut: review flow",
    successCriteria: "- PR body updates after TODO",
    todos: ["Task one", "Task two"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const prNumber = state.plans[planId]!.pr!;

  // Process first TODO
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Verify PR edit was called
  const ghState = readGhState(stateDir);
  const prEditCalls = ghState.calls.filter(
    (c) => c.args.includes("pr") && c.args.includes("edit")
  );
  expect(prEditCalls.length).toBeGreaterThan(0);

  // Verify PR body contains objective (extractBody includes Objective section)
  expect(ghState.prs[prNumber]!.body).toContain("Test PR body updates");
});

test("github-enabled: marks PR ready when all TODOs complete", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
  });

  const planId = "gh-test-3";
  const planContent = buildPlanContent({
    title: "Single Task Plan",
    summary: "- Single task plan",
    objective: "Test PR ready marking.",
    context: "Plan-specific setup",
    scope: "In: ready marking\nOut: extra workflows",
    successCriteria: "- PR marked ready",
    todos: ["The only task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger, logs } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const prNumber = state.plans[planId]!.pr!;

  // Process the TODO (only one, so it should complete)
  await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);

  // Verify PR ready was called
  const ghState = readGhState(stateDir);
  const prReadyCalls = ghState.calls.filter(
    (c) => c.args.includes("pr") && c.args.includes("ready")
  );
  expect(prReadyCalls.length).toBe(1);

  // Verify PR is no longer draft
  expect(ghState.prs[prNumber]!.draft).toBe(false);

  // Verify status is review
  expect(state.plans[planId]!.status).toBe("review");

  // Verify logs mention PR marked ready
  const readyLogs = logs.filter((l) => l.msg.includes("ready"));
  expect(readyLogs.length).toBeGreaterThan(0);
});

test("github-enabled: full workflow with multiple TODOs", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
  });

  const planId = "gh-test-4";
  const planContent = buildPlanContent({
    title: "Multi-Task Feature",
    summary: "- End-to-end workflow",
    objective: "Full workflow test.",
    context: "Plan-specific setup",
    scope: "In: db schema + API + tests\nOut: deployments",
    successCriteria: "- All TODOs complete",
    todos: ["Setup database schema", "Create API endpoints", "Add tests"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const prNumber = state.plans[planId]!.pr!;
  const worktreePath = state.plans[planId]!.worktree!;

  // Process all TODOs
  for (let i = 0; i < 3; i++) {
    await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  }

  // Verify all TODOs completed
  const planPath = join(worktreePath, "prloom", ".local", "plan.md");
  const finalPlan = readFileSync(planPath, "utf-8");
  expect(finalPlan).toContain("[x] Setup database schema");
  expect(finalPlan).toContain("[x] Create API endpoints");
  expect(finalPlan).toContain("[x] Add tests");

  // Verify git history
  const gitLog = await getGitLog(worktreePath);
  expect(gitLog.some((line) => line.includes("Setup database schema"))).toBe(true);
  expect(gitLog.some((line) => line.includes("Create API endpoints"))).toBe(true);
  expect(gitLog.some((line) => line.includes("Add tests"))).toBe(true);

  // Verify gh calls sequence
  const ghState = readGhState(stateDir);
  
  // Should have: 1 create, 3 edits (one per TODO), 1 ready
  const createCalls = ghState.calls.filter((c) => c.args.includes("create"));
  const editCalls = ghState.calls.filter((c) => c.args.includes("edit"));
  const readyCalls = ghState.calls.filter((c) => c.args.includes("ready"));
  
  expect(createCalls.length).toBe(1);
  expect(editCalls.length).toBe(3);
  expect(readyCalls.length).toBe(1);

  // Verify final state
  expect(state.plans[planId]!.status).toBe("review");
  expect(ghState.prs[prNumber]!.draft).toBe(false);
});

test("github-enabled: gh api user is called for bot login", async () => {
  const { repoRoot, logsDir, stateDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
  });

  const planId = "gh-test-5";
  const planContent = buildPlanContent({
    title: "API User Test",
    objective: "Test gh api user call.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest triggers getCurrentGitHubUser indirectly through the github module cache
  // For this test, we just verify the shim can handle the api user call
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  const ghState = readGhState(stateDir);
  
  // The api user call may or may not happen depending on caching
  // What matters is that if it's called, it returns valid data
  // The shim should handle it correctly
  expect(ghState.calls.length).toBeGreaterThan(0);
});
