import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runQueue } from "../../src/cli/queue.js";
import { runStatus } from "../../src/cli/status.js";
import {
  getInboxPath,
  loadState,
  getPlanMeta,
  setPlanStatus,
} from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-queue-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("runQueue transitions draft to queued (via state.plans)", async () => {
  // Use simple ID without hyphens to avoid resolver extracting suffix
  const id = "abc123";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton();
  writeFileSync(inboxPath, skeleton);

  // Set initial status to draft in state.plans
  setPlanStatus(repoRoot, id, "draft");

  // Verify starts as draft
  expect(getPlanMeta(repoRoot, id).status).toBe("draft");

  await runQueue(repoRoot, id);

  // Now queued in state.plans
  expect(getPlanMeta(repoRoot, id).status).toBe("queued");
});

test("runStatus shows draft/queued labels from state.plans", async () => {
  const id1 = "plan1";
  const id2 = "plan2";
  const path1 = getInboxPath(repoRoot, id1);
  const path2 = getInboxPath(repoRoot, id2);

  writeFileSync(path1, generatePlanSkeleton());
  writeFileSync(path2, generatePlanSkeleton());

  // Set status in state.plans
  setPlanStatus(repoRoot, id1, "draft");
  setPlanStatus(repoRoot, id2, "queued");

  // Capture console.log
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runStatus(repoRoot);
  } finally {
    console.log = originalLog;
  }

  const logStr = logs.join("\n");
  expect(logStr).toContain("plan1 [draft]");
  expect(logStr).toContain("plan2 [queued]");
});

test("runQueue is idempotent (already queued)", async () => {
  // Use simple ID without hyphens
  const id = "xyz789";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton();
  writeFileSync(inboxPath, skeleton);

  // Set to queued in state.plans
  setPlanStatus(repoRoot, id, "queued");

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runQueue(repoRoot, id);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("already queued");
  expect(getPlanMeta(repoRoot, id).status).toBe("queued");
});

test("getPlanMeta defaults to draft when no meta exists", () => {
  const id = "nometa";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(inboxPath, generatePlanSkeleton());

  // Don't call setPlanStatus - should default to draft
  const meta = getPlanMeta(repoRoot, id);
  expect(meta.status).toBe("draft");
});
