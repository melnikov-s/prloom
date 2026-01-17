import { existsSync } from "fs";
import { execa } from "execa";
import type { AgentAdapter, ExecutionResult } from "./types.js";
import { spawnDetached } from "./process.js";
import { executeInTmux, prepareLogFiles } from "./tmux.js";

/**
 * Adapter for Amp CLI
 * https://ampcode.com/manual#cli
 */
export const ampAdapter: AgentAdapter = {
  name: "amp",

  async execute({ cwd, prompt, tmux }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `amp-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    if (tmux) {
      const wrappedCmd =
        `cd ${cwd} && amp --execute "$(cat '${promptFile}')" ` +
        `2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      return executeInTmux(tmux.sessionName, wrappedCmd, cwd);
    }

    const pid = spawnDetached(
      "bash",
      ["-c", `amp --execute "$(cat '${promptFile}')"`],
      { cwd, logFile }
    );

    return { pid };
  },

  async interactive({ cwd, prompt }): Promise<void> {
    const args: string[] = [];
    if (prompt) {
      args.push("--execute", prompt);
    }
    await execa("amp", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
