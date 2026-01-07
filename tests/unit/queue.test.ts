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
  getInboxMeta,
  setInboxStatus,
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

test("runQueue transitions draft to queued (via state.inbox)", async () => {
  // Use simple ID without hyphens to avoid resolver extracting suffix
  const id = "abc123";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton(id);
  writeFileSync(inboxPath, skeleton);

  // Set initial status to draft in state.inbox
  setInboxStatus(repoRoot, id, "draft");

  // Verify starts as draft
  expect(getInboxMeta(repoRoot, id).status).toBe("draft");

  await runQueue(repoRoot, id);

  // Now queued in state.inbox
  expect(getInboxMeta(repoRoot, id).status).toBe("queued");
});

test("runStatus shows draft/queued labels from state.inbox", async () => {
  const id1 = "plan1";
  const id2 = "plan2";
  const path1 = getInboxPath(repoRoot, id1);
  const path2 = getInboxPath(repoRoot, id2);

  writeFileSync(path1, generatePlanSkeleton(id1));
  writeFileSync(path2, generatePlanSkeleton(id2));

  // Set status in state.inbox
  setInboxStatus(repoRoot, id1, "draft");
  setInboxStatus(repoRoot, id2, "queued");

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
  const skeleton = generatePlanSkeleton(id);
  writeFileSync(inboxPath, skeleton);

  // Set to queued in state.inbox
  setInboxStatus(repoRoot, id, "queued");

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runQueue(repoRoot, id);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("already queued");
  expect(getInboxMeta(repoRoot, id).status).toBe("queued");
});

test("getInboxMeta defaults to draft when no meta exists", () => {
  const id = "nometa";
  const inboxPath = getInboxPath(repoRoot, id);
  writeFileSync(inboxPath, generatePlanSkeleton(id));

  // Don't call setInboxStatus - should default to draft
  const meta = getInboxMeta(repoRoot, id);
  expect(meta.status).toBe("draft");
});
