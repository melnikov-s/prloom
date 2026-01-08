import { loadState } from "../lib/state.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";
import { loadConfig, getAgentConfig } from "../lib/config.js";

export async function runLogs(
  repoRoot: string,
  planIdInput?: string
): Promise<void> {
  const state = loadState(repoRoot);
  const config = loadConfig(repoRoot);
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    const options = Object.entries(state.plans).map(([id, ps]) => ({
      id,
      label: id,
      metadata: ps.blocked ? "blocked" : (ps.status ?? "unknown"),
      color: ps.blocked ? "red" : "green",
    }));

    if (options.length === 0) {
      console.log("No active plans found.");
      return;
    }

    planId = await promptSelection("Select a plan to show logs:", options);
  }

  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    process.exit(1);
  }

  console.log(`Plan: ${planId}`);
  console.log(`Status: ${ps.status}`);
  console.log(`Worktree: ${ps.worktree || "—"}`);
  console.log(`Branch: ${ps.branch || "—"}`);
  console.log(`PR: ${ps.pr ?? "—"}`);

  // Show resume info
  if (ps.tmuxSession) {
    console.log(`Tmux Session: ${ps.tmuxSession}`);
    console.log(`  Attach: tmux attach -t ${ps.tmuxSession}`);
  }
  if (ps.pid) {
    console.log(`Agent PID: ${ps.pid}`);
  }

  // Show resume command based on agent
  const agentName = ps.agent ?? getAgentConfig(config, "worker").agent;
  const resumeCommands: Record<string, string> = {
    codex: "codex --resume",
    opencode: "opencode --continue",
    claude: "claude --continue",
  };
  const resumeCmd = resumeCommands[agentName];
  if (resumeCmd && ps.worktree) {
    console.log(`\nTo resume manually:`);
    console.log(`  cd ${ps.worktree} && ${resumeCmd}`);
  }

  console.log(`\nLast Polled: ${ps.lastPolledAt ?? "—"}`);
  console.log(`Last Error: ${ps.lastError ?? "—"}`);
}
