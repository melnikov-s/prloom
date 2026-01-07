import { readFileSync, writeFileSync } from "fs";
import matter from "gray-matter";

export type PlanStatus =
  | "draft"
  | "queued"
  | "active"
  | "blocked"
  | "review"
  | "reviewing"
  | "done";

export interface PlanFrontmatter {
  id: string;
  status: PlanStatus;
  branch?: string;
  pr?: number;
  base_branch?: string;
}

export interface TodoItem {
  index: number;
  text: string;
  done: boolean;
  blocked: boolean;
}

export interface Plan {
  path: string;
  frontmatter: PlanFrontmatter;
  title: string;
  objective: string;
  context: string;
  todos: TodoItem[];
  progressLog: string;
  raw: string;
}

export function parsePlan(path: string): Plan {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  const frontmatter: PlanFrontmatter = {
    id: data.id ?? "",
    status: data.status ?? "queued",
    branch: data.branch,
    pr: data.pr,
    base_branch:
      typeof data.base_branch === "string" ? data.base_branch : undefined,
  };

  // Extract sections
  // Strip HTML comments from title so placeholder comments don't become PR titles
  const rawTitle = extractSection(content, "Title") ?? "";
  const title = stripHtmlComments(rawTitle);
  const objective = extractSection(content, "Objective") ?? "";
  const context = extractSection(content, "Context") ?? "";
  const progressLog = extractSection(content, "Progress Log") ?? "";

  // Parse TODOs
  const todoSection = extractSection(content, "TODO") ?? "";
  const todos = parseTodos(todoSection);

  return {
    path,
    frontmatter,
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

  for (const line of lines) {
    const checkboxMatch = line.match(/^- \[([\s\S])\] (.+)$/);
    if (checkboxMatch && checkboxMatch[1] && checkboxMatch[2]) {
      const marker = checkboxMatch[1].toLowerCase();
      todos.push({
        index,
        text: checkboxMatch[2].trim(),
        done: marker === "x",
        blocked: marker === "b",
      });
      index++;
    }
  }

  return todos;
}

export function findNextUnchecked(plan: Plan): TodoItem | null {
  return plan.todos.find((t) => !t.done) ?? null;
}

/**
 * Set the status in plan frontmatter.
 * NOTE: This should only be used for inbox/pre-ingestion plans.
 * Once a plan is active, the dispatcher owns the status in state.json.
 */
export function setStatus(path: string, status: PlanStatus): void {
  const raw = readFileSync(path, "utf-8");
  const parsed = matter(raw);

  parsed.data.status = status;
  const updated = matter.stringify(parsed.content, parsed.data);
  writeFileSync(path, updated);
}

export function setBranch(path: string, branch: string): void {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  data.branch = branch;
  const updated = matter.stringify(content, data);
  writeFileSync(path, updated);
}

export function setPR(path: string, pr: number): void {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  data.pr = pr;
  const updated = matter.stringify(content, data);
  writeFileSync(path, updated);
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
 * Generate a plan skeleton with deterministic frontmatter.
 * The designer agent will fill in the content sections.
 */
export function generatePlanSkeleton(id: string, baseBranch?: string): string {
  const frontmatter: Record<string, string> = {
    id,
    branch: "", // Designer can specify a descriptive branch name here
    status: "draft",
  };

  if (baseBranch) {
    frontmatter.base_branch = baseBranch;
  }

  const content = `
## Title

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

  return matter.stringify(content.trim(), frontmatter);
}

/**
 * Add new TODOs to the plan's TODO section.
 * Inserts at the end of the TODO list.
 */
export function addTodos(path: string, todos: string[]): void {
  if (todos.length === 0) return;

  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  // Find the TODO section and append new items
  const todoPattern = /## TODO\s*\n([\s\S]*?)(?=\n## |$)/i;
  const match = content.match(todoPattern);

  if (!match) {
    throw new Error("No TODO section found in plan");
  }

  const todoSection = match[1]!;
  const newTodos = todos.map((t) => `- [ ] ${t}`).join("\n");
  const updatedTodoSection = todoSection.trimEnd() + "\n" + newTodos + "\n";

  const updatedContent = content.replace(
    todoPattern,
    `## TODO\n${updatedTodoSection}`
  );

  const updated = matter.stringify(updatedContent, data);
  writeFileSync(path, updated);
}

/**
 * Append an entry to the Progress Log section.
 */
export function appendProgressLog(path: string, entry: string): void {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  const logPattern = /## Progress Log\s*\n([\s\S]*)$/i;
  const match = content.match(logPattern);

  if (!match) {
    throw new Error("No Progress Log section found in plan");
  }

  const logSection = match[1]!;
  const timestamp = new Date().toISOString().split("T")[0];
  const newEntry = `\n- ${timestamp}: ${entry}`;
  const updatedLogSection = logSection.trimEnd() + newEntry + "\n";

  const updatedContent = content.replace(
    logPattern,
    `## Progress Log\n${updatedLogSection}`
  );

  const updated = matter.stringify(updatedContent, data);
  writeFileSync(path, updated);
}
