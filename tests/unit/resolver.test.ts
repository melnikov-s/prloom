import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolvePlanId } from "../../src/lib/resolver.js";
import { saveState } from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";

let repoRoot: string;
let worktreesDir: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-resolver-test-"));
  worktreesDir = join(repoRoot, "prloom/.local/worktrees");
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

// Helper to create a worktree directory structure
function createWorktreeDir(branchName: string): string {
  const worktreePath = join(worktreesDir, branchName);
  mkdirSync(join(worktreePath, "prloom", ".local"), { recursive: true });
  return worktreePath;
}

test("resolvePlanId: exact ID match (inbox)", async () => {
  const id = "abcde";
  const planPath = join(repoRoot, "prloom", ".local", "inbox", `${id}.md`);
  writeFileSync(planPath, generatePlanSkeleton());

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});

test("resolvePlanId: exact ID match (state)", async () => {
  const id = "fghij";
  const branchName = "some-branch";
  const worktreePath = createWorktreeDir(branchName);
  
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: branchName,
        planRelpath: "prloom/.local/fghij.md",
        baseBranch: "main",
        status: "active",
      },
    },
  });

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});

test("resolvePlanId: branch match (state)", async () => {
  const id = "klmno";
  const branchName = "my-feature";
  
  // Create plan file in inbox
  const planPath = join(repoRoot, "prloom", ".local", "inbox", `${id}.md`);
  writeFileSync(planPath, generatePlanSkeleton());
  
  // Store branch in state (inbox plan, no worktree)
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id]: {
        status: "draft",
        branch: branchName,
        baseBranch: "main",
      },
    },
  });

  const resolved = await resolvePlanId(repoRoot, branchName);
  expect(resolved).toBe(id);
});

test("resolvePlanId: fully qualified branch match (state)", async () => {
  const id = "pqrst";
  const fullBranch = "fix-bug-12345";
  const worktreePath = createWorktreeDir(fullBranch);
  
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: worktreePath,
        branch: fullBranch,
        planRelpath: "prloom/.local/pqrst.md",
        baseBranch: "main",
        status: "active",
      },
    },
  });

  const resolved = await resolvePlanId(repoRoot, fullBranch);
  expect(resolved).toBe(id);
});

test("resolvePlanId: ambiguous match throws error", async () => {
  const id1 = "id111";
  const id2 = "id222";
  const branchName = "shared-name";

  // Create plan files in inbox
  writeFileSync(
    join(repoRoot, "prloom", ".local", "inbox", `${id1}.md`),
    generatePlanSkeleton()
  );
  writeFileSync(
    join(repoRoot, "prloom", ".local", "inbox", `${id2}.md`),
    generatePlanSkeleton()
  );

  // Both have same branch in state (inbox plans, no worktrees)
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id1]: {
        status: "draft",
        branch: branchName,
        baseBranch: "main",
      },
      [id2]: {
        status: "draft",
        branch: branchName,
        baseBranch: "main",
      },
    },
  });

  expect(resolvePlanId(repoRoot, branchName)).rejects.toThrow(
    /Ambiguous plan reference/
  );
});

test("resolvePlanId: not found throws error", async () => {
  expect(resolvePlanId(repoRoot, "non-existent")).rejects.toThrow(
    /Plan not found/
  );
});

test("resolvePlanId: resolves ID from prefixed filename", async () => {
  const id = "xyz78";
  const filename = `some-feature-${id}.md`;
  const planPath = join(repoRoot, "prloom", ".local", "inbox", filename);
  writeFileSync(planPath, generatePlanSkeleton());

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});
