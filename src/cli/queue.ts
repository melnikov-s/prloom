import { join } from "path";
import { existsSync } from "fs";
import { listInboxPlanIds, getInboxPath } from "../lib/state.js";
import { parsePlan, setStatus } from "../lib/plan.js";
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
        const path = getInboxPath(repoRoot, id);
        const plan = parsePlan(path);
        return {
          id,
          label: id,
          metadata: plan.frontmatter.status ?? "draft",
          color: plan.frontmatter.status === "draft" ? "yellow" : "gray",
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

  const plan = parsePlan(inboxPath);

  if (plan.frontmatter.status === "queued") {
    console.log(`Plan ${planId} is already queued.`);
    return;
  }

  if (plan.frontmatter.status !== "draft") {
    console.warn(
      `Plan ${planId} has unexpected status: ${plan.frontmatter.status}`
    );
  }

  setStatus(inboxPath, "queued");
  console.log(`✅ Queued ${planId} for dispatch.`);
}
