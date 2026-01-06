import { join } from "path";
import { existsSync } from "fs";
import { loadState, listInboxPlanIds, getInboxPath } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";

export async function runStatus(repoRoot: string): Promise<void> {
  const state = loadState(repoRoot);
  const inboxPlanIds = listInboxPlanIds(repoRoot);

  // Show inbox plans
  console.log("INBOX (pending dispatch)");
  console.log("─".repeat(60));

  if (inboxPlanIds.length === 0) {
    console.log("  (no inbox plans)");
  } else {
    for (const id of inboxPlanIds) {
      const inboxPath = getInboxPath(repoRoot, id);
      const plan = parsePlan(inboxPath);
      const status = plan.frontmatter.status;
      console.log(`  ${id} [${status}]`);
      console.log(`    Path: ${inboxPath}`);
    }
  }

  console.log("");

  // Show active plans from state
  console.log("ACTIVE PLANS");
  console.log("─".repeat(60));

  const planIds = Object.keys(state.plans);

  if (planIds.length === 0) {
    console.log("  (no active plans)");
  } else {
    for (const planId of planIds) {
      const ps = state.plans[planId]!;
      const planPath = join(ps.worktree, ps.planRelpath);

      let status = "unknown";
      let agent = "—";
      if (existsSync(planPath)) {
        try {
          const plan = parsePlan(planPath);
          status = plan.frontmatter.status;
          agent = plan.frontmatter.agent ?? "default";
        } catch {
          status = "error";
        }
      }

      const prNum = ps.pr ? `PR #${ps.pr}` : "No PR";

      console.log(`${planId}`);
      console.log(`  Status:   ${status}`);
      console.log(`  Agent:    ${agent}`);
      console.log(`  PR:       ${prNum}`);
      console.log(`  Worktree: ${ps.worktree}`);
      console.log(`  Plan:     ${planPath}`);
      console.log("");
    }
  }

  // Add hints
  console.log("─".repeat(60));
  console.log("COMMANDS:");
  console.log(
    "  prloom new <id> --agent manual --no-designer  Create a new plan"
  );
  console.log(
    "  prloom poll <id>                              View PR feedback"
  );
  console.log("  prloom edit <id> --no-designer                Get plan path");
}
