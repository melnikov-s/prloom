/**
 * E2E tests for pause-after-commit behavior.
 *
 * Ensures the dispatcher can pause after each commit so manual review
 * can happen before the next TODO executes.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { readFileSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  getGitLog,
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

describe("requireManualResume", () => {
  test("dispatcher pauses after commit before next TODO", async () => {
    const { repoRoot, logsDir } = tempRepo;

    writeTestConfig(repoRoot, {
      agents: { default: "opencode" },
      github: { enabled: false },
      base_branch: "main",
      commitReview: {
        enabled: false,
        requireManualResume: true,
      },
    });

    const planId = "pause-after-commit";
    const firstTodo = "First task should commit";
    const secondTodo = "Second task should wait";
    const planContent = buildPlanContent({
      title: "Manual resume pause",
      objective: "Pause after each commit until manually resumed.",
      todos: [firstTodo, secondTodo],
    });
    writeInboxPlan(repoRoot, planId, planContent, "opencode");

    const config = loadConfig(repoRoot);
    const worktreesDir = resolveWorktreesDir(repoRoot, config);
    let state = loadState(repoRoot);

    const { logger } = createTestLogger(join(logsDir, "e2e.log"));

    await ingestInboxPlans(
      repoRoot,
      worktreesDir,
      config,
      state,
      logger,
      { tmux: false },
    );

    await processActivePlans(
      repoRoot,
      config,
      state,
      "test-bot",
      { tmux: false },
      logger,
    );

    const planState = state.plans[planId]!;
    expect(planState.status).toBe("paused");
    expect(planState.blocked).toBeFalsy();
    expect(planState.lastError).toContain("Paused for manual resume");

    const worktreePath = planState.worktree!;
    const planPath = join(worktreePath, "prloom", ".local", "plan.md");
    const plan = readFileSync(planPath, "utf-8");

    expect(plan).toContain(`[x] ${firstTodo}`);
    expect(plan).toContain(`[ ] ${secondTodo}`);

    const logLines = await getGitLog(worktreePath, 10);
    expect(logLines.some((line) => line.includes(firstTodo))).toBe(true);
    expect(logLines.some((line) => line.includes(secondTodo))).toBe(false);
  }, 30000);
});
