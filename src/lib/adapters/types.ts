import { execa } from "execa";

export type AgentName = "codex" | "opencode" | "claude" | "manual";

export interface TmuxConfig {
  sessionName: string;
}

export interface ExecutionResult {
  exitCode: number;
}

export interface AgentAdapter {
  name: AgentName;

  /**
   * Execute a prompt in headless mode (for automated worker execution).
   * Session is ephemeral - disposed after completion.
   * If tmux config provided, runs in a detached tmux session for observation.
   */
  execute(opts: {
    cwd: string;
    prompt: string;
    tmux?: TmuxConfig;
  }): Promise<ExecutionResult>;

  /**
   * Launch interactive TUI session (for designer or manual takeover).
   * Session is ephemeral - not tracked for resume.
   */
  interactive(opts: { cwd: string; prompt?: string }): Promise<void>;
}

export function isAgentName(value: string): value is AgentName {
  return (
    value === "codex" ||
    value === "opencode" ||
    value === "claude" ||
    value === "manual"
  );
}
