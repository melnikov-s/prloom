import { join } from "path";
import { existsSync } from "fs";
import { getInboxPath } from "../lib/state.js";
import { parsePlan, setStatus } from "../lib/plan.js";

export async function runQueue(
  repoRoot: string,
  planId: string
): Promise<void> {
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
