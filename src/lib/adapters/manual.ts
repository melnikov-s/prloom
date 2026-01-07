import type { AgentAdapter, ExecutionResult } from "./types.js";

/**
 * Manual adapter for IDE-driven workflows (Cursor, Anti-Gravity).
 *
 * The dispatcher should skip automated execution for manual plans.
 * These methods exist for safety/completeness only.
 */
export const manualAdapter: AgentAdapter = {
  name: "manual",

  async execute({ cwd, prompt, tmux, model }): Promise<ExecutionResult> {
    return { exitCode: 0 };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    // No-op
  },
};
