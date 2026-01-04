import Handlebars from "handlebars";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { Plan, TodoItem } from "./plan.js";
import type { PRFeedback } from "./github.js";

function loadTemplate(repoRoot: string, name: string): string {
  const templatePath = join(repoRoot, "prompts", `${name}.md`);
  if (!existsSync(templatePath)) {
    throw new Error(`Prompt template not found: ${templatePath}`);
  }
  return readFileSync(templatePath, "utf-8");
}

export function renderWorkerPrompt(
  repoRoot: string,
  plan: Plan,
  todo: TodoItem
): string {
  const template = loadTemplate(repoRoot, "worker");
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
  const template = loadTemplate(repoRoot, "designer");
  const compiled = Handlebars.compile(template);
  return compiled({
    existing_plan: existingPlan ?? "",
  });
}

// Triage

export interface TriageResult {
  reply_markdown: string;
  rebase_requested: boolean;
}

export function renderTriagePrompt(
  repoRoot: string,
  plan: Plan,
  feedback: PRFeedback[]
): string {
  const template = loadTemplate(repoRoot, "review_triage");

  // Format feedback for the prompt
  const feedbackText = feedback
    .map((f) => {
      let entry = `### ${f.type} by @${f.author}\n\n${f.body}`;
      if (f.path) entry += `\n\n*File: ${f.path}${f.line ? `:${f.line}` : ""}*`;
      if (f.reviewState) entry += `\n\n*Review: ${f.reviewState}*`;
      return entry;
    })
    .join("\n\n---\n\n");

  const compiled = Handlebars.compile(template);
  return compiled({
    feedback: feedbackText,
    plan: plan.raw,
  });
}

const TRIAGE_RESULT_FILE = ".swarm/triage-result.json";

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
