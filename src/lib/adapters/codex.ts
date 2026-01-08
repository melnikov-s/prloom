import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  prepareLogFiles,
  hasSession,
  sendKeys,
} from "./tmux.js";
import { spawnDetached } from "./process.js";

/**
 * Adapter for OpenAI Codex CLI
 * https://github.com/openai/codex
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",

  async execute({ cwd, prompt, tmux, model }): Promise<ExecutionResult> {
    const modelArg = model ? `-m '${model}'` : "";
    
    if (tmux) {
      const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
        tmux.sessionName,
        prompt
      );

      const wrappedCmd = `cd ${cwd} && codex exec "$(cat ${promptFile})" ${modelArg} --full-auto 2>&1 | tee ${logFile}; echo $? > ${exitCodeFile}`;

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
    const { promptFile } = prepareLogFiles(`codex-${Date.now()}`, prompt);
    const pid = spawnDetached(
      "bash",
      ["-c", `codex exec "$(cat '${promptFile}')" ${modelArg} --full-auto`],
      { cwd }
    );

    return { pid };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args = prompt ? [prompt] : [];
    if (model) args.push("-m", model);
    await execa("codex", args, {
      cwd,
      stdio: "inherit",
    });
  },

  async resume({ cwd }): Promise<void> {
    await execa("codex", ["resume", "--last"], {
      cwd,
      stdio: "inherit",
    });
  },
};
