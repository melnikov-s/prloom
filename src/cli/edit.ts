import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { loadConfig } from "../lib/config.js";
import { getAdapter, type AgentName } from "../lib/adapters/index.js";
import { renderDesignerEditPrompt } from "../lib/template.js";
import { listInboxPlanIds, loadState, getInboxPath } from "../lib/state.js";
import { parsePlan, setStatus } from "../lib/plan.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";
import { confirm } from "./prompt.js";

export async function runEdit(
  repoRoot: string,
  planIdInput?: string,
  agentOverride?: string,
  noDesigner?: boolean
): Promise<void> {
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    // Collect options from inbox and state
    const inboxIds = listInboxPlanIds(repoRoot);
    const state = loadState(repoRoot);

    const inboxOptions = inboxIds.map((id) => {
      const path = getInboxPath(repoRoot, id);
      const plan = parsePlan(path);
      return {
        id,
        label: id,
        metadata: `inbox [${plan.frontmatter.status ?? "draft"}]`,
        color: plan.frontmatter.status === "draft" ? "yellow" : "gray",
      };
    });

    const activeOptions = Object.entries(state.plans).map(([id, ps]) => ({
      id,
      label: id,
      metadata: `active [${ps.status ?? "unknown"}]`,
      color: ps.status === "blocked" ? "red" : "green",
    }));

    const options = [...inboxOptions, ...activeOptions];

    if (options.length === 0) {
      console.log("No plans found to edit.");
      return;
    }

    planId = await promptSelection("Select a plan to edit:", options);
  }

  const config = loadConfig(repoRoot);
  const state = loadState(repoRoot);

  // Check inbox first
  const inboxPath = getInboxPath(repoRoot, planId);
  let planPath: string;
  let cwd: string;
  let isInbox = false;

  if (existsSync(inboxPath)) {
    planPath = inboxPath;
    cwd = repoRoot;
    isInbox = true;
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

  const prompt = renderDesignerEditPrompt(cwd, planPath, existingPlan);
  await adapter.interactive({ cwd, prompt });

  console.log("");
  console.log("Designer session ended.");

  // For inbox plans: check if still draft and prompt to queue
  if (isInbox) {
    const plan = parsePlan(planPath);
    if (plan.frontmatter.status === "draft") {
      const shouldQueue = await confirm("Queue this plan for the dispatcher?");
      if (shouldQueue) {
        setStatus(planPath, "queued");
        console.log("Plan queued. Run 'prloom start' to dispatch.");
      } else {
        console.log("Plan left as draft.");
      }
    }
  }
}
