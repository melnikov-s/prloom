import { loadState, deleteInboxPlan, listInboxPlanIds } from "../lib/state.js";
import { removeWorktree } from "../lib/git.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";
import { confirm } from "./prompt.js";

export async function runDelete(
  repoRoot: string,
  planIdInput?: string,
  force?: boolean
): Promise<void> {
  let planId: string;
  const state = loadState(repoRoot);

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    // Collect options from state and inbox
    const diskIds = listInboxPlanIds(repoRoot);
    const allIds = Array.from(
      new Set([...Object.keys(state.plans), ...diskIds])
    );

    const options = allIds.map((id) => {
      const ps = state.plans[id] ?? { status: "draft" as const };
      const isDraftOrQueued = ps.status === "draft" || ps.status === "queued";
      return {
        id,
        label: id,
        metadata: isDraftOrQueued
          ? `inbox [${ps.status}]`
          : `worktree [${ps.status}]`,
        color:
          ps.status === "draft"
            ? "yellow"
            : ps.status === "done"
            ? "gray"
            : ps.blocked
            ? "red"
            : "green",
      };
    });

    if (options.length === 0) {
      console.log("No plans found to delete.");
      return;
    }

    planId = await promptSelection("Select a plan to delete:", options);
  }

  const ps = state.plans[planId];

  // Determine if this is an inbox plan or active worktree plan
  const isInbox = !ps?.worktree;
  const location = isInbox ? "inbox" : "worktree";

  // Confirmation logic:
  // - If --force is passed, skip confirmation
  // - Otherwise, always confirm (standard CLI practice for destructive operations)
  if (!force) {
    const shouldDelete = await confirm(
      `Delete plan "${planId}" from ${location}? This cannot be undone.`
    );
    if (!shouldDelete) {
      console.log("Aborted.");
      return;
    }
  }

  if (isInbox) {
    // Delete inbox plan (.md and .json files)
    deleteInboxPlan(repoRoot, planId);
    console.log(`Deleted inbox plan: ${planId}`);
  } else {
    // Delete worktree
    if (ps?.worktree) {
      await removeWorktree(repoRoot, ps.worktree);
      console.log(`Deleted worktree for plan: ${planId}`);
    } else {
      console.error(`Plan ${planId} has no associated worktree.`);
      process.exit(1);
    }
  }
}
