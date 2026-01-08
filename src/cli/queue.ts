import { existsSync } from "fs";
import {
  listInboxPlanIds,
  getInboxPath,
  getPlanMeta,
  setPlanStatus,
  loadState,
} from "../lib/state.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runQueue(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    // Show picker for draft plans
    const state = loadState(repoRoot);
    const diskIds = listInboxPlanIds(repoRoot);
    const allIds = Array.from(
      new Set([...Object.keys(state.plans), ...diskIds])
    );

    const options = allIds
      .map((id) => {
        const ps = state.plans[id] ?? { status: "draft" as const };
        return {
          id,
          label: id,
          metadata: ps.status,
          color: ps.status === "draft" ? "yellow" : "gray",
        };
      })
      .filter((opt) => opt.metadata === "draft");

    if (options.length === 0) {
      console.log("No draft plans found in inbox.");
      return;
    }

    planId = await promptSelection("Select a plan to queue:", options);
  }

  const inboxPath = getInboxPath(repoRoot, planId);

  if (!existsSync(inboxPath)) {
    console.error(`Plan not found in inbox: ${planId}`);
    console.error("Only plans in the inbox can be queued.");
    process.exit(1);
  }

  const ps = getPlanMeta(repoRoot, planId);

  if (ps.status === "queued") {
    console.log(`Plan ${planId} is already queued.`);
    return;
  }

  setPlanStatus(repoRoot, planId, "queued");
  console.log(`✅ Queued ${planId} for dispatch.`);
}
