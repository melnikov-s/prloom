import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { waitForTmuxSession } from "./tmux.js";

/**
 * Adapter for Claude Code CLI
 * https://docs.anthropic.com/claude-code
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    const args = ["-p", prompt, "--dangerously-skip-permissions"];

    if (tmux) {
      // Spawn in detached tmux session
      await execa(
        "tmux",
        [
          "new-session",
          "-d",
          "-s",
          tmux.sessionName,
          "-c",
          cwd,
          "claude",
          ...args,
        ],
        { reject: false }
      );
      // Wait for session to complete
      await waitForTmuxSession(tmux.sessionName);
      return { exitCode: 0 };
    }

    // Direct execution (no tmux)
    const result = await execa("claude", args, {
      cwd,
      timeout: 0,
      reject: false,
    });
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
