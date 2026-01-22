import { loadState, saveState } from "../lib/state.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runResume(
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
        metadata: ps.blocked ? "blocked" : (ps.status ?? "unknown"),
        color: ps.status === "paused" ? "blue" : ps.blocked ? "red" : "green",
      }))
      .filter((opt) => opt.metadata === "paused");

    if (options.length === 0) {
      console.log("No paused plans found.");
      return;
    }

    planId = await promptSelection("Select a plan to resume:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan ${planId} not found in active plans`);
    process.exit(1);
  }

  if (ps.status !== "paused") {
    console.log(`Plan ${planId} is not paused.`);
    return;
  }

  ps.status = "active";
  ps.lastError = undefined;

  saveState(repoRoot, state);

  console.log(`▶️ Resumed ${planId}`);
}
