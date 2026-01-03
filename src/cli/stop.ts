import { enqueue } from "../lib/ipc.js";

export async function runStop(repoRoot: string, planId: string): Promise<void> {
  enqueue(repoRoot, { type: "stop", plan_id: planId });
  console.log(`Enqueued stop for ${planId}`);
  console.log("Dispatcher will pause this plan on next cycle.");
}
