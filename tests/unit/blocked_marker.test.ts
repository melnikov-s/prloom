import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { processActivePlans } from "../../src/lib/dispatcher.js";
import { loadConfig } from "../../src/lib/config.js";
import { type State } from "../../src/lib/state.js";

const noopLogger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-blocked-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("processActivePlans: immediately blocks plan with [b] marker", async () => {
  const id = "blocked-marker-plan";
  const worktreePath = mkdtempSync(join(tmpdir(), "worktree-"));
  const planRelpath = `prloom/plans/${id}.md`;
  mkdirSync(join(worktreePath, "prloom", "plans"), { recursive: true });

  // Create an active plan with a blocked TODO
  const planPath = join(worktreePath, planRelpath);
  const content = `---
id: ${id}
---
## TODO
- [x] Done task
- [b] This task is blocked
- [ ] Future task
`;
  writeFileSync(planPath, content);

  const config = loadConfig(repoRoot);
  const state: State = {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: "feat-blocked",
        planRelpath,
        baseBranch: "main",
        status: "active",
      },
    },
    inbox: {},
  };

  await processActivePlans(repoRoot, config, state, "bot-user", {}, noopLogger);

  // Verify status is now blocked in state
  expect(state.plans[id]!.status).toBe("blocked");
});
