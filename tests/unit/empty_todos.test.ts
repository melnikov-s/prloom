import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ingestInboxPlans,
  processActivePlans,
} from "../../src/lib/dispatcher.js";
import {
  saveState,
  loadState,
  getInboxPath,
  setPlanStatus,
  type State,
} from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";
import { loadConfig } from "../../src/lib/config.js";

// No-op logger for tests
const noopLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
};

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
---
## TODO
`;
  writeFileSync(inboxPath, content);

  // Set inbox status to queued via state (not frontmatter)
  setPlanStatus(repoRoot, id, "queued");

  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  await ingestInboxPlans(repoRoot, "/tmp/worktrees", config, state, noopLogger);

  // Verify it was NOT activated (no worktree assigned, still in inbox)
  expect(state.plans[id]?.worktree).toBeUndefined();
  const ids = (await import("../../src/lib/state.js")).listInboxPlanIds(
    repoRoot
  );
  expect(ids).toContain(id);
});

test("ingestInboxPlans: skips draft plans", async () => {
  const id = "draft-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  const content = `---
id: ${id}
---
## TODO
- [ ] A task
`;
  writeFileSync(inboxPath, content);

  // Set inbox status to draft (default) - should NOT be ingested
  setPlanStatus(repoRoot, id, "draft");

  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  await ingestInboxPlans(repoRoot, "/tmp/worktrees", config, state, noopLogger);

  // Verify it was NOT activated (no worktree assigned, still in inbox)
  expect(state.plans[id]?.worktree).toBeUndefined();
  // Should still be in inbox
  const ids = (await import("../../src/lib/state.js")).listInboxPlanIds(
    repoRoot
  );
  expect(ids).toContain(id);
});

test("ingestInboxPlans: plan with no meta defaults to draft (not ingested)", async () => {
  const id = "no-meta-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  const content = `---
id: ${id}
---
## TODO
- [ ] A task
`;
  writeFileSync(inboxPath, content);

  // Don't set any inbox status - should default to draft

  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  await ingestInboxPlans(repoRoot, "/tmp/worktrees", config, state, noopLogger);

  // Verify it was NOT activated (no worktree assigned, defaults to draft)
  expect(state.plans[id]?.worktree).toBeUndefined();
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
---
## TODO
`;
  writeFileSync(planPath, content);

  const config = loadConfig(repoRoot);
  const state: State = {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: "feat-branch",
        planRelpath,
        baseBranch: "main",
        status: "active",
      },
    },
  };

  // processActivePlans expects botLogin
  await processActivePlans(repoRoot, config, state, "bot-user", {}, noopLogger);

  // Verify it was blocked
  expect(state.plans[id]!.blocked).toBe(true);
  expect(state.plans[id]!.lastError).toContain("zero TODO items");
});
