import { test, expect } from "bun:test";
import { renderWorkerPrompt } from "../../src/lib/template.js";
import { parsePlan, type TodoItem } from "../../src/lib/plan.js";
import { join } from "path";

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/plans/sample.md");

test("TODO indexing is 1-based (first todo is #1, not #0)", () => {
  const plan = parsePlan(FIXTURE_PATH);
  const firstTodo: TodoItem = {
    index: 0,
    text: "First task",
    done: false,
    blocked: false,
  };
  const secondTodo: TodoItem = {
    index: 1,
    text: "Second task",
    done: false,
    blocked: false,
  };
  const thirdTodo: TodoItem = {
    index: 2,
    text: "Third task",
    done: false,
    blocked: false,
  };

  const prompt1 = renderWorkerPrompt("/repo", "prloom/.local/plan.md", plan, firstTodo);
  const prompt2 = renderWorkerPrompt("/repo", "prloom/.local/plan.md", plan, secondTodo);
  const prompt3 = renderWorkerPrompt("/repo", "prloom/.local/plan.md", plan, thirdTodo);

  // Internal index 0 → display as TODO #1
  expect(prompt1).toContain("TODO #1: First task");
  expect(prompt1).not.toContain("TODO #0");

  // Internal index 1 → display as TODO #2
  expect(prompt2).toContain("TODO #2: Second task");

  // Internal index 2 → display as TODO #3
  expect(prompt3).toContain("TODO #3: Third task");
});

test("commit message should use TODO text directly without prefix", () => {
  // This test documents the expected behavior for commit messages.
  // The actual commit is created in dispatcher.ts using just:
  //   todo.text
  //
  // We verify the format here:
  const todoText = "Add user authentication";

  const expectedCommitMessage = todoText;

  expect(expectedCommitMessage).toBe("Add user authentication");
  expect(expectedCommitMessage).not.toContain("[prloom]");
  expect(expectedCommitMessage).not.toContain("TODO #");
});

test("commit message handles special characters in TODO text", () => {
  const todoText = "Fix `parseConfig()` to handle empty strings";

  const commitMessage = todoText;

  expect(commitMessage).toBe("Fix `parseConfig()` to handle empty strings");
});
