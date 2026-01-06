import type { AgentAdapter, ExecutionResult } from "./types.js";

/**
 * Manual adapter for IDE-driven workflows (Cursor, Anti-Gravity).
 *
 * The dispatcher should skip automated execution for manual plans.
 * These methods exist for safety/completeness only.
 */
export const manualAdapter: AgentAdapter = {
  name: "manual",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    console.log(
      "⚠️  Manual agent: execute() called but should be skipped by dispatcher."
    );
    console.log("   This plan is intended for IDE-driven execution.");
    return { exitCode: 0 };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    console.log("ℹ️  Manual agent mode: No interactive session to launch.");
    console.log("   Use your IDE (Cursor, Anti-Gravity) to work on this plan.");
  },
};
