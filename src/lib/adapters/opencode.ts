import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    if (tmux) {
      const { logFile, exitCodeFile } = prepareLogFiles(cwd);

      // Wrap command to capture output and exit code
      const wrappedCmd = `opencode run ${JSON.stringify(
        prompt
      )} 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
    const result = await execa("opencode", ["run", prompt], {
      cwd,
      timeout: 0,
      reject: false,
    });
    return { exitCode: result.exitCode ?? 0 };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? ["--prompt", prompt] : [];
    await execa("opencode", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
