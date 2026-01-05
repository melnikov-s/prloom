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
      const { logFile, exitCodeFile } = prepareLogFiles(cwd);

      // Wrap command to capture output and exit code
      const wrappedCmd = `claude -p ${JSON.stringify(
        prompt
      )} --dangerously-skip-permissions 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
      return readExecutionResult(cwd);
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
