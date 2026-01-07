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
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    // Use session name for log paths - fall back to timestamp-based name if not provided
    const sessionName = tmux?.sessionName ?? `opencode-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    if (tmux) {
      const wrappedCmd = `opencode run "$(cat '${promptFile}')" 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;

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
        return { exitCode: tmuxResult.exitCode ?? 1 };
      }

      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux - logs still go to the same location
    const pid = spawnDetached(
      "bash",
      ["-c", `opencode run "$(cat '${promptFile}')"`],
      { cwd, logFile }
    );

    return { pid };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args = prompt ? ["--prompt", prompt] : [];
    if (model) args.push("--model", model);
    await execa("opencode", args, {
      cwd,
      stdio: "inherit",
    });
  },

  async resume({ cwd }): Promise<void> {
    await execa("opencode", ["--continue"], {
      cwd,
      stdio: "inherit",
    });
  },
};
