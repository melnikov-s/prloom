import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";

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

      const wrappedCmd = `claude -p "$(cat ${promptFile})" --dangerously-skip-permissions 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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

      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux
    const { promptFile } = prepareLogFiles(`claude-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      [
        "-c",
        `claude -p "$(cat '${promptFile}')" --dangerously-skip-permissions`,
      ],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    await execa("claude", [], {
      cwd,
      stdio: "inherit",
    });
  },

  async resume({ cwd }): Promise<void> {
    await execa("claude", ["--continue"], {
      cwd,
      stdio: "inherit",
    });
  },
};
