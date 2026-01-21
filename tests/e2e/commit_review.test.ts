/**
 * E2E tests for commit review gate.
 *
 * Tests the pre-commit review workflow where a reviewer agent can approve
 * or request changes before each TODO commit.
 *
 * See RFC: docs/rfc-commit-review-gate.md
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  readTraceFile,
  type TempRepoResult,
} from "./harness.js";

import {
  ingestInboxPlans,
  processActivePlans,
} from "../../src/lib/dispatcher.js";
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
 * Create a reviewer shim that always approves (leaves TODO [x]).
 */
function createApprovingReviewerShim(binDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");

function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

// Just trace the review - don't change anything (TODO stays [x] = approved)
appendTrace({ hook: "commitReview", action: "approve" });
console.log("[opencode shim] Commit review: APPROVED");
process.exit(0);
`;
  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Create a shim that marks TODO complete (worker) then approves (reviewer).
 * Based on the working harness shim pattern.
 */
function createWorkerThenApproveShim(binDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const planPath = path.join(cwd, "prloom", ".local", "plan.md");
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");

function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

if (!fs.existsSync(planPath)) {
  console.error("[opencode shim] Plan file not found:", planPath);
  process.exit(1);
}

let plan = fs.readFileSync(planPath, "utf-8");

// Check if there's an unchecked TODO (worker mode) or not (review mode)
const todoPattern = /^(\\s*-\\s*)\\[\\s*\\](\\s+.+)$/m;
const match = plan.match(todoPattern);

if (match) {
  // Worker mode - mark TODO complete
  plan = plan.replace(todoPattern, "$1[x]$2");
  fs.writeFileSync(planPath, plan);
  appendTrace({ hook: "worker" });
  
  const changeContent = fs.existsSync(changeFile) ? fs.readFileSync(changeFile, "utf-8") : "";
  fs.writeFileSync(changeFile, changeContent + "Change at " + new Date().toISOString() + "\\n");
  console.log("[opencode shim] Worker: marked TODO complete");
} else {
  // Review mode - just approve (leave as-is)
  appendTrace({ hook: "commitReview", action: "approve" });
  console.log("[opencode shim] Reviewer: APPROVED");
}
process.exit(0);
`;
  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Create a shim that rejects (unchecks TODO) then approves on second review.
 */
function createRejectThenApproveShim(binDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const planPath = path.join(cwd, "prloom", ".local", "plan.md");
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");
const reviewCountFile = path.join(cwd, "prloom", ".local", "review-count");

function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

if (!fs.existsSync(planPath)) {
  console.error("[opencode shim] Plan file not found:", planPath);
  process.exit(1);
}

let plan = fs.readFileSync(planPath, "utf-8");

// Check if there's an unchecked TODO (worker mode) or not (review mode)
const todoPattern = /^(\\s*-\\s*)\\[\\s*\\](\\s+.+)$/m;
const match = plan.match(todoPattern);

if (match) {
  // Worker mode - mark TODO complete
  plan = plan.replace(todoPattern, "$1[x]$2");
  fs.writeFileSync(planPath, plan);
  appendTrace({ hook: "worker" });
  
  const changeContent = fs.existsSync(changeFile) ? fs.readFileSync(changeFile, "utf-8") : "";
  fs.writeFileSync(changeFile, changeContent + "Change at " + new Date().toISOString() + "\\n");
  console.log("[opencode shim] Worker: marked TODO complete");
} else {
  // Review mode - check review count
  fs.mkdirSync(path.dirname(reviewCountFile), { recursive: true });
  let reviewCount = 0;
  if (fs.existsSync(reviewCountFile)) {
    reviewCount = parseInt(fs.readFileSync(reviewCountFile, "utf-8"), 10) || 0;
  }
  reviewCount++;
  fs.writeFileSync(reviewCountFile, String(reviewCount));

  if (reviewCount === 1) {
    // First review - reject (uncheck TODO)
    const checkedPattern = /^(\\s*-\\s*)\\[x\\](\\s+.+)$/m;
    plan = plan.replace(checkedPattern, "$1[ ]$2");
    fs.writeFileSync(planPath, plan);
    appendTrace({ hook: "commitReview", action: "reject", reviewCount });
    console.log("[opencode shim] Reviewer: REJECTED (unchecked TODO)");
  } else {
    // Second review - approve
    appendTrace({ hook: "commitReview", action: "approve", reviewCount });
    console.log("[opencode shim] Reviewer: APPROVED (second attempt)");
  }
}
process.exit(0);
`;
  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

/**
 * Create a shim that always rejects (for testing max loops).
 */
function createAlwaysRejectShim(binDir: string): void {
  const shim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const planPath = path.join(cwd, "prloom", ".local", "plan.md");
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");
const rejectCountFile = path.join(cwd, "prloom", ".local", "reject-count");

function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

if (!fs.existsSync(planPath)) {
  console.error("[opencode shim] Plan file not found:", planPath);
  process.exit(1);
}

let plan = fs.readFileSync(planPath, "utf-8");

// Check if there's an unchecked TODO (worker mode) or not (review mode)
const todoPattern = /^(\\s*-\\s*)\\[\\s*\\](\\s+.+)$/m;
const match = plan.match(todoPattern);

if (match) {
  // Worker mode - mark TODO complete
  plan = plan.replace(todoPattern, "$1[x]$2");
  fs.writeFileSync(planPath, plan);
  appendTrace({ hook: "worker" });
  
  const changeContent = fs.existsSync(changeFile) ? fs.readFileSync(changeFile, "utf-8") : "";
  fs.writeFileSync(changeFile, changeContent + "Change at " + new Date().toISOString() + "\\n");
  console.log("[opencode shim] Worker: marked TODO complete");
} else {
  // Review mode - always reject
  fs.mkdirSync(path.dirname(rejectCountFile), { recursive: true });
  let rejectCount = 0;
  if (fs.existsSync(rejectCountFile)) {
    rejectCount = parseInt(fs.readFileSync(rejectCountFile, "utf-8"), 10) || 0;
  }
  rejectCount++;
  fs.writeFileSync(rejectCountFile, String(rejectCount));

  const checkedPattern = /^(\\s*-\\s*)\\[x\\](\\s+.+)$/m;
  plan = plan.replace(checkedPattern, "$1[ ]$2");
  fs.writeFileSync(planPath, plan);
  appendTrace({ hook: "commitReview", action: "reject", rejectCount });
  console.log("[opencode shim] Reviewer: REJECTED (always reject mode)");
}
process.exit(0);
`;
  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, shim);
  chmodSync(opencodePath, 0o755);
}

// =============================================================================
// Tests
// =============================================================================

test("commit_review_disabled: current behavior unchanged", async () => {
  const { repoRoot, logsDir, binDir } = tempRepo;

  // Config WITHOUT commitReview enabled
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    // No commitReview config
  });

  const planId = "no-review";
  const planContent = buildPlanContent({
    title: "Test without review",
    objective: "Verify commit review disabled behavior.",
    todos: ["Simple task"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Use standard shim (marks TODO complete)
  // makeFakeBinaries already set up the standard shim

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  const state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger,
  );

  const logOutput = logs.map((l) => l.msg).join("\n");

  // Should NOT see commit review messages
  expect(logOutput).not.toContain("commit review");
  expect(logOutput).not.toContain("Running commit review");

  // Plan should complete normally
  expect(state.plans[planId]!.status).toBe("review");
}, 30000);

test("commit_review_approve: afterTodo runs once, commits", async () => {
  const { repoRoot, logsDir, binDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    commitReview: { enabled: true, maxLoops: 2 },
  });

  const planId = "review-approve";
  const planContent = buildPlanContent({
    title: "Test with approval",
    objective: "Verify commit review approval flow.",
    todos: ["Task to approve"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  createWorkerThenApproveShim(binDir);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  const state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  // Run twice: first for worker, second for reviewer
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger,
  );
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger,
  );

  const logOutput = logs.map((l) => l.msg).join("\n");

  // Should see commit review messages
  expect(logOutput).toContain("Running commit review");
  expect(logOutput).toContain("Commit review approved");

  // Plan should complete
  expect(state.plans[planId]!.status).toBe("review");

  // Check trace for proper ordering
  const worktreePath = state.plans[planId]!.worktree!;
  const trace = readTraceFile(worktreePath);
  const workerCalls = trace.filter((e) => e.hook === "worker");
  const reviewCalls = trace.filter((e) => e.hook === "commitReview");

  expect(workerCalls.length).toBe(1);
  expect(reviewCalls.length).toBe(1);
  expect(reviewCalls[0].action).toBe("approve");
}, 30000);

test("commit_review_reject: TODO unchecked, worker re-runs", async () => {
  const { repoRoot, logsDir, binDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    commitReview: { enabled: true, maxLoops: 2 },
  });

  const planId = "review-reject";
  const planContent = buildPlanContent({
    title: "Test with rejection",
    objective: "Verify commit review rejection flow.",
    todos: ["Task to reject then approve"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  createRejectThenApproveShim(binDir);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  const state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  // Need multiple iterations for the full loop:
  // 1. Worker marks [x]
  // 2. Reviewer rejects (unchecks to [ ])
  // 3. Worker marks [x] again
  // 4. Reviewer approves
  for (let i = 0; i < 5; i++) {
    await processActivePlans(
      repoRoot,
      config,
      state,
      "test-bot",
      { tmux: false },
      logger,
    );
  }

  const logOutput = logs.map((l) => l.msg).join("\n");

  // Should see rejection then approval
  expect(logOutput).toContain("Reviewer requested changes");
  expect(logOutput).toContain("review loop 1/2");
  expect(logOutput).toContain("Commit review approved");

  // Plan should complete (not blocked)
  expect(state.plans[planId]!.status).toBe("review");
  expect(state.plans[planId]!.blocked).toBeFalsy();

  // Check trace
  const worktreePath = state.plans[planId]!.worktree!;
  const trace = readTraceFile(worktreePath);
  const workerCalls = trace.filter((e) => e.hook === "worker");
  const reviewCalls = trace.filter((e) => e.hook === "commitReview");

  // Worker runs twice (initial + after rejection)
  expect(workerCalls.length).toBe(2);
  // Reviewer runs twice (reject + approve)
  expect(reviewCalls.length).toBe(2);
  expect(reviewCalls[0].action).toBe("reject");
  expect(reviewCalls[1].action).toBe("approve");
}, 30000);

test("commit_review_max_loops: plan blocks with error", async () => {
  const { repoRoot, logsDir, binDir } = tempRepo;

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    commitReview: { enabled: true, maxLoops: 2 },
  });

  const planId = "review-max-loops";
  const planContent = buildPlanContent({
    title: "Test max loops",
    objective: "Verify max loops blocking behavior.",
    todos: ["Task that will exceed max loops"],
  });
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  createAlwaysRejectShim(binDir);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  const state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  // Run enough times to exceed max loops
  for (let i = 0; i < 10; i++) {
    await processActivePlans(
      repoRoot,
      config,
      state,
      "test-bot",
      { tmux: false },
      logger,
    );
  }

  const logOutput = logs.map((l) => l.msg).join("\n");

  // Should see max loops error
  expect(logOutput).toContain("max loops");
  expect(logOutput).toContain("exceeded");

  // Plan should be blocked
  expect(state.plans[planId]!.blocked).toBe(true);
  expect(state.plans[planId]!.lastError).toContain("exceeded");
}, 30000);
