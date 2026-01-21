/**
 * callAgent - High-level API for executing agent prompts with session resume support
 *
 * Returns a result with a resume() helper that allows continuing the same
 * conversation session without persistence.
 */

import { execa, type ExecaMethod } from "execa";
import { randomUUID } from "crypto";
import type { AgentName } from "./types.js";
import {
  extractSessionIdFromOutput,
  buildInitialArgs,
  buildResumeArgs,
  getAgentCommand,
} from "./session.js";

export interface CallAgentOptions {
  agent: AgentName;
  cwd: string;
  prompt: string;
  model?: string;
  /** Internal: override execa for testing */
  _execaOverride?: ExecaMethod;
}

export interface CallAgentResult {
  sessionId: string;
  stdout: string;
  exitCode: number;
  resume: (prompt: string) => Promise<CallAgentResult>;
}

/**
 * Execute an agent prompt and return a result with resume capability.
 *
 * @example
 * const result = await callAgent({ agent: "opencode", cwd: "/my/project", prompt: "Add tests" });
 * console.log(result.sessionId);
 *
 * // Later, continue the conversation:
 * const followUp = await result.resume("Now add more edge cases");
 */
export async function callAgent(
  opts: CallAgentOptions,
): Promise<CallAgentResult> {
  const execFn = opts._execaOverride ?? execa;

  // For Claude, we pre-generate the session ID
  const preGeneratedId = opts.agent === "claude" ? randomUUID() : undefined;
  const command = getAgentCommand(opts.agent);
  const args = buildInitialArgs(
    opts.agent,
    opts.prompt,
    opts.model,
    preGeneratedId,
  );

  const result = await execFn(command, args, {
    cwd: opts.cwd,
    reject: false,
  });

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const exitCode = result.exitCode ?? 0;

  const sessionId = extractSessionIdFromOutput(
    opts.agent,
    stdout,
    preGeneratedId,
  );

  if (!sessionId) {
    throw new Error(`Could not extract sessionId from ${opts.agent} output`);
  }

  const resume = async (prompt: string): Promise<CallAgentResult> => {
    if (!prompt || prompt.trim() === "") {
      throw new Error("resume() requires a non-empty prompt");
    }

    const resumeArgs = buildResumeArgs(
      opts.agent,
      sessionId,
      prompt,
      opts.model,
    );

    const resumeResult = await execFn(command, resumeArgs, {
      cwd: opts.cwd,
      reject: false,
    });

    const resumeStdout =
      typeof resumeResult.stdout === "string" ? resumeResult.stdout : "";
    const resumeExitCode = resumeResult.exitCode ?? 0;

    // Resume returns the same sessionId (conversation continues)
    return {
      sessionId,
      stdout: resumeStdout as string,
      exitCode: resumeExitCode,
      resume,
    };
  };

  return {
    sessionId,
    stdout: stdout as string,
    exitCode,
    resume,
  };
}
