import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { prepareLogFiles, executeInTmux } from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";
import {
  buildInitialArgs,
  buildResumeArgs,
  parseLogFileForSessionId,
} from "./session.js";

/**
 * Adapter for OpenCode CLI
 * https://opencode.ai
 *
 * Session resume support:
 * - Initial: opencode run --format json [--model] <prompt>
 * - Resume:  opencode run --format json --session <id> [--model] <prompt>
 * - Extract: JSON line with sessionID field
 */
export const opencodeAdapter: AgentAdapter = {
  name: "opencode",

  async execute({
    cwd,
    prompt,
    tmux,
    model,
    sessionId,
    purpose,
  }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `opencode-${Date.now()}`;
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
      ? buildResumeArgs("opencode", sessionId, promptArg, model)
      : buildInitialArgs("opencode", promptArg, model);

    if (tmux) {
      const cmdLine = `cd ${cwd} && opencode ${args.join(" ")} 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      const result = await executeInTmux(tmux.sessionName, cmdLine, cwd);

      // After tmux completes, parse log for session ID
      // Note: This happens asynchronously; dispatcher will call again after wait
      return {
        ...result,
        logFile,
        sessionId, // Return passed-in sessionId for persistence
      };
    }

    // Non-tmux: spawn detached, session ID parsed later from log
    const pid = spawnDetached(
      "bash",
      ["-c", `opencode ${args.join(" ")} 2>&1 | tee "${logFile}"`],
      { cwd, logFile },
    );

    return { pid, logFile, sessionId };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args = prompt ? ["--prompt", prompt] : [];
    if (model) args.push("--model", model);

    console.log(
      `\n[DEBUG] Running: opencode ${args.map((a) => (a.length > 100 ? `"${a.slice(0, 100)}..."` : `"${a}"`)).join(" ")}`,
    );
    console.log(`[DEBUG] cwd: ${cwd}`);
    console.log(`[DEBUG] prompt length: ${prompt?.length ?? 0} chars\n`);

    await execa("opencode", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
