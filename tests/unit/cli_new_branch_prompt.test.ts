import { test, expect, beforeEach, afterEach } from "bun:test";
import { makeTempRepo, writeTestConfig, type TempRepoResult } from "../e2e/harness.js";
import { runNew } from "../../src/cli/new.js";
import { loadState } from "../../src/lib/state.js";

let tempRepo: TempRepoResult;

beforeEach(async () => {
  tempRepo = await makeTempRepo();
  writeTestConfig(tempRepo.repoRoot, {
    agents: { default: "opencode" },
  });
});

afterEach(() => {
  tempRepo.cleanup();
});

test("runNew prompts for branch when missing", async () => {
  let promptCalls = 0;
  const promptBranch = async () => {
    promptCalls += 1;
    return "feature-branch";
  };

  await runNew(
    tempRepo.repoRoot,
    "plan-with-branch",
    undefined,
    true,
    undefined,
    undefined,
    undefined,
    { promptBranch }
  );

  const state = loadState(tempRepo.repoRoot);
  expect(promptCalls).toBe(1);
  expect(state.plans["plan-with-branch"]?.branch).toBe("feature-branch");
});

test("runNew skips branch prompt when branch provided", async () => {
  let promptCalls = 0;
  const promptBranch = async () => {
    promptCalls += 1;
    return "ignored";
  };

  await runNew(
    tempRepo.repoRoot,
    "plan-explicit-branch",
    undefined,
    true,
    undefined,
    "explicit-branch",
    undefined,
    { promptBranch }
  );

  const state = loadState(tempRepo.repoRoot);
  expect(promptCalls).toBe(0);
  expect(state.plans["plan-explicit-branch"]?.branch).toBe("explicit-branch");
});
