import { execa } from "execa";

export type AgentName = "codex" | "opencode" | "claude" | "gemini" | "manual";

export interface TmuxConfig {
  sessionName: string;
}

export interface ExecutionResult {
  /** Exit code (only set when execution completes synchronously or after waiting) */
  exitCode?: number;
  /** PID of detached process (for async execution without tmux) */
  pid?: number;
  /** Tmux session name (for async execution with tmux) */
  tmuxSession?: string;
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
    model?: string;
  }): Promise<ExecutionResult>;

  /**
   * Launch interactive TUI session (for designer or manual takeover).
   */
  interactive(opts: {
    cwd: string;
    prompt?: string;
    model?: string;
  }): Promise<void>;
}

export function isAgentName(value: string): value is AgentName {
  return (
    value === "codex" ||
    value === "opencode" ||
    value === "claude" ||
    value === "gemini" ||
    value === "manual"
  );
}
