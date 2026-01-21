import { execa } from "execa";

export type AgentName = "amp" | "claude" | "codex" | "gemini" | "opencode";

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
  /** Path to log file (for session ID extraction after completion) */
  logFile?: string;
  /** LLM conversation/session identifier (RFC: Commit Review Gate) */
  sessionId?: string;
}

export interface AgentAdapter {
  name: AgentName;

  /**
   * Execute a prompt in headless mode (for automated worker execution).
   * Session is ephemeral by default - disposed after completion.
   * If sessionId is provided, resumes that conversation.
   * If tmux config provided, runs in a detached tmux session for observation.
   */
  execute(opts: {
    cwd: string;
    prompt: string;
    tmux?: TmuxConfig;
    model?: string;
    /** Resume an existing session (RFC: Commit Review Gate) */
    sessionId?: string;
    /** Tag for log naming/separation (RFC: Commit Review Gate) */
    purpose?: "worker" | "commitReview" | "triage" | "designer";
  }): Promise<ExecutionResult>;

  /**
   * Launch interactive TUI session (for designer).
   */
  interactive(opts: {
    cwd: string;
    prompt?: string;
    model?: string;
  }): Promise<void>;
}

export function isAgentName(value: string): value is AgentName {
  return (
    value === "amp" ||
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "opencode"
  );
}
