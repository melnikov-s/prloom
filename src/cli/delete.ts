import { loadState, deleteInboxPlan, listInboxPlanIds } from "../lib/state.js";
import { removeWorktree } from "../lib/git.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelectionWithConfirm } from "../ui/Selection.js";
import { confirm } from "./prompt.js";

export async function runDelete(
  repoRoot: string,
  planIdInput?: string,
  force?: boolean
): Promise<void> {
  let planId: string;
  const state = loadState(repoRoot);

  if (planIdInput) {
    // Direct ID provided - use readline confirmation (no ink involved)
    planId = await resolvePlanId(repoRoot, planIdInput);

    const ps = state.plans[planId];
    const isInbox = !ps?.worktree;
    const location = isInbox ? "inbox" : "worktree";

    if (!force) {
      const shouldDelete = await confirm(
        `Delete plan "${planId}" from ${location}? This cannot be undone.`
      );
      if (!shouldDelete) {
        console.log("Aborted.");
        return;
      }
    }

    await deletePlan(repoRoot, planId, state);
  } else {
    // Interactive selection with built-in confirmation (all in ink)
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

    const selectedId = await promptSelectionWithConfirm(
      "Select a plan to delete:",
      options,
      (option) => {
        const ps = state.plans[option.id];
        const location = ps?.worktree ? "worktree" : "inbox";
        return `Delete plan "${option.id}" from ${location}? This cannot be undone.`;
      }
    );

    if (!selectedId) {
      console.log("Aborted.");
      return;
    }

    planId = selectedId;
    await deletePlan(repoRoot, planId, state);
  }
}

async function deletePlan(
  repoRoot: string,
  planId: string,
  state: ReturnType<typeof loadState>
): Promise<void> {
  const ps = state.plans[planId];
  const isInbox = !ps?.worktree;

  if (isInbox) {
    deleteInboxPlan(repoRoot, planId);
    console.log(`Deleted inbox plan: ${planId}`);
  } else {
    if (ps?.worktree) {
      await removeWorktree(repoRoot, ps.worktree);
      console.log(`Deleted worktree for plan: ${planId}`);
    } else {
      console.error(`Plan ${planId} has no associated worktree.`);
      process.exit(1);
    }
  }
}
