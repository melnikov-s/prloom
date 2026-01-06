import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";

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

      // Read prompt from file to avoid command-line length limits
      const wrappedCmd = `codex exec "$(cat ${promptFile})" --full-auto 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
    const result = await execa("codex", ["exec", prompt, "--full-auto"], {
      cwd,
      timeout: 0,
      reject: false,
    });
    return { exitCode: result.exitCode ?? 0 };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? [prompt] : [];
    await execa("codex", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
