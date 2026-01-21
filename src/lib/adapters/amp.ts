import { existsSync } from "fs";
import { execa } from "execa";
import type { AgentAdapter, ExecutionResult } from "./types.js";
import { spawnDetached } from "./process.js";
import { executeInTmux, prepareLogFiles } from "./tmux.js";
import {
  buildInitialArgs,
  buildResumeArgs,
  generateSessionId,
} from "./session.js";

/**
 * Adapter for Amp CLI
 * https://ampcode.com/manual#cli
 *
 * Session resume support:
 * - Initial: amp --execute <prompt> --stream-json [--model]
 * - Resume:  amp threads continue --execute <prompt> --stream-json
 * - Extract: JSON field session_id, or use generated fallback
 */
export const ampAdapter: AgentAdapter = {
  name: "amp",

  async execute({
    cwd,
    prompt,
    tmux,
    model,
    sessionId,
    purpose,
  }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `amp-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt,
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    // For amp, generate a fallback session ID if not resuming (used if output doesn't contain one)
    const generatedId = sessionId ? undefined : generateSessionId();

    // Build args using session helpers
    const promptArg = `"$(cat '${promptFile}')"`;
    const args = sessionId
      ? buildResumeArgs("amp", sessionId, promptArg, model)
      : buildInitialArgs("amp", promptArg, model);

    if (tmux) {
      const cmdLine = `cd ${cwd} && amp ${args.join(" ")} 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      const result = await executeInTmux(tmux.sessionName, cmdLine, cwd);

      // Return generated session ID as fallback
      return {
        ...result,
        sessionId: sessionId ?? generatedId,
        logFile,
      };
    }

    // Non-tmux: spawn detached
    const pid = spawnDetached(
      "bash",
      ["-c", `amp ${args.join(" ")} 2>&1 | tee "${logFile}"`],
      { cwd, logFile },
    );

    // Return the original session ID or generated fallback
    return { pid, sessionId: sessionId ?? generatedId, logFile };
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
