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
import { buildPlanContent } from "../plan_helper.js";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");

test("parsePlan extracts title section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.title).toBe("Sample plan fixture");
});

test("parsePlan extracts plan summary section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.planSummary).toContain("Sample summary item");
});

test("parsePlan extracts objective section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.objective).toBe("This is a sample plan for testing.");
});

test("parsePlan extracts context section", () => {
  const plan = parsePlan(FIXTURE_PATH);
  expect(plan.context).toBe("Test context with relevant information.");
});

test("parsePlan extracts extended plan sections", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = buildPlanContent({
    title: "Add search filters",
    summary: ["- Add advanced filters UI", "- Wire filters to API"],
    objective: "Deliver filterable search results",
    context: "Scope limited to search page",
    scope: "In: filters UI and query params\nOut: backend ranking tweaks",
    successCriteria: ["- Filters update results without reload", "- Query params reflect selected filters"],
    constraints: "Must stay under 200ms per request",
    assumptions: "Search API already supports new params",
    architectureNotes: "Use SearchFilters component and update query builder",
    decisionLog: "- Use URL params for shareable state",
    implementationNotes: "Ensure SSR renders default filters",
    planSpecificChecks: "bun test tests/unit/search",
    reviewFocus: "Verify filter state sync in URL",
    openQuestions: "Confirm which filters ship in v1",
    todos: ["Add filters UI"],
  });
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.planSummary).toContain("Add advanced filters UI");
  expect(plan.scope).toContain("In: filters UI");
  expect(plan.successCriteria).toContain("Filters update results");
  expect(plan.constraints).toContain("200ms");
  expect(plan.assumptions).toContain("Search API");
  expect(plan.architectureNotes).toContain("SearchFilters");
  expect(plan.decisionLog).toContain("URL params");
  expect(plan.implementationNotes).toContain("SSR");
  expect(plan.planSpecificChecks).toContain("bun test");
  expect(plan.reviewFocus).toContain("filter state");
  expect(plan.openQuestions).toContain("filters ship");

  rmSync(tmpDir, { recursive: true });
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

test("extractBody includes objective, plan summary, and progress log", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const body = extractBody(plan);

  expect(body).toContain("## Objective");
  expect(body).toContain("This is a sample plan for testing.");
  expect(body).toContain("## Plan Summary");
  expect(body).toContain("Sample summary item");
  expect(body).toContain("## Progress Log");
  expect(body).toContain("✅ Completed: Second task");
});

test("generatePlanSkeleton creates valid markdown without frontmatter", () => {
  const skeleton = generatePlanSkeleton();

  expect(skeleton).not.toContain("---");
  expect(skeleton).not.toContain("id:");
  expect(skeleton).toContain("## Title");
  expect(skeleton).toContain("## Plan Summary");
  expect(skeleton).toContain("## Objective");
  expect(skeleton).toContain("## Plan-Specific Checks");
  expect(skeleton).toContain("## TODO");
});

test("parsePlan strips HTML comments from title", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  // Plan with only HTML comment placeholder in title section
  const planContent = buildPlanContent({
    title: "<!-- Short PR title (e.g., \"Fix PDF viewer pagination\") -->",
    todos: ["<!-- First task -->"],
  });

  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  // Title should be empty after stripping HTML comments
  expect(plan.title).toBe("");

  rmSync(tmpDir, { recursive: true });
});

test("parsePlan extracts actual title when provided", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = buildPlanContent({
    title: "Add dark mode support for the dashboard",
    objective: "Test objective",
    todos: ["Do something"],
  });

  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.title).toBe("Add dark mode support for the dashboard");

  rmSync(tmpDir, { recursive: true });
});

test("parsePlan captures indented context lines for TODOs", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = `## TODO

- [ ] Remove debug flag
  File: src/foo.ts:42
  Comment by @reviewer: "remove this"
  Code: \`const debug = true;\`
- [ ] Second task without context
- [x] Third task with context
  Some context here
  More context

## Progress Log
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.todos).toHaveLength(3);

  // First TODO has multi-line context
  expect(plan.todos[0]?.text).toBe("Remove debug flag");
  expect(plan.todos[0]?.done).toBe(false);
  expect(plan.todos[0]?.context).toContain("File: src/foo.ts:42");
  expect(plan.todos[0]?.context).toContain("Comment by @reviewer");
  expect(plan.todos[0]?.context).toContain("const debug = true");

  // Second TODO has no context
  expect(plan.todos[1]?.text).toBe("Second task without context");
  expect(plan.todos[1]?.context).toBeUndefined();

  // Third TODO is done but still has context
  expect(plan.todos[2]?.text).toBe("Third task with context");
  expect(plan.todos[2]?.done).toBe(true);
  expect(plan.todos[2]?.context).toContain("Some context here");
  expect(plan.todos[2]?.context).toContain("More context");

  rmSync(tmpDir, { recursive: true });
});

test("parsePlan handles mixed TODOs with and without context", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  const planContent = `## TODO

- [ ] Task A
- [ ] Task B with context
  Context for B
- [ ] Task C
- [x] Task D with context
  Context for D

## Progress Log
`;
  writeFileSync(planPath, planContent);

  const plan = parsePlan(planPath);
  expect(plan.todos).toHaveLength(4);

  expect(plan.todos[0]?.text).toBe("Task A");
  expect(plan.todos[0]?.context).toBeUndefined();

  expect(plan.todos[1]?.text).toBe("Task B with context");
  expect(plan.todos[1]?.context).toBe("  Context for B");

  expect(plan.todos[2]?.text).toBe("Task C");
  expect(plan.todos[2]?.context).toBeUndefined();

  expect(plan.todos[3]?.text).toBe("Task D with context");
  expect(plan.todos[3]?.done).toBe(true);
  expect(plan.todos[3]?.context).toBe("  Context for D");

  rmSync(tmpDir, { recursive: true });
});


// findNextUnchecked completion tests
test("findNextUnchecked returns null when all TODOs are complete", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "prloom-test-"));
  const planPath = join(tmpDir, "test-plan.md");

  // Create a plan with all TODOs marked complete
  const planContent = `## Objective

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

  const planContent = `## Objective

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

  const planContent = `## TODO

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
