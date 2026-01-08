import { readFileSync, writeFileSync } from "fs";

export interface TodoItem {
  index: number;
  text: string;
  done: boolean;
  blocked: boolean;
  /** Indented lines following the TODO that provide additional context */
  context?: string;
}

export interface Plan {
  path: string;
  title: string;
  objective: string;
  context: string;
  todos: TodoItem[];
  progressLog: string;
  raw: string;
}

export function parsePlan(path: string): Plan {
  const raw = readFileSync(path, "utf-8");

  // Extract sections (no frontmatter - just pure markdown)
  // Strip HTML comments from title so placeholder comments don't become PR titles
  const rawTitle = extractSection(raw, "Title") ?? "";
  const title = stripHtmlComments(rawTitle);
  const objective = extractSection(raw, "Objective") ?? "";
  const context = extractSection(raw, "Context") ?? "";
  const progressLog = extractSection(raw, "Progress Log") ?? "";

  // Parse TODOs
  const todoSection = extractSection(raw, "TODO") ?? "";
  const todos = parseTodos(todoSection);

  return {
    path,
    title,
    objective,
    context,
    todos,
    progressLog,
    raw,
  };
}

function extractSection(content: string, heading: string): string | null {
  const regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = content.match(regex);
  return match ? match[1]!.trim() : null;
}

/**
 * Strip HTML comments from content.
 * Used to clean up placeholder comments that shouldn't appear in output.
 */
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function parseTodos(section: string): TodoItem[] {
  const lines = section.split("\n");
  const todos: TodoItem[] = [];
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const checkboxMatch = line.match(/^- \[([\s\S])\] (.+)$/);
    if (checkboxMatch && checkboxMatch[1] && checkboxMatch[2]) {
      const marker = checkboxMatch[1].toLowerCase();

      // Collect any indented context lines that follow
      const contextLines: string[] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!;
        // Context lines must be indented (start with spaces/tabs) and not be another checkbox
        if (nextLine.match(/^[\t ]+/) && !nextLine.match(/^\s*- \[/)) {
          contextLines.push(nextLine);
          i++;
        } else {
          break;
        }
      }

      todos.push({
        index,
        text: checkboxMatch[2].trim(),
        done: marker === "x",
        blocked: marker === "b",
        context: contextLines.length > 0 ? contextLines.join("\n") : undefined,
      });
      index++;
    }
  }

  return todos;
}

export function findNextUnchecked(plan: Plan): TodoItem | null {
  return plan.todos.find((t) => !t.done) ?? null;
}

export function extractBody(plan: Plan): string {
  let body = `## Objective\n\n${plan.objective}`;

  if (plan.context) {
    body += `\n\n## Context\n\n${plan.context}`;
  }

  if (plan.progressLog) {
    body += `\n\n## Progress Log\n\n${plan.progressLog}`;
  }

  return body;
}

/**
 * Generate a plan skeleton (pure markdown, no frontmatter).
 * The designer agent will fill in the content sections.
 * All metadata is tracked in state.json.
 */
export function generatePlanSkeleton(): string {
  return `## Title

<!-- Short PR title (e.g., "Fix PDF viewer pagination") -->

## Objective

<!-- Describe what will be built -->

## Context

<!-- Key files, test commands, constraints -->

## TODO

- [ ] <!-- First task -->

## Progress Log

<!-- Worker appends entries here -->
`;
}

/**
 * Add new TODOs to the plan's TODO section.
 * Inserts at the end of the TODO list.
 */
export function addTodos(path: string, todos: string[]): void {
  if (todos.length === 0) return;

  const raw = readFileSync(path, "utf-8");

  // Find the TODO section and append new items
  const todoPattern = /## TODO\s*\n([\s\S]*?)(?=\n## |$)/i;
  const match = raw.match(todoPattern);

  if (!match) {
    throw new Error("No TODO section found in plan");
  }

  const todoSection = match[1]!;
  const newTodos = todos.map((t) => `- [ ] ${t}`).join("\n");
  const updatedTodoSection = todoSection.trimEnd() + "\n" + newTodos + "\n";

  const updated = raw.replace(todoPattern, `## TODO\n${updatedTodoSection}`);

  writeFileSync(path, updated);
}

/**
 * Append an entry to the Progress Log section.
 */
export function appendProgressLog(path: string, entry: string): void {
  const raw = readFileSync(path, "utf-8");

  const logPattern = /## Progress Log\s*\n([\s\S]*)$/i;
  const match = raw.match(logPattern);

  if (!match) {
    throw new Error("No Progress Log section found in plan");
  }

  const logSection = match[1]!;
  const timestamp = new Date().toISOString().split("T")[0];
  const newEntry = `\n- ${timestamp}: ${entry}`;
  const updatedLogSection = logSection.trimEnd() + newEntry + "\n";

  const updated = raw.replace(logPattern, `## Progress Log\n${updatedLogSection}`);

  writeFileSync(path, updated);
}
