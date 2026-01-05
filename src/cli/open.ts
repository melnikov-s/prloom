import { join } from "path";
import { loadState } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { parsePlan } from "../lib/plan.js";
import { getAdapter } from "../lib/adapters/index.js";

export async function runOpen(repoRoot: string, planId: string): Promise<void> {
  const state = loadState(repoRoot);
  const config = loadConfig(repoRoot);
  const ps = state.plans[planId];

  if (!ps) {
    console.error(`Plan not found in state: ${planId}`);
    console.error("Make sure the plan has been dispatched at least once.");
    process.exit(1);
  }

  if (!ps.paused) {
    console.error(`Plan ${planId} is not paused.`);
    console.error(
      "Run 'prloom stop ${planId}' first to avoid automation collision."
    );
    process.exit(1);
  }

  // Get the plan's agent from frontmatter or use config default
  const planPath = join(ps.worktree, ps.planRelpath);
  const plan = parsePlan(planPath);
  const agentName = plan.frontmatter.agent ?? config.agents.default;
  const adapter = getAdapter(agentName);

  console.log(`Opening TUI for ${planId}...`);
  console.log(`Agent: ${agentName}`);
  console.log(`Worktree: ${ps.worktree}`);

  // Start fresh interactive session (sessions are ephemeral per-TODO)
  await adapter.interactive({ cwd: ps.worktree });
}
