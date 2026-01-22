import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { loadConfig, getAgentConfig, resolveConfig } from "../lib/config.js";
import { getAdapter, type AgentName } from "../lib/adapters/index.js";
import { renderDesignerEditPrompt } from "../lib/template.js";
import {
  listInboxPlanIds,
  loadState,
  getInboxPath,
  getPlanMeta,
  setPlanStatus,
} from "../lib/state.js";
import { parsePlan } from "../lib/plan.js";
import { resolvePlanId } from "../lib/resolver.js";
import { promptSelection } from "../ui/Selection.js";
import { confirm } from "./prompt.js";
import { loadPlugins, runHooks, buildHookContext } from "../lib/hooks/index.js";

export async function runEdit(
  repoRoot: string,
  planIdInput?: string,
  agentOverride?: string,
  noDesigner?: boolean,
): Promise<void> {
  let planId: string;

  if (planIdInput) {
    planId = await resolvePlanId(repoRoot, planIdInput);
  } else {
    // Collect options from state and disk
    const state = loadState(repoRoot);
    const diskIds = listInboxPlanIds(repoRoot);
    const allIds = Array.from(
      new Set([...Object.keys(state.plans), ...diskIds]),
    );

    const options = allIds.map((id) => {
      const ps = state.plans[id] ?? { status: "draft" as const };
      const isDraftOrQueued = ps.status === "draft" || ps.status === "queued";
      return {
        id,
        label: id,
        metadata: isDraftOrQueued
          ? `inbox [${ps.status}]`
          : `active [${ps.status}]`,
        color:
          ps.status === "draft"
            ? "yellow"
            : ps.status === "paused"
            ? "blue"
            : ps.blocked
            ? "red"
            : "green",
      };
    });

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
    if (ps && ps.worktree && ps.planRelpath) {
      planPath = join(ps.worktree, ps.planRelpath);
      cwd = ps.worktree;
      console.log(`Editing ingested plan in worktree: ${planId}`);
    } else {
      console.error(`Plan not found: ${planId}`);
      console.error("Check inbox or active plans with 'prloom status'. ");
      if (ps && !ps.worktree) {
        console.error(
          "Note: This plan is in state but not yet activated (no worktree).",
        );
      }
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

  // Resolve agent: CLI flag > config default
  const designerConfig = getAgentConfig(
    config,
    "designer",
    agentOverride as AgentName,
  );
  const adapter = getAdapter(designerConfig.agent);

  console.log(`Agent: ${designerConfig.agent}`);

  const prompt = renderDesignerEditPrompt(cwd, planPath, existingPlan);
  await adapter.interactive({ cwd, prompt, model: designerConfig.model });

  console.log("");
  console.log("Designer session ended.");

  // Run afterDesign hooks
  // Use resolved config with preset (from state) so plugin overrides take effect
  const planMeta = state.plans[planId];
  const resolvedConfig = resolveConfig(config, planMeta?.preset);
  const hookRegistry = await loadPlugins(resolvedConfig, repoRoot);
  if (hookRegistry.afterDesign && hookRegistry.afterDesign.length > 0) {
    console.log("Running afterDesign hooks...");
    try {
      const planContent = readFileSync(planPath, "utf-8");
      const ctx = buildHookContext({
        repoRoot,
        worktree: cwd,
        planId,
        hookPoint: "afterDesign",
        currentPlan: planContent,
        config: resolvedConfig,
      });
      const updatedPlan = await runHooks(
        "afterDesign",
        planContent,
        ctx,
        hookRegistry,
      );
      if (updatedPlan !== planContent) {
        writeFileSync(planPath, updatedPlan);
        console.log("Plan modified by afterDesign hooks.");
      }
    } catch (error) {
      console.error(`afterDesign hook error: ${error}`);
      console.log("Plan left unchanged due to hook error.");
      return; // Issue #3 fix: Abort on hook error for consistency with new.ts
    }
  }

  // For inbox plans: check if still draft and prompt to queue
  if (isInbox) {
    const ps = getPlanMeta(repoRoot, planId);
    if (ps.status === "draft") {
      const shouldQueue = await confirm("Queue this plan for the dispatcher?");
      if (shouldQueue) {
        setPlanStatus(repoRoot, planId, "queued");
        console.log("Plan queued. Run 'prloom' to dispatch.");
      } else {
        console.log("Plan left as draft.");
      }
    }
  }
}
