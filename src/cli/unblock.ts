import { join } from "path";
import { setStatus } from "../lib/plan.js";
import { loadState, saveState } from "../lib/state.js";

import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runUnblock(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  let planId: string;
  const state = loadState(repoRoot);

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    const options = Object.entries(state.plans)
      .map(([id, ps]) => ({
        id,
        label: id,
        metadata: ps.status ?? "unknown",
        color: ps.status === "blocked" ? "red" : "green",
      }))
      .filter((opt) => opt.metadata === "blocked");

    if (options.length === 0) {
      console.log("No blocked plans found.");
      return;
    }

    planId = await promptSelection("Select a plan to unblock:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan ${planId} not found in active plans`);
    process.exit(1);
  }

  ps.status = "active";

  // Reset retry counter
  ps.lastTodoIndex = undefined;
  ps.todoRetryCount = undefined;

  // Save to main state file so dispatcher picks it up
  saveState(repoRoot, state);

  console.log(`▶️ Unblocked ${planId}`);
}
