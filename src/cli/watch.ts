import { execa } from "execa";
import { loadState } from "../lib/state.js";

import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runWatch(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  const state = loadState(repoRoot);
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    const options = Object.entries(state.plans)
      .map(([id, ps]) => ({
        id,
        label: id,
        metadata: ps.tmuxSession ? `tmux: ${ps.tmuxSession}` : undefined,
        color: ps.tmuxSession ? "green" : "gray",
        hasTmux: !!ps.tmuxSession,
      }))
      .filter((opt) => opt.hasTmux);

    if (options.length === 0) {
      console.log("No active tmux sessions found to watch.");
      return;
    }

    planId = await promptSelection("Select a plan to watch:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    console.error("Make sure the plan has been dispatched at least once.");
    process.exit(1);
  }

  if (!ps.tmuxSession) {
    console.error(`No active tmux session for ${planId}`);
    console.error(
      "This plan may not be running, or tmux is not installed on this system"
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
