/**
 * Hook Runner
 *
 * Executes hooks at lifecycle points and builds HookContext.
 * See RFC: docs/rfc-lifecycle-hooks.md
 */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Action } from "../bus/types.js";
import { appendAction, initBusDir } from "../bus/manager.js";
import type { HookPoint, Hook, HookContext, HookRegistry } from "./types.js";
import { loadConfig, getAgentConfig, type Config } from "../config.js";
import { getAdapter } from "../adapters/index.js";
import { waitForExitCodeFile, hasTmux } from "../adapters/tmux.js";
import { waitForProcess } from "../adapters/process.js";

// =============================================================================
// Plan Format Documentation (for runAgent context injection)
// =============================================================================

const PLAN_FORMAT_DOCS = `## Plan Format

A prloom plan is a markdown file with the following structure:

### Sections
- **Title (h1)**: Short PR title (e.g., "# Fix PDF viewer pagination")
- **Objective (h2)**: What will be built (1-2 sentences)
- **Context (h2)**: Files to modify, constraints, notes for the Worker
- **TODOs (h2)**: Checklist of tasks, each becomes one commit

### TODO Syntax
- \`- [ ] Task description\` — Unchecked task
- \`- [x] Task description\` — Completed task
- \`- [!] Task description\` — Blocked task (stops execution)

### Rules
1. Each TODO should be ONE atomic commit
2. TODOs are executed in order, top to bottom
3. Only mark a TODO complete when the work is done
4. Use [!] to block if human intervention is needed
`;

// =============================================================================
// Hook Execution
// =============================================================================

/**
 * Run all hooks for a given hook point in sequence.
 * Each hook receives the plan from the previous hook.
 *
 * @param hookPoint - The hook point to run
 * @param plan - The current plan content
 * @param ctx - Hook context
 * @param registry - Registry of loaded hooks
 * @returns The final plan content after all hooks have run
 * @throws If any hook throws an error (abort behavior per RFC)
 */
export async function runHooks(
  hookPoint: HookPoint,
  plan: string,
  ctx: HookContext,
  registry: HookRegistry
): Promise<string> {
  const hooks = registry[hookPoint];

  // No hooks for this point
  if (!hooks || hooks.length === 0) {
    return plan;
  }

  // Run hooks in sequence, passing plan through
  let currentPlan = plan;
  for (const hook of hooks) {
    currentPlan = await hook(currentPlan, ctx);
  }

  return currentPlan;
}

// =============================================================================
// Context Builder
// =============================================================================

export interface BuildHookContextOptions {
  repoRoot: string;
  worktree: string;
  planId: string;
  hookPoint: HookPoint;
  changeRequestRef?: string;
  todoCompleted?: string;
  /** Optional config - will be loaded from repoRoot if not provided */
  config?: Config;
  /** Current plan content - required for runAgent to work */
  currentPlan?: string;
}

/**
 * Build a HookContext for hook execution.
 * Provides runAgent and emitAction utilities.
 */
export function buildHookContext(opts: BuildHookContextOptions): HookContext {
  const {
    repoRoot,
    worktree,
    planId,
    hookPoint,
    changeRequestRef,
    todoCompleted,
  } = opts;

  // Load config for agent resolution
  const config = opts.config ?? loadConfig(repoRoot);

  // Track the current plan content for runAgent
  let currentPlanContent = opts.currentPlan ?? "";

  return {
    repoRoot,
    worktree,
    planId,
    hookPoint,
    changeRequestRef,
    todoCompleted,

    /**
     * Run agent with automatic plan context injection.
     * Uses prloom's configured adapter and injects plan format docs.
     */
    runAgent: async (
      prompt: string,
      options?: { files?: string[] }
    ): Promise<string> => {
      // Build the system prompt with plan context injection
      const systemPrompt = `You are modifying a prloom plan. ${PLAN_FORMAT_DOCS}

You will receive the current plan. Apply the user's instructions and return the complete updated plan.
Your response should be ONLY the updated plan content, nothing else.`;

      // Build file contents context if files are provided
      let filesContext = "";
      if (options?.files && options.files.length > 0) {
        filesContext = "\n\n### Relevant Files\n";
        for (const filePath of options.files) {
          if (existsSync(filePath)) {
            const content = readFileSync(filePath, "utf-8");
            filesContext += `\n#### File: ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`;
          } else {
            filesContext += `\n#### File: ${filePath}\n(File not found)\n`;
          }
        }
      }

      // Build the user prompt with current plan and instructions
      const userPrompt = `Current plan:
${currentPlanContent}
${filesContext}
Instructions: ${prompt}`;

      // Get the worker agent configuration (hooks use worker agent by default)
      const agentConfig = getAgentConfig(config, "worker");
      const adapter = getAdapter(agentConfig.agent);

      // Create a temporary file for the agent to write its response
      const tmpDir = join(tmpdir(), `prloom-hook-${planId}`);
      mkdirSync(tmpDir, { recursive: true });
      const resultPath = join(tmpDir, "agent-result.md");

      // Build the full prompt that instructs the agent to write to the result file
      const fullPrompt = `${systemPrompt}

${userPrompt}

IMPORTANT: Write the complete updated plan to: ${resultPath}
Do NOT include any other text or explanation, just the plan content.`;

      // Execute the agent
      const useTmux = await hasTmux();
      const tmuxConfig = useTmux
        ? { sessionName: `prloom-hook-${planId}-${Date.now()}` }
        : undefined;

      const execResult = await adapter.execute({
        cwd: worktree,
        prompt: fullPrompt,
        tmux: tmuxConfig,
        model: agentConfig.model,
      });

      // Wait for completion
      if (execResult.tmuxSession) {
        const waitResult = await waitForExitCodeFile(execResult.tmuxSession);
        if (waitResult.timedOut || (waitResult.sessionDied && !waitResult.found)) {
          throw new Error(`Hook agent session failed: ${waitResult.timedOut ? 'timeout' : 'session died without exit code'}`);
        }
      } else if (execResult.pid) {
        await waitForProcess(execResult.pid);
      }

      // Read the result
      if (existsSync(resultPath)) {
        const result = readFileSync(resultPath, "utf-8");
        // Update the tracked plan content for subsequent runAgent calls
        currentPlanContent = result;
        return result;
      }

      throw new Error(`runAgent did not produce result file: ${resultPath}`);
    },

    /**
     * Emit action to the File Bus for bridge delivery.
     */
    emitAction: (action: Action): void => {
      // Ensure bus directory exists
      initBusDir(worktree);

      // Append action to the outbox
      appendAction(worktree, action);
    },
  };
}
