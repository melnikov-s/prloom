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
 * Adapter for Gemini CLI
 * https://github.com/google-gemini/gemini-cli
 */
export const geminiAdapter: AgentAdapter = {
  name: "gemini",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      if (!existsSync(promptFile)) {
        console.error(`   ❌ Failed to write prompt file: ${promptFile}`);
        return { exitCode: 1 };
      }
      console.log(`   📝 Prompt file: ${promptFile}`);

      const wrappedCmd = `gemini --yolo "$(cat '${promptFile}')" 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;

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

      // Return immediately with tmux session info (async)
      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux - spawn detached process
    const { promptFile } = prepareLogFiles(`gemini-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      ["-c", `gemini --yolo "$(cat '${promptFile}')"`],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args = prompt ? ["-i", prompt] : [];
    await execa("gemini", args, {
      cwd,
      stdio: "inherit",
    });
  },

  async resume({ cwd }): Promise<void> {
    await execa("gemini", ["--resume", "latest"], {
      cwd,
      stdio: "inherit",
    });
  },
};
