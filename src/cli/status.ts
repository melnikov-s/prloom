import { glob } from "glob";
import { join } from "path";
import { loadState } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";

export async function runStatus(repoRoot: string): Promise<void> {
  const state = loadState(repoRoot);
  const planFiles = await glob("plans/*.md", { cwd: repoRoot });

  console.log("PLAN              STATUS    PAUSED  SESSION");
  console.log("─".repeat(55));

  for (const planFile of planFiles) {
    const planPath = join(repoRoot, planFile);
    const plan = parsePlan(planPath);
    const ps = state.plans[plan.frontmatter.id];

    const status = plan.frontmatter.status.padEnd(10);
    const paused = ps?.paused ? "yes" : "no";
    const session = ps?.session_id ?? "—";

    console.log(
      `${plan.frontmatter.id.padEnd(18)} ${status} ${paused.padEnd(
        8
      )} ${session}`
    );
  }

  if (planFiles.length === 0) {
    console.log("No plans found in plans/");
  }
}
