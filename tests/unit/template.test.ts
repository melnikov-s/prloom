import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import {
  renderWorkerPrompt,
  renderDesignerNewPrompt,
  renderDesignerEditPrompt,
  loadAgentContext,
} from "../../src/lib/template.js";
import { parsePlan } from "../../src/lib/plan.js";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");
const TEMP_REPO = join(import.meta.dir, "../fixtures/temp-context-repo");

// Cleanup helper
function cleanupTempRepo() {
  if (existsSync(TEMP_REPO)) {
    rmSync(TEMP_REPO, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanupTempRepo();
});

afterEach(() => {
  cleanupTempRepo();
});

test("renderWorkerPrompt uses built-in template", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 0, text: "First task", done: false, blocked: false };

  const prompt = renderWorkerPrompt("/does-not-matter", "prloom/.local/plan.md", plan, todo);

  expect(prompt).toContain("TODO #1: First task");
  expect(prompt).toContain("## Title");
  expect(prompt).toContain("Sample plan fixture");
  expect(prompt).toContain("prloom/.local/plan.md");
  expect(prompt).toContain("## TODO");
  expect(prompt).toContain("sample");
});

test("renderDesignerNewPrompt includes path and context", () => {
  const prompt = renderDesignerNewPrompt(
    "/repo",
    "/repo/plan.md",
    "main",
    "opencode",
    "Build a feature"
  );

  expect(prompt).toContain("Designer: Create a New Plan");
  expect(prompt).toContain("/repo/plan.md");
  expect(prompt).toContain("Build a feature");
  expect(prompt).toContain("main");
  expect(prompt).toContain("opencode");
  expect(prompt).toContain("/repo");
});

test("renderDesignerEditPrompt references plan path", () => {
  const existingPlan = "---\nid: old\n---\n\n## Objective\n\nOld plan";
  const prompt = renderDesignerEditPrompt(
    "/repo",
    "/repo/plan.md",
    existingPlan
  );

  expect(prompt).toContain("Designer: Edit an Existing Plan");
  expect(prompt).toContain("/repo/plan.md");
  expect(prompt).toContain("Read the current plan from:");
});

// loadAgentContext tests

test("loadAgentContext returns empty string when prloom dir missing", () => {
  mkdirSync(TEMP_REPO, { recursive: true });
  // No prloom/ dir created

  const result = loadAgentContext(TEMP_REPO, "planner");
  expect(result).toBe("");
});

test("loadAgentContext returns empty string when file missing", () => {
  mkdirSync(join(TEMP_REPO, "prloom"), { recursive: true });
  // prloom/ exists but no planner.md

  const result = loadAgentContext(TEMP_REPO, "planner");
  expect(result).toBe("");
});

test("loadAgentContext returns file contents for planner", () => {
  mkdirSync(join(TEMP_REPO, "prloom"), { recursive: true });
  writeFileSync(
    join(TEMP_REPO, "prloom", "planner.md"),
    "# Planner Context\n\nUse TypeScript."
  );

  const result = loadAgentContext(TEMP_REPO, "planner");
  expect(result).toContain("# Planner Context");
  expect(result).toContain("Use TypeScript");
});

test("loadAgentContext returns file contents for worker", () => {
  mkdirSync(join(TEMP_REPO, "prloom"), { recursive: true });
  writeFileSync(
    join(TEMP_REPO, "prloom", "worker.md"),
    "# Worker Context\n\nRun bun test."
  );

  const result = loadAgentContext(TEMP_REPO, "worker");
  expect(result).toContain("# Worker Context");
  expect(result).toContain("Run bun test");
});

test("renderWorkerPrompt appends context when worker.md exists", () => {
  mkdirSync(join(TEMP_REPO, "prloom"), { recursive: true });
  writeFileSync(
    join(TEMP_REPO, "prloom", "worker.md"),
    "# Custom Worker Instructions"
  );

  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 0, text: "Test task", done: false, blocked: false };

  const prompt = renderWorkerPrompt(TEMP_REPO, "prloom/.local/plan.md", plan, todo);
  expect(prompt).toContain("TODO #1: Test task");
  expect(prompt).toContain("# Repository Context");
  expect(prompt).toContain("# Custom Worker Instructions");
});

test("renderDesignerNewPrompt appends context when planner.md exists", () => {
  mkdirSync(join(TEMP_REPO, "prloom"), { recursive: true });
  writeFileSync(
    join(TEMP_REPO, "prloom", "planner.md"),
    "# Architecture Notes"
  );

  const prompt = renderDesignerNewPrompt(
    TEMP_REPO,
    join(TEMP_REPO, "plan.md"),
    "main",
    "opencode"
  );
  expect(prompt).toContain("# Repository Context");
  expect(prompt).toContain("# Architecture Notes");
});

test("renderTriagePrompt includes inReplyToId thread context", () => {
  const { renderTriagePrompt } = require("../../src/lib/template.js");
  const plan = parsePlan(FIXTURE_PATH);
  const feedback = [
    {
      id: 123,
      type: "review_comment",
      author: "reviewer",
      body: "This is a reply",
      path: "src/foo.ts",
      line: 10,
      createdAt: "2024-01-01T00:00:00Z",
      inReplyToId: 100,
    },
  ];

  const prompt = renderTriagePrompt("/repo", "/worktree", plan, feedback);
  expect(prompt).toContain("In reply to comment #100");
});
