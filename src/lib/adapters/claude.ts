import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { prepareLogFiles, executeInTmux } from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";
import {
  buildInitialArgs,
  buildResumeArgs,
  generateSessionId,
} from "./session.js";

/**
 * Adapter for Claude Code CLI
 * https://docs.anthropic.com/claude-code
 *
 * Session resume support:
 * - Initial: claude -p <prompt> --session-id <uuid> [--model] --dangerously-skip-permissions
 * - Resume:  claude -p <prompt> --resume <uuid> [--model] --dangerously-skip-permissions
 * - Extract: Pre-generated UUID (no parsing needed)
 */
export const claudeAdapter: AgentAdapter = {
  name: "claude",

  async execute({
    cwd,
    prompt,
    tmux,
    model,
    sessionId,
    purpose,
  }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `claude-${Date.now()}`;
    const { logFile, exitCodeFile, promptFile } = prepareLogFiles(
      sessionName,
      prompt,
    );

    if (!existsSync(promptFile)) {
      return { exitCode: 1 };
    }

    // For Claude, generate a new session ID on initial run
    const effectiveSessionId = sessionId ?? generateSessionId();

    // Build args using session helpers
    const promptArg = `"$(cat '${promptFile}')"`;
    const args = sessionId
      ? buildResumeArgs("claude", sessionId, promptArg, model)
      : buildInitialArgs("claude", promptArg, model, effectiveSessionId);

    if (tmux) {
      const cmdLine = `cd ${cwd} && claude ${args.join(" ")} 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      const result = await executeInTmux(tmux.sessionName, cmdLine, cwd);

      // Return the session ID (pre-generated for Claude)
      return {
        ...result,
        sessionId: effectiveSessionId,
        logFile,
      };
    }

    // Non-tmux: spawn detached
    const pid = spawnDetached(
      "bash",
      ["-c", `claude ${args.join(" ")} 2>&1 | tee "${logFile}"`],
      { cwd, logFile },
    );

    // Return session ID for Claude (pre-generated UUID)
    return { pid, sessionId: effectiveSessionId, logFile };
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
