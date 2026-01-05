import { execa } from "execa";
import { loadState } from "../lib/state.js";

export async function runWatch(
  repoRoot: string,
  planId: string
): Promise<void> {
  const state = loadState(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    console.error("Make sure the plan has been dispatched at least once.");
    process.exit(1);
  }

  if (!ps.tmuxSession) {
    console.error(`No active tmux session for ${planId}`);
    console.error(
      "This plan may not be running, or dispatcher wasn't started with --tmux"
    );
    process.exit(1);
  }

  console.log(`Attaching to ${ps.tmuxSession} (read-only)...`);
  console.log("Press Ctrl+B D to detach without interrupting the worker.");

  // Attach read-only (-r flag)
  await execa("tmux", ["attach", "-t", ps.tmuxSession, "-r"], {
    stdio: "inherit",
  });
}
