import { join } from "path";
import { setStatus } from "../lib/plan.js";
import { loadState, saveState } from "../lib/state.js";

export async function runBlock(
  repoRoot: string,
  planId: string
): Promise<void> {
  const state = loadState(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan ${planId} not found in active plans`);
    process.exit(1);
  }

  ps.status = "blocked";
  saveState(repoRoot, state);
  console.log(`⏹️ Blocked ${planId}`);
}
