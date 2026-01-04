import { join } from "path";
import { existsSync } from "fs";
import { loadState, listInboxPlanIds } from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";

export async function runStatus(repoRoot: string): Promise<void> {
  const state = loadState(repoRoot);
  const inboxPlanIds = listInboxPlanIds(repoRoot);

  // Show inbox plans
  console.log("INBOX (pending dispatch)");
  console.log("─".repeat(40));

  if (inboxPlanIds.length === 0) {
    console.log("  (no inbox plans)");
  } else {
    for (const id of inboxPlanIds) {
      console.log(`  ${id}`);
    }
  }

  console.log("");

  // Show active plans from state
  console.log("ACTIVE PLANS");
  console.log("─".repeat(70));
  console.log("PLAN              STATUS    PAUSED  PR#     SESSION");
  console.log("─".repeat(70));

  const planIds = Object.keys(state.plans);

  if (planIds.length === 0) {
    console.log("  (no active plans)");
  } else {
    for (const planId of planIds) {
      const ps = state.plans[planId]!;
      const planPath = join(ps.worktree, ps.planRelpath);

      let status = "unknown";
      if (existsSync(planPath)) {
        try {
          const plan = parsePlan(planPath);
          status = plan.frontmatter.status;
        } catch {
          status = "error";
        }
      }

      const paused = ps.paused ? "yes" : "no";
      const prNum = ps.pr ? String(ps.pr) : "—";
      const session = ps.sessionId ?? "—";

      console.log(
        `${planId.padEnd(18)} ${status.padEnd(10)} ${paused.padEnd(
          8
        )} ${prNum.padEnd(8)} ${session}`
      );
    }
  }
}
