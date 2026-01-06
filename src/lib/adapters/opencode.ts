import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  waitForTmuxSession,
  prepareLogFiles,
  readExecutionResult,
} from "./tmux.js";
import { existsSync } from "fs";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      // Verify prompt file was written
      if (!existsSync(promptFile)) {
        console.error(`   ❌ Failed to write prompt file: ${promptFile}`);
        return { exitCode: 1 };
      }
      console.log(`   📝 Prompt file: ${promptFile}`);

      // Use a script that reads from the file safely
      const wrappedCmd = `opencode run "$(cat '${promptFile}')" 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;

      // Spawn in detached tmux session
      const tmuxResult = await execa(
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

      if (tmuxResult.exitCode !== 0) {
        console.error(`   ❌ tmux failed to start: ${tmuxResult.stderr}`);
        return { exitCode: tmuxResult.exitCode ?? 1 };
      }

      // Wait for session to complete
      await waitForTmuxSession(tmux.sessionName);
      return readExecutionResult(tmux.sessionName);
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
