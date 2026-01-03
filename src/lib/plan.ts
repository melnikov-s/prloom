import { readFileSync, writeFileSync } from "fs";
import matter from "gray-matter";

export type PlanStatus = "queued" | "active" | "blocked" | "done";

export interface PlanFrontmatter {
  id: string;
  status: PlanStatus;
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
