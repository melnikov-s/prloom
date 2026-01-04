import { readFileSync, writeFileSync } from "fs";
import matter from "gray-matter";
import { type AgentName, isAgentName } from "./adapters/index.js";

export type PlanStatus = "queued" | "active" | "blocked" | "done";

export interface PlanFrontmatter {
  id: string;
  status: PlanStatus;
  agent?: AgentName;
  branch?: string;
  pr?: number;
}

export interface TodoItem {
  index: number;
  text: string;
  done: boolean;
}

export interface Plan {
  path: string;
  frontmatter: PlanFrontmatter;
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
    agent: parseAgentField(data.agent),
    branch: data.branch,
    pr: data.pr,
  };

  // Extract sections
  const objective = extractSection(content, "Objective") ?? "";
  const context = extractSection(content, "Context") ?? "";
  const progressLog = extractSection(content, "Progress Log") ?? "";

  // Parse TODOs
  const todoSection = extractSection(content, "TODO") ?? "";
  const todos = parseTodos(todoSection);

  return {
    path,
    frontmatter,
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

function parseTodos(section: string): TodoItem[] {
  const lines = section.split("\n");
  const todos: TodoItem[] = [];
  let index = 0;

  for (const line of lines) {
    const checkboxMatch = line.match(/^- \[([\s\S])\] (.+)$/);
    if (checkboxMatch && checkboxMatch[1] && checkboxMatch[2]) {
      todos.push({
        index,
        text: checkboxMatch[2].trim(),
        done: checkboxMatch[1].toLowerCase() === "x",
      });
      index++;
    }
  }

  return todos;
}

function parseAgentField(value: unknown): AgentName | undefined {
  if (typeof value === "string" && isAgentName(value)) {
    return value;
  }
  return undefined;
}

export function findNextUnchecked(plan: Plan): TodoItem | null {
  return plan.todos.find((t) => !t.done) ?? null;
}

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
  return `## Objective\n\n${plan.objective}\n\n## Progress Log\n\n${plan.progressLog}`;
}

/**
 * Generate a plan skeleton with deterministic frontmatter.
 * The designer agent will fill in the content sections.
 */
export function generatePlanSkeleton(id: string, agent?: AgentName): string {
  const frontmatter: Record<string, string> = {
    id,
    status: "queued",
  };

  if (agent) {
    frontmatter.agent = agent;
  }

  const content = `
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

/**
 * Ensure plan status is 'active'.
 * If status is 'done' and we're adding new TODOs, flip it back to 'active'.
 */
export function ensureActiveStatus(path: string): void {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  if (data.status === "done" || data.status === "queued") {
    data.status = "active";
    const updated = matter.stringify(content, data);
    writeFileSync(path, updated);
  }
}
