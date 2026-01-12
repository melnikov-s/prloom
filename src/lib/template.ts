import Handlebars from "handlebars";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { Plan, TodoItem } from "./plan.js";
import type { PRFeedback } from "./github.js";
import { BUILTIN_PROMPTS, type PromptName } from "./prompt_sources.js";

// Prompts are bundled into the CLI.
// They are stored as individual files in this repo under `prompts/`, but read
// and embedded at build time via `src/lib/prompt_sources.ts`.

function loadTemplate(_repoRoot: string, name: PromptName): string {
  return BUILTIN_PROMPTS[name];
}

/**
 * Load agent-specific context from prloom/<agentType>.md if it exists.
 * Returns empty string if the file doesn't exist.
 */
export function loadAgentContext(
  repoRoot: string,
  agentType: "planner" | "worker"
): string {
  const contextPath = join(repoRoot, "prloom", `${agentType}.md`);
  if (!existsSync(contextPath)) {
    return "";
  }
  return readFileSync(contextPath, "utf-8");
}

function formatPlanTodos(todos: TodoItem[]): string {
  return todos
    .map((t) => {
      const marker = t.done ? "x" : t.blocked ? "b" : " ";
      return `- [${marker}] ${t.text}`;
    })
    .join("\n");
}

export function renderWorkerPrompt(
  repoRoot: string,
  plan: Plan,
  todo: TodoItem
): string {
  const template = loadTemplate(repoRoot, "worker");
  const compiled = Handlebars.compile(template);

  const planTodos = formatPlanTodos(plan.todos);

  // Format current todo with context if available
  let currentTodo = `TODO #${todo.index + 1}: ${todo.text}`;
  if (todo.context) {
    currentTodo += `\n\n**Context:**\n${todo.context}`;
  }

  let prompt = compiled({
    plan_title: plan.title,
    plan_objective: plan.objective,
    plan_context: plan.context,
    plan_todos: planTodos,
    plan_progress_log: plan.progressLog,
    current_todo: currentTodo,
    plan: plan.raw,
  });

  const context = loadAgentContext(repoRoot, "worker");
  if (context) {
    prompt += `\n\n---\n\n# Repository Context\n\n${context}`;
  }
  return prompt;
}

export function renderDesignerNewPrompt(
  repoPath: string,
  planPath: string,
  baseBranch: string,
  workerAgent: string,
  userDescription?: string
): string {
  const template = BUILTIN_PROMPTS["designer_new"];
  const compiled = Handlebars.compile(template);
  let prompt = compiled({
    repo_path: repoPath,
    plan_path: planPath,
    base_branch: baseBranch,
    worker_agent: workerAgent,
    user_description: userDescription ?? "",
  });

  const context = loadAgentContext(repoPath, "planner");
  if (context) {
    prompt += `\n\n---\n\n# Repository Context\n\n${context}`;
  }
  return prompt;
}

export function renderDesignerEditPrompt(
  repoPath: string,
  planPath: string,
  _existingPlan: string
): string {
  const template = BUILTIN_PROMPTS["designer_edit"];
  const compiled = Handlebars.compile(template);
  let prompt = compiled({
    plan_path: planPath,
  });

  const context = loadAgentContext(repoPath, "planner");
  if (context) {
    prompt += `\n\n---\n\n# Repository Context\n\n${context}`;
  }
  return prompt;
}

// Triage

export interface TriageResult {
  reply_markdown: string;
  rebase_requested: boolean;
}

export function renderTriagePrompt(
  repoRoot: string,
  worktreePath: string,
  plan: Plan,
  feedback: PRFeedback[]
): string {
  const template = loadTemplate(repoRoot, "review_triage");

  // Format feedback for the prompt
  const feedbackText = feedback
    .map((f) => {
      let entry = `### ${f.type} by @${f.author}\n\n${f.body}`;
      if (f.path) entry += `\n\n*File: ${f.path}${f.line ? `:${f.line}` : ""}*`;
      if (f.diffHunk) entry += `\n\n**Code context:**\n\`\`\`diff\n${f.diffHunk}\n\`\`\``;
      if (f.reviewState) entry += `\n\n*Review: ${f.reviewState}*`;
      if (f.inReplyToId) entry += `\n\n*In reply to comment #${f.inReplyToId}*`;
      return entry;
    })
    .join("\n\n---\n\n");

  const resultPath = join(worktreePath, TRIAGE_RESULT_FILE);

  const compiled = Handlebars.compile(template);
  return compiled({
    feedback: feedbackText,
    plan: plan.raw,
    result_path: resultPath,
  });
}

const TRIAGE_RESULT_FILE = "prloom/.local/triage-result.json";

export function readTriageResultFile(worktreePath: string): TriageResult {
  const resultPath = join(worktreePath, TRIAGE_RESULT_FILE);

  if (!existsSync(resultPath)) {
    throw new Error("Triage result file not found");
  }

  const raw = readFileSync(resultPath, "utf-8");
  const result = JSON.parse(raw);

  // Validate required fields
  if (typeof result.reply_markdown !== "string") {
    throw new Error("Invalid triage result: missing reply_markdown");
  }
  if (typeof result.rebase_requested !== "boolean") {
    throw new Error("Invalid triage result: missing rebase_requested");
  }

  // Delete the file after reading
  unlinkSync(resultPath);

  return {
    reply_markdown: result.reply_markdown,
    rebase_requested: result.rebase_requested,
  };
}
