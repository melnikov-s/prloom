import { join } from "path";
import { loadState, getInboxPath, listInboxPlanIds } from "../lib/state.js";

export async function runStatus(repoRoot: string): Promise<void> {
  const state = loadState(repoRoot);
  const diskInboxIds = listInboxPlanIds(repoRoot);

  // Merge: all IDs from state + any IDs from disk not yet in state
  const allIds = Array.from(
    new Set([...Object.keys(state.plans), ...diskInboxIds])
  );

  const inboxIds = allIds.filter((id) => {
    const ps = state.plans[id] || { status: "draft" };
    return ps.status === "draft" || ps.status === "queued";
  });
  const activeIds = allIds.filter((id) => !inboxIds.includes(id));

  // Show inbox plans
  console.log("INBOX (pending dispatch)");
  console.log("─".repeat(60));

  if (inboxIds.length === 0) {
    console.log("  (no inbox plans)");
  } else {
    for (const id of inboxIds) {
      const inboxPath = getInboxPath(repoRoot, id);
      const ps = state.plans[id] ?? { status: "draft" };
      console.log(`  ${id} [${ps.status}]`);
      console.log(`    Path: ${inboxPath}`);
    }
  }

  console.log("");

  // Show active plans
  console.log("ACTIVE PLANS");
  console.log("─".repeat(60));

  if (activeIds.length === 0) {
    console.log("  (no active plans)");
  } else {
    for (const planId of activeIds) {
      const ps = state.plans[planId]!;
      const planPath =
        ps.worktree && ps.planRelpath
          ? join(ps.worktree, ps.planRelpath)
          : "Not activated";

      const status = ps.status;
      const agent = ps.agent ?? "default";
      const prNum = ps.pr ? `PR #${ps.pr}` : "No PR";

      console.log(`${planId}`);
      console.log(`  Status:   ${status}`);
      console.log(`  Agent:    ${agent}`);
      console.log(`  PR:       ${prNum}`);
      if (ps.worktree) console.log(`  Worktree: ${ps.worktree}`);
      console.log(`  Plan:     ${planPath}`);
      console.log("");
    }
  }

  // Add hints
  console.log("─".repeat(60));
  console.log("COMMANDS:");
  console.log(
    "  prloom new <id> --no-designer                  Create a new plan"
  );
  console.log(
    "  prloom poll <id>                              View PR feedback"
  );
  console.log("  prloom edit <id> --no-designer                Get plan path");
}
