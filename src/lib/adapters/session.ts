/**
 * Session handling utilities for adapter execution.
 *
 * Extracted from call.ts to share session semantics between
 * the callAgent API and individual adapter execute() methods.
 */

import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import type { AgentName } from "./types.js";

/**
 * Extract session ID from agent stdout based on agent-specific JSON format.
 */
export function extractSessionIdFromOutput(
  agent: AgentName,
  stdout: string,
  generatedId?: string,
): string | undefined {
  const lines = stdout.trim().split("\n");

  switch (agent) {
    case "opencode":
      // Parse JSON lines for sessionID field
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
      return undefined;

    case "claude":
      // Claude uses pre-generated UUID, no parsing needed
      return generatedId;

    case "codex":
      // Parse for {"type":"thread.started","thread_id":"..."}
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
      return undefined;

    case "gemini":
      // Parse stream-json for {"type":"init","session_id":"..."}
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
      return undefined;

    case "amp":
      // Parse for session_id in JSON output
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.session_id) {
            return parsed.session_id;
          }
        } catch {
          // Not JSON, skip
        }
      }
      // Fall back to generated ID if provided
      return generatedId;

    default:
      return undefined;
  }
}

/**
 * Parse a log file for session ID after tmux execution completes.
 */
export function parseLogFileForSessionId(
  agent: AgentName,
  logPath: string,
  generatedId?: string,
): string | undefined {
  if (!existsSync(logPath)) {
    return generatedId;
  }
  try {
    const content = readFileSync(logPath, "utf-8");
    return extractSessionIdFromOutput(agent, content, generatedId);
  } catch {
    return generatedId;
  }
}

/**
 * Build initial execution args for an agent (no existing session).
 *
 * @param prompt - The prompt string (can be a raw string or shell command like `"$(cat file)"`)
 */
export function buildInitialArgs(
  agent: AgentName,
  prompt: string,
  model?: string,
  generatedId?: string,
): string[] {
  switch (agent) {
    case "opencode":
      return [
        "run",
        "--format",
        "json",
        ...(model ? ["--model", model] : []),
        prompt,
      ];

    case "claude":
      return [
        "-p",
        prompt,
        ...(generatedId ? ["--session-id", generatedId] : []),
        "--dangerously-skip-permissions",
        ...(model ? ["--model", model] : []),
      ];

    case "codex":
      return [
        "exec",
        prompt,
        "--json",
        "--full-auto",
        ...(model ? ["-m", model] : []),
      ];

    case "gemini":
      return [
        "--output-format",
        "stream-json",
        "--prompt",
        prompt,
        "--yolo",
        ...(model ? ["--model", model] : []),
      ];

    case "amp":
      return [
        "--execute",
        prompt,
        "--stream-json",
        ...(model ? ["--model", model] : []),
      ];

    default:
      return [prompt];
  }
}

/**
 * Build resume execution args for an agent (continuing existing session).
 */
export function buildResumeArgs(
  agent: AgentName,
  sessionId: string,
  prompt: string,
  model?: string,
): string[] {
  switch (agent) {
    case "opencode":
      return [
        "run",
        "--format",
        "json",
        "--session",
        sessionId,
        ...(model ? ["--model", model] : []),
        prompt,
      ];

    case "claude":
      return [
        "-p",
        prompt,
        "--resume",
        sessionId,
        "--dangerously-skip-permissions",
        ...(model ? ["--model", model] : []),
      ];

    case "codex":
      return [
        "exec",
        "resume",
        sessionId,
        prompt,
        "--json",
        "--full-auto",
        ...(model ? ["-m", model] : []),
      ];

    case "gemini":
      return [
        "--output-format",
        "stream-json",
        "--resume",
        sessionId,
        "--prompt",
        prompt,
        "--yolo",
        ...(model ? ["--model", model] : []),
      ];

    case "amp":
      return ["threads", "continue", "--execute", prompt, "--stream-json"];

    default:
      return [prompt];
  }
}

/**
 * Generate a new session ID for agents that require pre-generation (Claude).
 */
export function generateSessionId(): string {
  return randomUUID();
}

/**
 * Get the CLI command for an agent.
 */
export function getAgentCommand(agent: AgentName): string {
  const commands: Record<AgentName, string> = {
    opencode: "opencode",
    claude: "claude",
    codex: "codex",
    gemini: "gemini",
    amp: "amp",
  };
  return commands[agent] ?? agent;
}
