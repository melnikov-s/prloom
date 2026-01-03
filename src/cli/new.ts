import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { runDesigner } from "../lib/opencode.js";
import { renderDesignerPrompt } from "../lib/template.js";

export async function runNew(repoRoot: string, planId?: string): Promise<void> {
  const plansDir = join(repoRoot, "plans");

  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }

  console.log("Starting Designer session...");
  console.log(
    planId ? `Plan ID: ${planId}` : "Plan ID will be chosen during session"
  );

  const prompt = renderDesignerPrompt(repoRoot);
  await runDesigner(repoRoot, prompt);

  console.log("Designer session ended.");
}
