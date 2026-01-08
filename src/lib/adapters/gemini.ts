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
 * Adapter for Gemini CLI
 * https://github.com/google-gemini/gemini-cli
 */
export const geminiAdapter: AgentAdapter = {
  name: "gemini",

  async execute({ cwd, prompt, tmux, model }): Promise<ExecutionResult> {
    const modelArg = model ? `--model '${model}'` : "";
    
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      if (!existsSync(promptFile)) {
        return { exitCode: 1 };
      }

      const wrappedCmd = `cd ${cwd} && gemini ${modelArg} --yolo "$(cat '${promptFile}')" 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;

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

      // Return immediately with tmux session info (async)
      return { tmuxSession: tmux.sessionName };
    }

    // Async execution without tmux - spawn detached process
    const { promptFile } = prepareLogFiles(`gemini-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      ["-c", `gemini ${modelArg} --yolo "$(cat '${promptFile}')"`],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args: string[] = [];
    if (model) args.push("--model", model);
    if (prompt) args.push("-i", prompt);
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
