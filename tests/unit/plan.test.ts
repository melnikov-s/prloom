import { test, expect } from "bun:test";
import { join } from "path";
import {
  parsePlan,
  findNextUnchecked,
  extractBody,
  generatePlanSkeleton,
} from "../../src/lib/plan.js";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");

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
  expect(skeleton).toContain("status: queued");
  expect(skeleton).toContain("## Objective");
  expect(skeleton).toContain("## TODO");
});

test("generatePlanSkeleton includes agent when provided", () => {
  const skeleton = generatePlanSkeleton("test-plan", "codex");

  expect(skeleton).toContain("id: test-plan");
  expect(skeleton).toContain("agent: codex");
});

test("generatePlanSkeleton omits agent when not provided", () => {
  const skeleton = generatePlanSkeleton("test-plan");

  expect(skeleton).not.toContain("agent:");
});
