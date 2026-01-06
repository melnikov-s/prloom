import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";

/**
 * Adapter for Claude Code CLI
 * https://docs.anthropic.com/claude-code
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      // Read prompt from file to avoid command-line length limits
      const wrappedCmd = `claude -p "$(cat ${promptFile})" --dangerously-skip-permissions 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
          "bash",
          "-c",
          wrappedCmd,
        ],
        { reject: false }
      );

      // Wait for session to complete
      await waitForTmuxSession(tmux.sessionName);
      return readExecutionResult(tmux.sessionName);
    }

    // Direct execution (no tmux)
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
