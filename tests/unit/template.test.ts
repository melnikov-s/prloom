import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import {
  renderWorkerPrompt,
  renderDesignerPrompt,
} from "../../src/lib/template.js";
import { parsePlan } from "../../src/lib/plan.js";

const TEST_DIR = "/tmp/swarm-test-template";
const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");
const PROMPTS_DIR = join(import.meta.dir, "../../prompts");

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "prompts"), { recursive: true });
  // Copy prompt files from repo to test directory
  copyFileSync(
    join(PROMPTS_DIR, "worker.md"),
    join(TEST_DIR, "prompts", "worker.md")
  );
  copyFileSync(
    join(PROMPTS_DIR, "designer.md"),
    join(TEST_DIR, "prompts", "designer.md")
  );
  copyFileSync(
    join(PROMPTS_DIR, "review_triage.md"),
    join(TEST_DIR, "prompts", "review_triage.md")
  );
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("renderWorkerPrompt uses template file", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 0, text: "First task", done: false };

  const prompt = renderWorkerPrompt(TEST_DIR, plan, todo);

  expect(prompt).toContain("TODO #0: First task");
  expect(prompt).toContain("Plan");
  expect(prompt).toContain("sample");
});

test("renderWorkerPrompt uses custom template if provided", () => {
  writeFileSync(
    join(TEST_DIR, "prompts", "worker.md"),
    "Custom: {{current_todo}}\n\n{{plan}}"
  );

  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 1, text: "Second task", done: false };

  const prompt = renderWorkerPrompt(TEST_DIR, plan, todo);

  expect(prompt).toContain("Custom: TODO #1: Second task");
});

test("renderDesignerPrompt uses template file", () => {
  const prompt = renderDesignerPrompt(TEST_DIR);

  expect(prompt).toContain("Designer Instructions");
});

test("renderDesignerPrompt includes existing plan when provided", () => {
  const existingPlan = "---\nid: old\n---\n\n## Objective\n\nOld plan";
  const prompt = renderDesignerPrompt(TEST_DIR, existingPlan);

  expect(prompt).toContain("Existing Plan");
  expect(prompt).toContain("Old plan");
});
