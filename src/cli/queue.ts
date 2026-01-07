import { existsSync } from "fs";
import {
  listInboxPlanIds,
  getInboxPath,
  getInboxMeta,
  setInboxStatus,
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
    const inboxIds = listInboxPlanIds(repoRoot);
    const options = inboxIds
      .map((id) => {
        const meta = getInboxMeta(repoRoot, id);
        return {
          id,
          label: id,
          metadata: meta.status,
          color: meta.status === "draft" ? "yellow" : "gray",
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

  const meta = getInboxMeta(repoRoot, planId);

  if (meta.status === "queued") {
    console.log(`Plan ${planId} is already queued.`);
    return;
  }

  setInboxStatus(repoRoot, planId, "queued");
  console.log(`✅ Queued ${planId} for dispatch.`);
}
