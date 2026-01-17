/**
 * callAgent - High-level API for executing agent prompts with session resume support
 *
 * Returns a result with a resume() helper that allows continuing the same
 * conversation session without persistence.
 */

import { execa, type ExecaMethod } from "execa";
import { randomUUID } from "crypto";
import type { AgentName } from "./types.js";

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

interface SessionHandler {
  extractSessionId: (stdout: string, generatedId?: string) => string;
  buildInitialArgs: (opts: CallAgentOptions, sessionId?: string) => string[];
  buildResumeArgs: (opts: CallAgentOptions, sessionId: string) => string[];
  command: string;
}

const sessionHandlers: Record<AgentName, SessionHandler> = {
  opencode: {
    command: "opencode",
    extractSessionId(stdout: string): string {
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.sessionID) {
            return parsed.sessionID;
          }
        } catch {
          // Not JSON, skip
        }
      }
      throw new Error("Could not extract sessionID from opencode output");
    },
    buildInitialArgs(opts: CallAgentOptions): string[] {
      const args = ["run", "--format", "json"];
      if (opts.model) {
        args.push("--model", opts.model);
      }
      args.push(opts.prompt);
      return args;
    },
    buildResumeArgs(opts: CallAgentOptions, sessionId: string): string[] {
      const args = ["run", "--format", "json", "--session", sessionId];
      if (opts.model) {
        args.push("--model", opts.model);
      }
      args.push(opts.prompt);
      return args;
    },
  },

  codex: {
    command: "codex",
    extractSessionId(stdout: string): string {
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "thread.started" && parsed.thread_id) {
            return parsed.thread_id;
          }
        } catch {
          // Not JSON, skip
        }
      }
      throw new Error("Could not extract thread_id from codex output");
    },
    buildInitialArgs(opts: CallAgentOptions): string[] {
      const args = ["exec", opts.prompt, "--json", "--full-auto"];
      if (opts.model) {
        args.push("-m", opts.model);
      }
      return args;
    },
    buildResumeArgs(opts: CallAgentOptions, sessionId: string): string[] {
      const args = ["exec", "resume", sessionId, opts.prompt, "--json", "--full-auto"];
      if (opts.model) {
        args.push("-m", opts.model);
      }
      return args;
    },
  },

  claude: {
    command: "claude",
    extractSessionId(_stdout: string, generatedId?: string): string {
      // Claude uses a pre-generated UUID passed via --session-id
      if (!generatedId) {
        throw new Error("Claude requires a pre-generated session ID");
      }
      return generatedId;
    },
    buildInitialArgs(opts: CallAgentOptions, sessionId?: string): string[] {
      const args = ["-p", opts.prompt, "--dangerously-skip-permissions"];
      if (sessionId) {
        args.push("--session-id", sessionId);
      }
      if (opts.model) {
        args.push("--model", opts.model);
      }
      return args;
    },
    buildResumeArgs(opts: CallAgentOptions, sessionId: string): string[] {
      const args = ["-p", opts.prompt, "--resume", sessionId, "--dangerously-skip-permissions"];
      if (opts.model) {
        args.push("--model", opts.model);
      }
      return args;
    },
  },

  gemini: {
    command: "gemini",
    extractSessionId(stdout: string): string {
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "init" && parsed.session_id) {
            return parsed.session_id;
          }
        } catch {
          // Not JSON, skip
        }
      }
      throw new Error("Could not extract session_id from gemini output");
    },
    buildInitialArgs(opts: CallAgentOptions): string[] {
      const args = ["--output-format", "stream-json", "--prompt", opts.prompt, "--yolo"];
      if (opts.model) {
        args.push("--model", opts.model);
      }
      return args;
    },
    buildResumeArgs(opts: CallAgentOptions, sessionId: string): string[] {
      const args = [
        "--output-format",
        "stream-json",
        "--resume",
        sessionId,
        "--prompt",
        opts.prompt,
        "--yolo",
      ];
      if (opts.model) {
        args.push("--model", opts.model);
      }
      return args;
    },
  },
};

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
export async function callAgent(opts: CallAgentOptions): Promise<CallAgentResult> {
  const handler = sessionHandlers[opts.agent];
  if (!handler) {
    throw new Error(`Unknown agent: ${opts.agent}`);
  }

  const execFn = opts._execaOverride ?? execa;

  // For Claude, we pre-generate the session ID
  const preGeneratedId = opts.agent === "claude" ? randomUUID() : undefined;
  const args = handler.buildInitialArgs(opts, preGeneratedId);

  const result = await execFn(handler.command, args, {
    cwd: opts.cwd,
    reject: false,
  });

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const exitCode = result.exitCode ?? 0;

  const sessionId = handler.extractSessionId(stdout, preGeneratedId);

  const resume = async (prompt: string): Promise<CallAgentResult> => {
    if (!prompt || prompt.trim() === "") {
      throw new Error("resume() requires a non-empty prompt");
    }

    const resumeOpts: CallAgentOptions = {
      ...opts,
      prompt,
    };

    const resumeArgs = handler.buildResumeArgs(resumeOpts, sessionId);

    const resumeResult = await execFn(handler.command, resumeArgs, {
      cwd: resumeOpts.cwd,
      reject: false,
    });

    const resumeStdout = typeof resumeResult.stdout === "string" ? resumeResult.stdout : "";
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
