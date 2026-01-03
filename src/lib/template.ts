import Handlebars from "handlebars";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Plan, TodoItem } from "./plan.js";

export function renderWorkerPrompt(
  repoRoot: string,
  plan: Plan,
  todo: TodoItem
): string {
  const templatePath = join(repoRoot, "prompts", "worker.md");

  let template: string;
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else {
    template = DEFAULT_WORKER_TEMPLATE;
  }

  const compiled = Handlebars.compile(template);
  return compiled({
    current_todo: `TODO #${todo.index}: ${todo.text}`,
    plan: plan.raw,
  });
}

export function renderDesignerPrompt(
  repoRoot: string,
  existingPlan?: string
): string {
  const templatePath = join(repoRoot, "prompts", "designer.md");

  let template: string;
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else {
    template = DEFAULT_DESIGNER_TEMPLATE;
  }

  const compiled = Handlebars.compile(template);
  return compiled({
    existing_plan: existingPlan ?? "",
  });
}

const DEFAULT_WORKER_TEMPLATE = `# Worker Instructions

You are implementing exactly ONE task from this plan.

## Your Task
{{current_todo}}

## Rules
1. Implement only the specified task
2. Update the plan file:
   - Mark the task as [x]
   - Add a Progress Log entry
3. Run tests if specified in Context
4. If stuck, set frontmatter \`status: blocked\`
5. If this is the final TODO, set frontmatter \`status: done\`
6. Exit when complete

---

# Plan

{{plan}}
`;

const DEFAULT_DESIGNER_TEMPLATE = `# Designer Instructions

Help create a plan for a coding task.

1. Clarify what to build
2. Discuss implementation approach if needed
3. Output a plan with:
   - Clear objective
   - Inlined context (files, test commands)
   - TODO checklist (granular, sequential tasks)

Save to plans/<id>.md with frontmatter:
- id: <chosen-id>
- status: queued

{{#if existing_plan}}
## Existing Plan to Refine

{{existing_plan}}
{{/if}}
`;
