import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  prepareLogFiles,
  executeInTmux,
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

      return executeInTmux(tmux.sessionName, wrappedCmd, cwd);
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
