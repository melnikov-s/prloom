import { test, expect } from "bun:test";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
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
  expect(skeleton).not.toContain("status:");
  expect(skeleton).toContain("## Objective");
  expect(skeleton).toContain("## TODO");
});

test("parsePlan strips HTML comments from title", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  // Plan with only HTML comment placeholder in title section
  const planContent = `---
id: test-plan
---

## Title

<!-- Short PR title (e.g., "Fix PDF viewer pagination") -->

## Objective

Test objective

## TODO

- [ ] Do something

## Progress Log
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  // Title should be empty after stripping HTML comments
  expect(plan.title).toBe("");

  rmSync(tmpDir, { recursive: true });
});

test("parsePlan extracts actual title when provided", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = `---
id: test-plan
---

## Title

Add dark mode support for the dashboard

## Objective

Test objective

## TODO

- [ ] Do something

## Progress Log
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.title).toBe("Add dark mode support for the dashboard");

  rmSync(tmpDir, { recursive: true });
});

test("generatePlanSkeleton includes base_branch when provided", () => {
  const skeleton = generatePlanSkeleton("test-plan", "release/1.2");

  expect(skeleton).toContain("id: test-plan");
  expect(skeleton).toContain("base_branch: release/1.2");
});

test("generatePlanSkeleton omits base_branch when not provided", () => {
  const skeleton = generatePlanSkeleton("test-plan");

  expect(skeleton).not.toContain("base_branch:");
});

// findNextUnchecked completion tests
test("findNextUnchecked returns null when all TODOs are complete", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  // Create a plan with all TODOs marked complete
  const planContent = `---
id: completed-plan
---

## Objective

Test plan

## TODO

- [x] First task
- [x] Second task
- [x] Third task

## Progress Log

- Completed all tasks
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  const next = findNextUnchecked(plan);

  expect(next).toBeNull();
  expect(plan.todos).toHaveLength(3);
  expect(plan.todos.every((t) => t.done)).toBe(true);

  rmSync(tmpDir, { recursive: true });
});

test("findNextUnchecked returns null when TODO section is empty", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = `---
id: empty-plan
---

## Objective

Test plan

## TODO

## Progress Log
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  const next = findNextUnchecked(plan);

  expect(next).toBeNull();
  expect(plan.todos).toHaveLength(0);

  rmSync(tmpDir, { recursive: true });
});

test("parsePlan parses blocked marker [b]", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = `---
id: blocked-todo-plan
---

## TODO

- [x] Done task
- [b] Blocked task
- [ ] Pending task
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.todos).toHaveLength(3);
  expect(plan.todos[0]?.done).toBe(true);
  expect(plan.todos[0]?.blocked).toBe(false);
  expect(plan.todos[1]?.done).toBe(false);
  expect(plan.todos[1]?.blocked).toBe(true);
  expect(plan.todos[2]?.done).toBe(false);
  expect(plan.todos[2]?.blocked).toBe(false);

  rmSync(tmpDir, { recursive: true });
});
