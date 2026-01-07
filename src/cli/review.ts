import { loadState } from "../lib/state.js";
import { enqueue } from "../lib/ipc.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runReview(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  let planId: string;
  const state = loadState(repoRoot);

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    // Show only plans in "review" status
    const options = Object.entries(state.plans)
      .filter(([, ps]) => ps.status === "review")
      .map(([id, ps]) => ({
        id,
        label: id,
        metadata: ps.status ?? "unknown",
        color: "yellow" as const,
      }));

    if (options.length === 0) {
      console.log("No plans in review status found.");
      return;
    }

    planId = await promptSelection("Select a plan to review:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan ${planId} not found in active plans`);
    process.exit(1);
  }

  if (ps.status !== "review") {
    console.error(
      `Plan ${planId} is not in review status (current: ${ps.status})`
    );
    console.error("Review can only be triggered when all TODOs are complete.");
    process.exit(1);
  }

  // Send review command to dispatcher
  enqueue(repoRoot, { type: "review", plan_id: planId });
  console.log(`🔍 Triggered review for ${planId}`);
}
