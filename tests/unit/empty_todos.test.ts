import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ingestInboxPlans,
  processActivePlans,
} from "../../src/lib/dispatcher.js";
import { saveState, loadState, getInboxPath } from "../../src/lib/state.js";
import { generatePlanSkeleton, setStatus } from "../../src/lib/plan.js";
import { loadConfig } from "../../src/lib/config.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-empty-todo-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("ingestInboxPlans: skips plan with no TODOs", async () => {
  const id = "empty-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  // Create a plan with NO todos (just skeleton, manually cleared if needed)
  const content = `---
id: ${id}
status: queued
---
## TODO
`;
  writeFileSync(inboxPath, content);

  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  await ingestInboxPlans(repoRoot, "/tmp/worktrees", config, state);

  // Verify it was NOT ingested (still in inbox, not in state)
  expect(Object.keys(state.plans)).not.toContain(id);
  const ids = (await import("../../src/lib/state.js")).listInboxPlanIds(
    repoRoot
  );
  expect(ids).toContain(id);
});

test("processActivePlans: blocks active plan with no TODOs", async () => {
  const id = "active-empty-plan";
  const worktreePath = mkdtempSync(join(tmpdir(), "worktree-"));
  const planRelpath = `prloom/plans/${id}.md`;
  mkdirSync(join(worktreePath, "prloom", "plans"), { recursive: true });

  // Create an active plan with NO todos in its worktree
  const planPath = join(worktreePath, planRelpath);
  const content = `---
id: ${id}
status: active
---
## TODO
`;
  writeFileSync(planPath, content);

  const config = loadConfig(repoRoot);
  const state = {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: "feat-branch",
        planRelpath,
        baseBranch: "main",
      },
    },
  };

  // processActivePlans expects botLogin
  await processActivePlans(repoRoot, config, state, "bot-user");

  // Verify it was blocked
  const updatedContent = (await import("fs")).readFileSync(planPath, "utf-8");
  expect(updatedContent).toContain("status: blocked");
  expect(state.plans[id].lastError).toContain("zero TODO items");
});
