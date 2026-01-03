import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  renderWorkerPrompt,
  renderDesignerPrompt,
} from "../../src/lib/template.js";
import { parsePlan } from "../../src/lib/plan.js";

const TEST_DIR = "/tmp/swarm-test-template";
const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");

beforeEach(() => {
  mkdirSync(join(TEST_DIR, "prompts"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test("renderWorkerPrompt uses default template", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 0, text: "First task", done: false };

  const prompt = renderWorkerPrompt(TEST_DIR, plan, todo);

  expect(prompt).toContain("TODO #0: First task");
  expect(prompt).toContain("# Plan");
  expect(prompt).toContain("sample");
});

test("renderWorkerPrompt uses custom template if exists", () => {
  writeFileSync(
    join(TEST_DIR, "prompts", "worker.md"),
    "Custom: {{current_todo}}\n\n{{plan}}"
  );

  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 1, text: "Second task", done: false };

  const prompt = renderWorkerPrompt(TEST_DIR, plan, todo);

  expect(prompt).toContain("Custom: TODO #1: Second task");
});

test("renderDesignerPrompt uses default template", () => {
  const prompt = renderDesignerPrompt(TEST_DIR);

  expect(prompt).toContain("Designer Instructions");
  expect(prompt).toContain("plans/<id>.md");
});

test("renderDesignerPrompt includes existing plan when provided", () => {
  const existingPlan = "---\nid: old\n---\n\n## Objective\n\nOld plan";
  const prompt = renderDesignerPrompt(TEST_DIR, existingPlan);

  expect(prompt).toContain("Existing Plan to Refine");
  expect(prompt).toContain("Old plan");
});
