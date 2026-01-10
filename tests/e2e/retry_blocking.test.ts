/**
 * E2E tests for retry/blocking behavior.
 *
 * Tests that the dispatcher correctly handles workers that fail to mark TODOs complete:
 * - Retry count increments on each failed attempt
 * - Plan blocks after MAX_TODO_RETRIES (3) failed attempts
 *
 * @see src/lib/dispatcher.ts lines 692-744
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
  readTraceFile,
  applyEnvOverrides,
  createFailingOpencodeShim,
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

test("retry_blocking: plan blocks after MAX_TODO_RETRIES (3) failed attempts", async () => {
  const { repoRoot, logsDir, binDir, stateDir } = tempRepo;

  // Write config
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Write a plan with one TODO
  const planId = "retry-test";
  const planContent = `# Test Plan

## Objective

Testing retry blocking behavior.

## TODO

- [ ] Task that worker will fail to complete
`;
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Replace the opencode shim with a failing one
  createFailingOpencodeShim(binDir);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process multiple times to trigger retry and blocking
  // MAX_TODO_RETRIES is 3, so we need 4 attempts (initial + 3 retries)
  for (let i = 0; i < 5; i++) {
    await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  }

  // Check logs for retry messages
  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");
  expect(logOutput).toContain("retry 1/3");
  expect(logOutput).toContain("retry 2/3");
  expect(logOutput).toContain("retry 3/3");
  expect(logOutput).toContain("failed 3 times");

  // Verify the plan is blocked
  expect(state.plans[planId]!.blocked).toBe(true);
}, 30000);

test("retry_blocking: retry count resets when moving to a new TODO", async () => {
  const { repoRoot, logsDir, binDir, stateDir } = tempRepo;

  // Write config
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Write a plan with two TODOs
  const planId = "retry-reset";
  const planContent = `# Test Plan

## Objective

Testing retry reset behavior.

## TODO

- [ ] First task
- [ ] Second task
`;
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Create a custom shim that fails first TODO once, then succeeds
  const customShim = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const planPath = path.join(cwd, "prloom", ".local", "plan.md");
const tracePath = path.join(cwd, "prloom", ".local", "e2e-trace.jsonl");
const changeFile = path.join(cwd, "e2e.txt");
const attemptFile = path.join(cwd, "prloom", ".local", "attempt-count");

function appendTrace(entry) {
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.appendFileSync(tracePath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
}

// Track attempt count
fs.mkdirSync(path.dirname(attemptFile), { recursive: true });
let attemptCount = 0;
if (fs.existsSync(attemptFile)) {
  attemptCount = parseInt(fs.readFileSync(attemptFile, "utf-8"), 10) || 0;
}
attemptCount++;
fs.writeFileSync(attemptFile, String(attemptCount));

let plan = fs.readFileSync(planPath, "utf-8");

// Fail the first attempt, succeed on subsequent ones
if (attemptCount === 1) {
  appendTrace({ hook: "worker", failed: true, attempt: attemptCount });
  const changeContent = fs.existsSync(changeFile) ? fs.readFileSync(changeFile, "utf-8") : "";
  fs.writeFileSync(changeFile, changeContent + \`Failed attempt \${attemptCount}\\n\`);
  console.log("[opencode shim] Simulating failure on first attempt");
  process.exit(0);
}

// Mark first unchecked TODO as done
const todoPattern = /^(\\s*-\\s*)\\[\\s*\\](\\s+.+)$/m;
const match = plan.match(todoPattern);

if (match) {
  plan = plan.replace(todoPattern, "$1[x]$2");
  fs.writeFileSync(planPath, plan);
  appendTrace({ hook: "worker", failed: false, attempt: attemptCount });
  
  const changeContent = fs.existsSync(changeFile) ? fs.readFileSync(changeFile, "utf-8") : "";
  fs.writeFileSync(changeFile, changeContent + \`Success at attempt \${attemptCount}\\n\`);
  console.log("[opencode shim] Marked TODO as complete");
}
process.exit(0);
`;

  const opencodePath = join(binDir, "opencode");
  writeFileSync(opencodePath, customShim);
  require("fs").chmodSync(opencodePath, 0o755);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logs, logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Process multiple times
  for (let i = 0; i < 5; i++) {
    await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  }

  const logMessages = logs.map((l) => l.msg);
  const logOutput = logMessages.join("\n");

  // Should see retry 1/3 for first TODO
  expect(logOutput).toContain("retry 1/3");

  // Should NOT see retry 2/3 (we succeeded on second attempt)
  expect(logOutput).not.toContain("retry 2/3");

  // Should NOT see blocking message
  expect(logOutput).not.toContain("blocking plan");

  // Plan should complete successfully (status = review)
  expect(state.plans[planId]!.status).toBe("review");
}, 30000);

test("retry_blocking: worker trace shows all retry attempts", async () => {
  const { repoRoot, logsDir, binDir, stateDir } = tempRepo;

  // Write config
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
  });

  // Write a plan
  const planId = "trace-retry";
  const planContent = `# Test Plan

## Objective

Testing trace file for retries.

## TODO

- [ ] Task that will retry
`;
  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  // Use failing shim
  createFailingOpencodeShim(binDir);

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, { tmux: false });

  // Run enough iterations to trigger blocking
  for (let i = 0; i < 5; i++) {
    await processActivePlans(repoRoot, config, state, "test-bot", { tmux: false }, logger);
  }

  // Get worktree path
  const worktreePath = state.plans[planId]!.worktree!;
  expect(existsSync(worktreePath)).toBe(true);

  const traceEntries = readTraceFile(worktreePath);
  const workerAttempts = traceEntries.filter((e) => e.hook === "worker");

  // Should have at least 3 worker attempts (initial + 2 retries before blocking on 3rd retry)
  // The plan blocks when retry count reaches MAX_TODO_RETRIES (3), but that's on the 4th attempt
  // which may not complete its worker run before blocking
  expect(workerAttempts.length).toBeGreaterThanOrEqual(3);
}, 30000);
