import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { loadConfig } from "../lib/config.js";
import { getAdapter, type AgentName } from "../lib/adapters/index.js";
import { renderDesignerPrompt } from "../lib/template.js";
import { loadState, getInboxPath } from "../lib/state.js";

export async function runEdit(
  repoRoot: string,
  planId: string,
  agentOverride?: string,
  noDesigner?: boolean
): Promise<void> {
  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  // Check inbox first
  const inboxPath = getInboxPath(repoRoot, planId);
  let planPath: string;
  let cwd: string;

  if (existsSync(inboxPath)) {
    planPath = inboxPath;
    cwd = repoRoot;
    console.log(`Editing inbox plan: ${planId}`);
  } else {
    // Check if ingested (in state)
    const ps = state.plans[planId];
    if (ps) {
      planPath = join(ps.worktree, ps.planRelpath);
      cwd = ps.worktree;
      console.log(`Editing ingested plan in worktree: ${planId}`);
    } else {
      console.error(`Plan not found: ${planId}`);
      console.error("Check inbox or active plans with 'prloom status'.");
      process.exit(1);
    }
  }

  if (!existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
  }

  console.log(`Plan path: ${planPath}`);

  // Skip designer session if --no-designer flag is used
  if (noDesigner) {
    console.log("");
    console.log("Edit the plan manually or use your IDE.");
    return;
  }

  const existingPlan = readFileSync(planPath, "utf-8");

  // Resolve agent: CLI flag > config.designer > config.default
  const agentName =
    (agentOverride as AgentName) ??
    config.agents.designer ??
    config.agents.default;

  const adapter = getAdapter(agentName);

  console.log(`Agent: ${agentName}`);

  const prompt = renderDesignerPrompt(repoRoot, existingPlan);
  await adapter.interactive({ cwd, prompt });

  console.log("Designer session ended.");
}
