import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  prepareLogFiles,
  executeInTmux,
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

      return executeInTmux(tmux.sessionName, wrappedCmd, cwd);
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
};
