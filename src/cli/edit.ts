import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { runDesigner } from "../lib/opencode.js";
import { renderDesignerPrompt } from "../lib/template.js";

export async function runEdit(repoRoot: string, planId: string): Promise<void> {
  const planPath = join(repoRoot, "plans", `${planId}.md`);

  if (!existsSync(planPath)) {
    console.error(`Plan not found: ${planPath}`);
    process.exit(1);
  }

  const existingPlan = readFileSync(planPath, "utf-8");

  console.log(`Editing plan: ${planId}`);

  const prompt = renderDesignerPrompt(repoRoot, existingPlan);
  await runDesigner(repoRoot, prompt);

  console.log("Designer session ended.");
}
