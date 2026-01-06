import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getInboxPath, listInboxPlanIds } from "../../src/lib/state.js";
import { generatePlanSkeleton } from "../../src/lib/plan.js";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "prloom-filename-test-"));
  mkdirSync(join(repoRoot, "prloom", ".local", "inbox"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true });
});

test("getInboxPath: resolves prefixed filename", () => {
  const id = "abcde";
  const prefixedName = `cool-feature-${id}.md`;
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  const planPath = join(inboxDir, prefixedName);

  writeFileSync(planPath, generatePlanSkeleton(id));

  const resolvedPath = getInboxPath(repoRoot, id);
  expect(resolvedPath).toBe(planPath);
});

test("listInboxPlanIds: extracts ID from prefixed filenames", () => {
  const id1 = "abcde";
  const id2 = "fghij";
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");

  writeFileSync(
    join(inboxDir, `feat-one-${id1}.md`),
    generatePlanSkeleton(id1)
  );
  writeFileSync(
    join(inboxDir, `feat-two-${id2}.md`),
    generatePlanSkeleton(id2)
  );
  writeFileSync(
    join(inboxDir, `no-prefix.md`),
    generatePlanSkeleton("no-prefix")
  );

  const ids = listInboxPlanIds(repoRoot);
  expect(ids).toContain(`feat-one-${id1}`);
  expect(ids).toContain(`feat-two-${id2}`);
  expect(ids).toContain("no-prefix");
});

test("getInboxPath: prefers exact match over prefix", () => {
  const id = "abcde";
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");

  const exactPath = join(inboxDir, `${id}.md`);
  const prefixedPath = join(inboxDir, `prefix-${id}.md`);

  writeFileSync(exactPath, "exact");
  writeFileSync(prefixedPath, "prefixed");

  const resolvedPath = getInboxPath(repoRoot, id);
  expect(resolvedPath).toBe(exactPath);
});
