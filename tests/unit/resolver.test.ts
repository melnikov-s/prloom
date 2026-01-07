import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolvePlanId } from "../../src/lib/resolver.js";
import { saveState } from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-resolver-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("resolvePlanId: exact ID match (inbox)", async () => {
  const id = "abcde";
  const planPath = join(repoRoot, "prloom", ".local", "inbox", `${id}.md`);
  writeFileSync(planPath, generatePlanSkeleton(id));

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});

test("resolvePlanId: exact ID match (state)", async () => {
  const id = "fghij";
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: "/tmp/fake",
        branch: "some-branch",
        planRelpath: "prloom/plans/fghij.md",
        baseBranch: "main",
        status: "active",
      },
    },
    inbox: {},
  });

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});

test("resolvePlanId: descriptive branch match (inbox)", async () => {
  const id = "klmno";
  const branchName = "my-feature";
  const planPath = join(repoRoot, "prloom", ".local", "inbox", `${id}.md`);

  // Create plan with descriptive branch in frontmatter
  const content = `---
id: ${id}
branch: ${branchName}
---
## Objective
Test
`;
  writeFileSync(planPath, content);

  const resolved = await resolvePlanId(repoRoot, branchName);
  expect(resolved).toBe(id);
});

test("resolvePlanId: fully qualified branch match (state)", async () => {
  const id = "pqrst";
  const fullBranch = "fix-bug-12345";
  saveState(repoRoot, {
    control_cursor: 0,
    plans: {
      [id]: {
        worktree: "/tmp/fake",
        branch: fullBranch,
        planRelpath: "prloom/plans/pqrst.md",
        baseBranch: "main",
        status: "active",
      },
    },
    inbox: {},
  });

  const resolved = await resolvePlanId(repoRoot, fullBranch);
  expect(resolved).toBe(id);
});

test("resolvePlanId: ambiguous match throws error", async () => {
  const id1 = "id111";
  const id2 = "id222";
  const branchName = "shared-name";

  // Inbox plan 1
  writeFileSync(
    join(repoRoot, "prloom", ".local", "inbox", `${id1}.md`),
    `---
id: ${id1}
branch: ${branchName}
---`
  );

  // Inbox plan 2
  writeFileSync(
    join(repoRoot, "prloom", ".local", "inbox", `${id2}.md`),
    `---
id: ${id2}
branch: ${branchName}
---`
  );

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
  writeFileSync(planPath, generatePlanSkeleton(id));

  const resolved = await resolvePlanId(repoRoot, id);
  expect(resolved).toBe(id);
});
