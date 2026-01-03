import { execa } from "execa";

// For V1, we use the OpenCode CLI directly since SDK requires server setup
// This provides a simpler path while maintaining the session abstraction

export interface OpenCodeSession {
  sessionId: string;
  worktree: string;
}

const activeSessions = new Map<string, OpenCodeSession>();

export async function runWorker(
  worktree: string,
  planId: string,
  prompt: string
): Promise<string> {
  // Use opencode run for non-interactive execution
  await execa("opencode", ["run", prompt], {
    cwd: worktree,
    timeout: 0, // No timeout, let it run
  });

  // For V1, we use planId as a pseudo session-id
  // Real session tracking would parse from OpenCode output
  const sessionId = `${planId}-${Date.now()}`;

  activeSessions.set(planId, {
    sessionId,
    worktree,
  });

  return sessionId;
}

export async function runDesigner(
  repoRoot: string,
  designerPrompt: string
): Promise<void> {
  // Interactive TUI session for designer
  await execa("opencode", ["--prompt", designerPrompt], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

export async function resumeSession(
  worktree: string,
  sessionId: string
): Promise<void> {
  // Open TUI with existing session
  await execa("opencode", ["--session", sessionId], {
    cwd: worktree,
    stdio: "inherit",
  });
}

export async function abortSession(planId: string): Promise<void> {
  // In V1, we cannot abort a running CLI process from here
  // The session tracking is for resume purposes only
  activeSessions.delete(planId);
}

export function getSessionId(planId: string): string | undefined {
  return activeSessions.get(planId)?.sessionId;
}

export function shutdownAll(): void {
  activeSessions.clear();
}
