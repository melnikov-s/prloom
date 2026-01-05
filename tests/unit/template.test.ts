import { test, expect } from "bun:test";
import { join } from "path";
import {
  renderWorkerPrompt,
  renderDesignerNewPrompt,
  renderDesignerEditPrompt,
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

test("renderDesignerNewPrompt includes path and context", () => {
  const prompt = renderDesignerNewPrompt(
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
});

test("renderDesignerEditPrompt includes existing plan", () => {
  const existingPlan = "---\nid: old\n---\n\n## Objective\n\nOld plan";
  const prompt = renderDesignerEditPrompt("/repo/plan.md", existingPlan);

  expect(prompt).toContain("Designer: Edit an Existing Plan");
  expect(prompt).toContain("/repo/plan.md");
  expect(prompt).toContain("Old plan");
});
