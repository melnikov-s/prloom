import { execa } from "execa";
import type { AgentAdapter, ExecutionResult } from "./types.js";

/**
 * Adapter for Claude Code CLI
 * https://docs.anthropic.com/claude-code
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",

  async execute({ cwd, prompt }): Promise<ExecutionResult> {
    const result = await execa(
      "claude",
      ["-p", prompt, "--dangerously-skip-permissions"],
      {
        cwd,
        timeout: 0,
        reject: false,
      }
    );
    return { exitCode: result.exitCode ?? 0 };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    // Claude Code TUI doesn't accept initial prompt via CLI
    // User enters prompt after TUI launches
    await execa("claude", [], {
      cwd,
      stdio: "inherit",
    });
  },
};
