import { join } from "path";
import { setStatus } from "../lib/plan.js";
import { loadState, saveState } from "../lib/state.js";

export async function runUnblock(
  repoRoot: string,
  planId: string
): Promise<void> {
  const state = loadState(repoRoot);
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
