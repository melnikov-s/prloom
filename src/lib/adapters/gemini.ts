import { execa } from "execa";
import type { AgentAdapter, ExecutionResult, TmuxConfig } from "./types.js";
import { prepareLogFiles, executeInTmux } from "./tmux.js";
import { spawnDetached } from "./process.js";
import { existsSync } from "fs";
import { buildInitialArgs, buildResumeArgs } from "./session.js";

/**
 * Adapter for Gemini CLI
 * https://github.com/google-gemini/gemini-cli
 *
 * Session resume support:
 * - Initial: gemini --output-format stream-json --prompt <prompt> --yolo [--model]
 * - Resume:  gemini --output-format stream-json --resume <id> --prompt <prompt> --yolo [--model]
 * - Extract: JSON event {"type":"init","session_id":"..."}
 */
export const geminiAdapter: AgentAdapter = {
  name: "gemini",

  async execute({
    cwd,
    prompt,
    tmux,
    model,
    sessionId,
    purpose,
  }): Promise<ExecutionResult> {
    const sessionName = tmux?.sessionName ?? `gemini-${Date.now()}`;
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
      ? buildResumeArgs("gemini", sessionId, promptArg, model)
      : buildInitialArgs("gemini", promptArg, model);

    if (tmux) {
      const cmdLine = `cd ${cwd} && gemini ${args.join(" ")} 2>&1 | tee "${logFile}"; echo $? > "${exitCodeFile}"`;
      const result = await executeInTmux(tmux.sessionName, cmdLine, cwd);
      return { ...result, logFile, sessionId };
    }

    // Non-tmux: spawn detached
    const pid = spawnDetached(
      "bash",
      ["-c", `gemini ${args.join(" ")} 2>&1 | tee "${logFile}"`],
      { cwd, logFile },
    );

    return { pid, logFile, sessionId };
  },

  async interactive({ cwd, prompt, model }): Promise<void> {
    const args: string[] = [];
    if (model) args.push("--model", model);
    if (prompt) args.push("-i", prompt);
    await execa("gemini", args, {
      cwd,
      stdio: "inherit",
    });
  },
};
