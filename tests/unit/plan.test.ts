import { test, expect } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  parsePlan,
  findNextUnchecked,
  extractBody,
  generatePlanSkeleton,
  setStatus,
} from "../../src/lib/plan.js";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");
const DRAFT_FIXTURE_PATH = join(
  import.meta.dir,
  "../fixtures/plans/draft-sample.md"
);

test("parsePlan extracts frontmatter id", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.frontmatter.id).toBe("sample");
});

test("parsePlan extracts frontmatter status", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.frontmatter.status).toBe("queued");
});

test("parsePlan extracts objective section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.objective).toBe("This is a sample plan for testing.");
});

test("parsePlan extracts context section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.context).toBe("Test context with relevant information.");
});

test("parsePlan parses TODO items", () => {
  const plan = parsePlan(FIXTURE_PATH);

  expect(plan.todos).toHaveLength(3);
  expect(plan.todos[0]?.text).toBe("First task");
  expect(plan.todos[0]?.done).toBe(false);
  expect(plan.todos[1]?.text).toBe("Second task (done)");
  expect(plan.todos[1]?.done).toBe(true);
  expect(plan.todos[2]?.text).toBe("Third task");
  expect(plan.todos[2]?.done).toBe(false);
});

test("findNextUnchecked returns first unchecked TODO", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const next = findNextUnchecked(plan);

  expect(next?.index).toBe(0);
  expect(next?.text).toBe("First task");
});

test("extractBody includes objective and progress log", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const body = extractBody(plan);

  expect(body).toContain("## Objective");
  expect(body).toContain("This is a sample plan for testing.");
  expect(body).toContain("## Progress Log");
  expect(body).toContain("✅ Completed: Second task");
});

test("generatePlanSkeleton creates valid frontmatter", () => {
  const skeleton = generatePlanSkeleton("test-plan");

  expect(skeleton).toContain("id: test-plan");
  expect(skeleton).toContain("status: draft");
  expect(skeleton).toContain("## Objective");
  expect(skeleton).toContain("## TODO");
});

test("generatePlanSkeleton includes agent when provided", () => {
  const skeleton = generatePlanSkeleton("test-plan", "codex");

  expect(skeleton).toContain("id: test-plan");
  expect(skeleton).toContain("agent: codex");
});

test("generatePlanSkeleton includes base_branch when provided", () => {
  const skeleton = generatePlanSkeleton("test-plan", "codex", "release/1.2");

  expect(skeleton).toContain("id: test-plan");
  expect(skeleton).toContain("base_branch: release/1.2");
});

test("generatePlanSkeleton omits agent when not provided", () => {
  const skeleton = generatePlanSkeleton("test-plan");

  expect(skeleton).not.toContain("agent:");
});

// Draft status tests
test("parsePlan parses draft status", () => {
  const plan = parsePlan(DRAFT_FIXTURE_PATH);
  expect(plan.frontmatter.status).toBe("draft");
  expect(plan.frontmatter.id).toBe("draft-sample");
});

test("setStatus changes plan status from draft to queued", () => {
  // Create a temp plan file
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");
  const skeleton = generatePlanSkeleton("test-plan");
  writeFileSync(planPath, skeleton);

  // Verify starts as draft
  let plan = parsePlan(planPath);
  expect(plan.frontmatter.status).toBe("draft");

  // Change to queued
  setStatus(planPath, "queued");
  plan = parsePlan(planPath);
  expect(plan.frontmatter.status).toBe("queued");

  // Cleanup
  rmSync(tmpDir, { recursive: true });
});

test("setStatus changes plan status from queued to active", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");
  const skeleton = generatePlanSkeleton("test-plan");
  writeFileSync(planPath, skeleton);

  setStatus(planPath, "queued");
  setStatus(planPath, "active");

  const plan = parsePlan(planPath);
  expect(plan.frontmatter.status).toBe("active");

  rmSync(tmpDir, { recursive: true });
});

test("setStatus preserves other frontmatter fields", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");
  const skeleton = generatePlanSkeleton("my-plan", "codex", "main");
  writeFileSync(planPath, skeleton);

  setStatus(planPath, "queued");

  const plan = parsePlan(planPath);
  expect(plan.frontmatter.status).toBe("queued");
  expect(plan.frontmatter.id).toBe("my-plan");
  expect(plan.frontmatter.agent).toBe("codex");
  expect(plan.frontmatter.base_branch).toBe("main");

  rmSync(tmpDir, { recursive: true });
});
