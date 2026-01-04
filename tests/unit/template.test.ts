import { test, expect } from "bun:test";
import { join } from "path";
import {
  renderWorkerPrompt,
  renderDesignerPrompt,
} from "../../src/lib/template.js";
import { parsePlan } from "../../src/lib/plan.js";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");

test("renderWorkerPrompt uses built-in template", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const todo = { index: 0, text: "First task", done: false };

  const prompt = renderWorkerPrompt("/does-not-matter", plan, todo);

  expect(prompt).toContain("TODO #0: First task");
  expect(prompt).toContain("# Plan");
  expect(prompt).toContain("sample");
});

test("renderDesignerPrompt uses built-in template", () => {
  const prompt = renderDesignerPrompt("/does-not-matter");

  expect(prompt).toContain("Designer Instructions");
});

test("renderDesignerPrompt includes existing plan when provided", () => {
  const existingPlan = "---\nid: old\n---\n\n## Objective\n\nOld plan";
  const prompt = renderDesignerPrompt("/does-not-matter", existingPlan);

  expect(prompt).toContain("Existing Plan");
  expect(prompt).toContain("Old plan");
});
