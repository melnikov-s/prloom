import { loadState } from "../lib/state.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runLogs(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  const state = loadState(repoRoot);
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    const options = Object.entries(state.plans).map(([id, ps]) => ({
      id,
      label: id,
      metadata: ps.status ?? "unknown",
      color: ps.status === "blocked" ? "red" : "green",
    }));

    if (options.length === 0) {
      console.log("No active plans found.");
      return;
    }

    planId = await promptSelection("Select a plan to show logs:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    process.exit(1);
  }

  console.log(`Plan: ${planId}`);
  console.log(`Session ID: ${ps.sessionId ?? "—"}`);
  console.log(`Worktree: ${ps.worktree || "—"}`);
  console.log(`Branch: ${ps.branch || "—"}`);
  console.log(`PR: ${ps.pr ?? "—"}`);

  console.log(`Last Polled: ${ps.lastPolledAt ?? "—"}`);
  console.log(`Last Error: ${ps.lastError ?? "—"}`);
}
