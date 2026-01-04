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
