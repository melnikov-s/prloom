import { join } from "path";
import { existsSync, writeFileSync } from "fs";
import { loadConfig } from "../lib/config.js";
import { getAdapter, type AgentName } from "../lib/adapters/index.js";
import { generatePlanSkeleton } from "../lib/plan.js";
import { renderDesignerPrompt } from "../lib/template.js";
import { ensureInboxDir, getInboxPath } from "../lib/state.js";
import { getCurrentBranch, ensureRemoteBranchExists } from "../lib/git.js";

export async function runNew(
  repoRoot: string,
  planId?: string,
  agentOverride?: string,
  noDesigner?: boolean
): Promise<void> {
  const config = loadConfig(repoRoot);

  // Ensure inbox directory exists
  ensureInboxDir(repoRoot);

  // Resolve designer agent: CLI flag > config.designer > config.default
  const designerAgent =
    (agentOverride as AgentName) ??
    config.agents.designer ??
    config.agents.default;

  // Resolve worker agent: CLI flag > config.default
  const workerAgent = (agentOverride as AgentName) ?? config.agents.default;

  // Determine base branch for this plan (current branch)
  const baseBranch = await getCurrentBranch(repoRoot);
  if (!baseBranch) {
    console.error("Cannot create plan on detached HEAD.");
    console.error("Check out a branch and rerun `swarm new`. ");
    process.exit(1);
  }

  try {
    await ensureRemoteBranchExists(repoRoot, baseBranch);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }

  // Generate plan ID if not provided
  const id = planId ?? `plan-${Date.now()}`;
  const planPath = getInboxPath(repoRoot, id);

  // Check if plan already exists in inbox
  if (existsSync(planPath)) {
    console.error(`Plan already exists in inbox: ${planPath}`);
    console.error("Use 'swarm edit' to modify existing plans.");
    process.exit(1);
  }

  // Create plan skeleton with deterministic frontmatter
  const skeleton = generatePlanSkeleton(id, workerAgent, baseBranch);
  writeFileSync(planPath, skeleton);

  console.log(`Created plan in inbox: ${planPath}`);
  console.log(`Base branch: ${baseBranch}`);
  console.log(`Worker agent: ${workerAgent}`);

  // Skip designer session if --no-designer flag is used
  if (noDesigner) {
    console.log("");
    console.log("Plan skeleton created. Edit manually or use your IDE.");
    console.log("Run 'swarm start' to dispatch when ready.");
    return;
  }

  const adapter = getAdapter(designerAgent);
  console.log(`Designer agent: ${designerAgent}`);
  console.log("");
  console.log("Starting Designer session to fill in the plan...");

  const prompt = renderDesignerPrompt(repoRoot, skeleton);
  await adapter.interactive({ cwd: repoRoot, prompt });

  console.log("Designer session ended.");
  console.log("Plan is now in inbox. Run 'swarm start' to dispatch.");
}
