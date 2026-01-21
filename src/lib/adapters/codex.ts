import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { prepareLogFiles, executeInTmux } from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";
import { buildInitialArgs, buildResumeArgs } from "./session.js";

/**
 * Adapter for OpenAI Codex CLI
 * https://github.com/openai/codex
 *
 * Session resume support:
 * - Initial: codex exec <prompt> --json --full-auto [-m <model>]
 * - Resume:  codex exec resume <thread_id> <prompt> --json --full-auto [-m]
 * - Extract: JSON event {"type":"thread.started","thread_id":"..."}
 */
export const codexAdapter: AgentAdapter = {
  name: "codex",

  async execute({
    cwd,
    prompt,
    tmux,
    model,
    sessionId,
    purpose,
  }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `codex-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt,
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    // Build args using session helpers
    const promptArg = `"$(cat '${promptFile}')"`;
    const args = sessionId
      ? buildResumeArgs("codex", sessionId, promptArg, model)
      : buildInitialArgs("codex", promptArg, model);

    if (tmux) {
      const cmdLine = `cd ${cwd} && codex ${args.join(" ")} 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      const result = await executeInTmux(tmux.sessionName, cmdLine, cwd);
      return { ...result, logFile, sessionId };
    }

    // Non-tmux: spawn detached
    const pid = spawnDetached(
      "bash",
      ["-c", `codex ${args.join(" ")} 2>&1 | tee "${logFile}"`],
      { cwd, logFile },
    );

    return { pid, logFile, sessionId };
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
