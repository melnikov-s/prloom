import { loadState } from "../lib/state.js";
import { resumeSession } from "../lib/opencode.js";

export async function runOpen(repoRoot: string, planId: string): Promise<void> {
  const state = loadState(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    console.error("Make sure the plan has been dispatched at least once.");
    process.exit(1);
  }

  if (!ps.paused) {
    console.error(`Plan ${planId} is not paused.`);
    console.error(
      "Run 'swarm stop ${planId}' first to avoid automation collision."
    );
    process.exit(1);
  }

  if (!ps.session_id) {
    console.error(`No session ID for ${planId}`);
    process.exit(1);
  }

  console.log(`Opening TUI for ${planId}...`);
  console.log(`Session: ${ps.session_id}`);
  console.log(`Worktree: ${ps.worktree}`);

  await resumeSession(ps.worktree, ps.session_id);
}
