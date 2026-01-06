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
        console.error(`   ❌ tmux failed to start: ${tmuxResult.stderr}`);
        return { exitCode: tmuxResult.exitCode ?? 1 };
      }

      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux
    const { promptFile } = prepareLogFiles(`opencode-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      ["-c", `opencode run "$(cat '${promptFile}')"`],
      { cwd }
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
