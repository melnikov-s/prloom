import { enqueue } from "../lib/ipc.js";

export async function runUnpause(
  repoRoot: string,
  planId: string
): Promise<void> {
  enqueue(repoRoot, { type: "unpause", plan_id: planId });
  console.log(`Enqueued unpause for ${planId}`);
  console.log("Dispatcher will resume this plan on next cycle.");
}
