import { execa } from "execa";
import { loadState, saveState } from "../lib/state.js";
import { loadConfig, getAgentConfig } from "../lib/config.js";
import { getAdapter } from "../lib/adapters/index.js";
import { isProcessAlive, killProcess } from "../lib/adapters/process.js";
import { confirm } from "./prompt.js";

/**
 * Check if a tmux session is currently running.
 */
async function isTmuxSessionRunning(sessionName: string): Promise<boolean> {
  const { exitCode } = await execa("tmux", ["has-session", "-t", sessionName], {
    reject: false,
  });
  return exitCode === 0;
}

/**
 * Kill a tmux session.
 */
async function killTmuxSession(sessionName: string): Promise<void> {
  await execa("tmux", ["kill-session", "-t", sessionName], { reject: false });
}

import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";

export async function runOpen(
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
        metadata: ps.status ?? "unknown",
        color: ps.status === "blocked" ? "red" : "green",
      }))
      .filter((opt) => opt.metadata === "blocked");

    if (options.length === 0) {
      console.log("No blocked plans found to open.");
      return;
    }

    planId = await promptSelection("Select a blocked plan to open:", options);
  }

  const config = loadConfig(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    console.error("Make sure the plan has been dispatched at least once.");
    process.exit(1);
  }

  // Check if an agent is currently running for this plan
  const tmuxRunning =
    ps.tmuxSession && (await isTmuxSessionRunning(ps.tmuxSession));
  const pidRunning = ps.pid && isProcessAlive(ps.pid);

  if (tmuxRunning || pidRunning) {
    const sessionInfo = tmuxRunning
      ? `tmux session "${ps.tmuxSession}"`
      : `process ${ps.pid}`;
    console.log(`⚠️  Agent is currently running (${sessionInfo})`);

    const shouldKill = await confirm("Kill it and take over?");
    if (!shouldKill) {
      console.log("Cancelled.");
      if (tmuxRunning) {
        console.log("Use 'prloom watch' to observe the running session.");
      }
      return;
    }

    // Kill the running session
    if (tmuxRunning && ps.tmuxSession) {
      await killTmuxSession(ps.tmuxSession);
      ps.tmuxSession = undefined;
      console.log("Tmux session killed.");
    }
    if (pidRunning && ps.pid) {
      killProcess(ps.pid);
      ps.pid = undefined;
      console.log("Process killed.");
    }

    // Save state with cleared identifiers
    saveState(repoRoot, state);
  }

  // Get the plan's agent from state or use config default
  const workerConfig = getAgentConfig(config, "worker");
  const agentName = ps.agent ?? workerConfig.agent;
  const adapter = getAdapter(agentName);

  console.log(`Resuming session for ${planId}...`);
  console.log(`Agent: ${agentName}`);
  console.log(`Worktree: ${ps.worktree}`);

  // Resume the latest agent session in this worktree
  if (adapter.resume) {
    await adapter.resume({ cwd: ps.worktree });
  } else {
    await adapter.interactive({ cwd: ps.worktree });
  }
}
