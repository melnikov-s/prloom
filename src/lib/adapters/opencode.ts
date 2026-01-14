import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import {
  prepareLogFiles,
  executeInTmux,
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
      return executeInTmux(tmux.sessionName, wrappedCmd, cwd);
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
    
    // Debug: print the command being run
    console.log(`\n[DEBUG] Running: opencode ${args.map(a => a.length > 100 ? `"${a.slice(0, 100)}..."` : `"${a}"`).join(" ")}`);
    console.log(`[DEBUG] cwd: ${cwd}`);
    console.log(`[DEBUG] prompt length: ${prompt?.length ?? 0} chars\n`);
    
    await execa("opencode", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
