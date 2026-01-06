import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runQueue } from "../../src/cli/queue.js";
import { runStatus } from "../../src/cli/status.js";
import { getInboxPath } from "../../src/lib/state.js";
import { parsePlan, generatePlanSkeleton } from "../../src/lib/plan.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-queue-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("runQueue transitions draft to queued", async () => {
  const id = "draft-plan";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton(id);
  writeFileSync(inboxPath, skeleton);

  // Starts as draft
  expect(parsePlan(inboxPath).frontmatter.status).toBe("draft");

  await runQueue(repoRoot, id);

  // Now queued
  expect(parsePlan(inboxPath).frontmatter.status).toBe("queued");
});

test("runStatus shows draft/queued labels", async () => {
  const id1 = "plan-1";
  const id2 = "plan-2";
  const path1 = getInboxPath(repoRoot, id1);
  const path2 = getInboxPath(repoRoot, id2);

  writeFileSync(path1, generatePlanSkeleton(id1)); // draft
  const skeleton2 = generatePlanSkeleton(id2);
  writeFileSync(path2, skeleton2.replace("status: draft", "status: queued"));

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
  expect(logStr).toContain("plan-1 [draft]");
  expect(logStr).toContain("plan-2 [queued]");
});

test("runQueue is idempotent (already queued)", async () => {
  const id = "already-queued";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton(id);
  // Set to queued manually
  writeFileSync(inboxPath, skeleton.replace("status: draft", "status: queued"));

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    await runQueue(repoRoot, id);
  } finally {
    console.log = originalLog;
  }

  expect(logs.join("\n")).toContain("already queued");
  expect(parsePlan(inboxPath).frontmatter.status).toBe("queued");
});

test("runQueue warns on unexpected status but still queues", async () => {
  const id = "unexpected-status";
  const inboxPath = getInboxPath(repoRoot, id);
  const skeleton = generatePlanSkeleton(id);
  // Set to something weird
  writeFileSync(inboxPath, skeleton.replace("status: draft", "status: active"));

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(msg);

  try {
    await runQueue(repoRoot, id);
  } finally {
    console.warn = originalWarn;
  }

  expect(warnings.join("\n")).toContain("unexpected status: active");
  expect(parsePlan(inboxPath).frontmatter.status).toBe("queued");
});
