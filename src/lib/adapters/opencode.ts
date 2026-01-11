import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  prepareLogFiles,
  hasSession,
  sendKeys,
} from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({ cwd, prompt, tmux, model }): Promise<ExecutionResult> {
    // Use session name for log paths - fall back to timestamp-based name if not provided
    const sessionName = tmux?.sessionName ?? `opencode-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    const modelArg = model ? `--model '${model}'` : "";

    if (tmux) {
      const wrappedCmd = `cd ${cwd} && opencode run ${modelArg} "$(cat '${promptFile}')" 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;

      // Check if session already exists
      const sessionExists = await hasSession(tmux.sessionName);

      if (sessionExists) {
        // Send command to existing session
        const sent = await sendKeys(tmux.sessionName, wrappedCmd);
        if (!sent) {
          return { exitCode: 1 };
        }
      } else {
        // Create new session
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
      }

      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux - logs still go to the same location
    const pid = spawnDetached(
      "bash",
      ["-c", `opencode run ${modelArg} "$(cat '${promptFile}')"`],
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
};
