import { loadState } from "../lib/state.js";

export async function runLogs(repoRoot: string, planId: string): Promise<void> {
  const state = loadState(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    process.exit(1);
  }

  console.log(`Plan: ${planId}`);
  console.log(`Session ID: ${ps.session_id ?? "—"}`);
  console.log(`Worktree: ${ps.worktree || "—"}`);
  console.log(`Branch: ${ps.branch || "—"}`);
  console.log(`PR: ${ps.pr ?? "—"}`);
  console.log(`Paused: ${ps.paused}`);
  console.log(`Next TODO: ${ps.next_todo}`);
}
