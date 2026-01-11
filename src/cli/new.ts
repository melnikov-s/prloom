import { existsSync, writeFileSync, readFileSync } from "fs";
import { loadConfig, getAgentConfig, getPresetNames, resolveConfig } from "../lib/config.js";
import { getAdapter, type AgentName } from "../lib/adapters/index.js";
import { nanoid } from "nanoid";
import { generatePlanSkeleton } from "../lib/plan.js";
import { renderDesignerNewPrompt } from "../lib/template.js";
import {
  ensureInboxDir,
  getInboxPath,
  setPlanStatus,
  loadState,
  saveState,
} from "../lib/state.js";
import { getCurrentBranch, ensureRemoteBranchExists } from "../lib/git.js";
import { confirm, promptText } from "./prompt.js";
import { loadPlugins, runHooks, buildHookContext } from "../lib/hooks/index.js";

interface RunNewOptions {
  promptBranch?: (message: string) => Promise<string>;
}

export async function runNew(
  repoRoot: string,
  planId?: string,
  agentOverride?: string,
  noDesigner?: boolean,
  model?: string,
  branchPreference?: string,
  presetOverride?: string,
  options: RunNewOptions = {}
): Promise<void> {
  const config = loadConfig(repoRoot);

  // Ensure inbox directory exists
  ensureInboxDir(repoRoot);

  // Resolve preset: CLI flag > interactive selection > "default" if exists > none
  let selectedPreset: string | undefined = presetOverride;

  if (!selectedPreset) {
    const availablePresets = getPresetNames(config);

    if (availablePresets.length > 0) {
      // Show interactive preset picker
      const { selectPreset } = await import("../ui/PresetPicker.js");
      selectedPreset = await selectPreset(availablePresets);

      if (selectedPreset === undefined) {
        console.log("Plan creation cancelled.");
        process.exit(0);
      }
    }
  }

  // Resolve designer agent: CLI flag > config.designer > config.default
  const designerConfig = getAgentConfig(config, "designer");
  const designerAgent = (agentOverride as AgentName) ?? designerConfig.agent;

  // Resolve worker agent: CLI flag > config.default
  const workerConfig = getAgentConfig(config, "worker");
  const workerAgent = (agentOverride as AgentName) ?? workerConfig.agent;

  // Determine base branch for this plan (current branch)
  const baseBranch = await getCurrentBranch(repoRoot);
  if (!baseBranch) {
    console.error("Cannot create plan on detached HEAD.");
    console.error("Check out a branch and rerun `prloom new`. ");
    process.exit(1);
  }

  try {
    await ensureRemoteBranchExists(repoRoot, baseBranch);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }

  const promptBranch =
    options.promptBranch ??
    ((message: string) =>
      promptText(message, {
        required: true,
        requiredMessage: "Branch name is required.",
      }));

  let resolvedBranchPreference =
    typeof branchPreference === "string" ? branchPreference.trim() : undefined;

  if (!resolvedBranchPreference) {
    const enteredBranch = await promptBranch("Branch name");
    resolvedBranchPreference = enteredBranch.trim();
  }

  // Generate plan ID if not provided
  const id = planId ?? nanoid(5);
  const planPath = getInboxPath(repoRoot, id);

  // Check if plan already exists in inbox
  if (existsSync(planPath)) {
    console.error(`Plan already exists in inbox: ${planPath}`);
    console.error("Use 'prloom edit' to modify existing plans.");
    process.exit(1);
  }

  // Create plan skeleton (pure markdown, no frontmatter)
  const skeleton = generatePlanSkeleton();
  writeFileSync(planPath, skeleton);

  // Save plan metadata in state.json
  const state = loadState(repoRoot);
  state.plans[id] = {
    status: "draft",
    baseBranch,
    branch: resolvedBranchPreference,
    preset: selectedPreset,
  };
  saveState(repoRoot, state);

  console.log(`Created plan in inbox: ${planPath}`);
  console.log(`Base branch: ${baseBranch}`);
  if (resolvedBranchPreference) {
    console.log(`Branch preference: ${resolvedBranchPreference}`);
  }
  if (selectedPreset) {
    console.log(`Preset: ${selectedPreset}`);
  }
  console.log(`Worker agent: ${workerAgent}`);

  // Skip designer session if --no-designer flag is used
  if (noDesigner) {
    console.log("");
    console.log("Plan skeleton created (status: draft).");
    console.log("Use 'prloom edit' to design, then queue for dispatch.");
    return;
  }

  const adapter = getAdapter(designerAgent);
  console.log(`Designer agent: ${designerAgent}`);
  console.log("");
  console.log("Starting Designer session to fill in the plan...");

  const prompt = renderDesignerNewPrompt(
    repoRoot,
    planPath,
    baseBranch,
    workerAgent
  );
  await adapter.interactive({
    cwd: repoRoot,
    prompt,
    model: model ?? designerConfig.model,
  });

  console.log("");
  console.log("Designer session ended.");

  // Run afterDesign hooks
  // Use resolved config with preset so plugin overrides take effect
  const resolvedConfig = resolveConfig(config, selectedPreset);
  const hookRegistry = await loadPlugins(resolvedConfig, repoRoot);
  if (hookRegistry.afterDesign && hookRegistry.afterDesign.length > 0) {
    console.log("Running afterDesign hooks...");
    try {
      const planContent = readFileSync(planPath, "utf-8");
      const ctx = buildHookContext({
        repoRoot,
        worktree: repoRoot, // For inbox plans, worktree is the repo root
        planId: id,
        hookPoint: "afterDesign",
        currentPlan: planContent,
        config: resolvedConfig,
      });
      const updatedPlan = await runHooks("afterDesign", planContent, ctx, hookRegistry);
      if (updatedPlan !== planContent) {
        writeFileSync(planPath, updatedPlan);
        console.log("Plan modified by afterDesign hooks.");
      }
    } catch (error) {
      console.error(`afterDesign hook error: ${error}`);
      console.log("Plan left as draft due to hook error.");
      return;
    }
  }

  // Prompt to queue the plan
  const shouldQueue = await confirm("Queue this plan for the dispatcher?");
  if (shouldQueue) {
    setPlanStatus(repoRoot, id, "queued");
    console.log("Plan queued. Run 'prloom start' to dispatch.");
  } else {
    console.log("Plan left as draft. Use 'prloom edit' to continue later.");
  }
}
