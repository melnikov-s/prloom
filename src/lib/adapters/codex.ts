import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";
import { spawnDetached } from "./process.js";

/**
 * Adapter for OpenAI Codex CLI
 * https://github.com/openai/codex
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      const wrappedCmd = `codex exec "$(cat ${promptFile})" --full-auto 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
    const { promptFile } = prepareLogFiles(`codex-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      ["-c", `codex exec "$(cat '${promptFile}')" --full-auto`],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? [prompt] : [];
    await execa("codex", args, {
      cwd,
      stdio: "inherit",
    });
  },

  async resume({ cwd }): Promise<void> {
    await execa("codex", ["resume", "--last"], {
      cwd,
      stdio: "inherit",
    });
  },
};
