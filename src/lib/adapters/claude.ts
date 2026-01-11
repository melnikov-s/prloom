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
 * Adapter for Claude Code CLI
 * https://docs.anthropic.com/claude-code
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",

  async execute({ cwd, prompt, tmux, model }): Promise<ExecutionResult> {
    const modelArg = model ? `--model '${model}'` : "";
    
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      const wrappedCmd = `cd ${cwd} && claude -p "$(cat ${promptFile})" ${modelArg} --dangerously-skip-permissions 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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

    // Async execution without tmux
    const { promptFile } = prepareLogFiles(`claude-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      [
        "-c",
        `claude -p "$(cat '${promptFile}')" ${modelArg} --dangerously-skip-permissions`,
      ],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args: string[] = [];
    if (prompt) args.push("-p", prompt);
    if (model) args.push("--model", model);
    await execa("claude", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
