import { execa } from "execa";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import type { ExecutionResult } from "./types.js";

let cachedHasTmux: boolean | undefined;

/**
 * Check if tmux is installed on the system.
 */
export async function hasTmux(): Promise<boolean> {
  if (cachedHasTmux !== undefined) return cachedHasTmux;
  try {
    const { exitCode } = await execa("tmux", ["-V"], { reject: false });
    cachedHasTmux = exitCode === 0;
  } catch {
    cachedHasTmux = false;
  }
  return cachedHasTmux;
}

/**
 * Get paths for worker log files in /tmp.
 */
export function getWorkerLogPaths(sessionName: string) {
  const localDir = join("/tmp", sessionName);
  return {
    localDir,
    logFile: join(localDir, "worker.log"),
    exitCodeFile: join(localDir, "worker.exitcode"),
    promptFile: join(localDir, "worker.prompt"),
  };
}

/**
 * Prepare log files directory, clean previous logs, and write prompt to file.
 */
export function prepareLogFiles(
  sessionName: string,
  prompt: string
): {
  logFile: string;
  exitCodeFile: string;
  promptFile: string;
} {
  const { localDir, logFile, exitCodeFile, promptFile } =
    getWorkerLogPaths(sessionName);
  mkdirSync(localDir, { recursive: true });
  if (existsSync(logFile)) unlinkSync(logFile);
  if (existsSync(exitCodeFile)) unlinkSync(exitCodeFile);

  // Write prompt to file to avoid command-line length limits
  writeFileSync(promptFile, prompt, "utf-8");

  return { logFile, exitCodeFile, promptFile };
}

/**
 * Read execution result from log files after tmux session ends.
 */
export function readExecutionResult(sessionName: string): ExecutionResult {
  const { logFile, exitCodeFile } = getWorkerLogPaths(sessionName);

  let exitCode = 0;
  if (existsSync(exitCodeFile)) {
    const code = readFileSync(exitCodeFile, "utf-8").trim();
    exitCode = parseInt(code, 10) || 0;
  }

  // Log last few lines if there was an error
  if (exitCode !== 0 && existsSync(logFile)) {
    const log = readFileSync(logFile, "utf-8");
    const lines = log.trim().split("\n").slice(-20);
    console.error(
      `   Worker log (last 20 lines):\n${lines
        .map((l) => `     ${l}`)
        .join("\n")}`
    );
  }

  return { exitCode };
}

/**
 * Wait for a tmux session to complete (session no longer exists).
 * Polls every second until the session ends.
 */
export async function waitForTmuxSession(sessionName: string): Promise<void> {
  while (true) {
    const { exitCode } = await execa(
      "tmux",
      ["has-session", "-t", sessionName],
      {
        reject: false,
      }
    );
    if (exitCode !== 0) {
      // Session no longer exists - worker finished
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Wait for exit code file to appear (command completed).
 * Also checks if the tmux session is still alive - if the session dies without
 * creating the exit code file, we stop waiting and return.
 * 
 * @param sessionName - The tmux session name
 * @param timeoutMs - Maximum time to wait (default: 2 hours)
 * @returns Object indicating whether the exit code file was found
 */
export async function waitForExitCodeFile(
  sessionName: string,
  timeoutMs: number = 2 * 60 * 60 * 1000
): Promise<{ found: boolean; timedOut: boolean; sessionDied: boolean }> {
  const { exitCodeFile } = getWorkerLogPaths(sessionName);
  const startTime = Date.now();
  let sessionCheckCount = 0;
  
  while (true) {
    // Check if exit code file exists
    if (existsSync(exitCodeFile)) {
      return { found: true, timedOut: false, sessionDied: false };
    }
    
    // Check for timeout
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      console.error(`[waitForExitCodeFile] Timeout waiting for ${sessionName} after ${elapsed}ms`);
      return { found: false, timedOut: true, sessionDied: false };
    }
    
    // Every 10 seconds, check if the tmux session is still alive
    sessionCheckCount++;
    if (sessionCheckCount >= 10) {
      sessionCheckCount = 0;
      const sessionExists = await hasSession(sessionName);
      if (!sessionExists) {
        // Session died - give it one more second for the file to appear
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (existsSync(exitCodeFile)) {
          return { found: true, timedOut: false, sessionDied: false };
        }
        console.error(`[waitForExitCodeFile] Session ${sessionName} died without creating exit code file`);
        return { found: false, timedOut: false, sessionDied: true };
      }
    }
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Check if a tmux session exists.
 */
export async function hasSession(sessionName: string): Promise<boolean> {
  const { exitCode } = await execa(
    "tmux",
    ["has-session", "-t", sessionName],
    { reject: false }
  );
  return exitCode === 0;
}

/**
 * Kill a tmux session if it exists.
 */
export async function killSession(sessionName: string): Promise<boolean> {
  const { exitCode } = await execa(
    "tmux",
    ["kill-session", "-t", sessionName],
    { reject: false }
  );
  return exitCode === 0;
}

/**
 * Send keys to an existing tmux session.
 * Special handling for control characters (e.g., "C-c" for Ctrl+C).
 */
export async function sendKeys(
  sessionName: string,
  command: string
): Promise<boolean> {
  // If the command is a control character (like "C-c"), don't append Enter
  const args = command.startsWith("C-")
    ? ["send-keys", "-t", sessionName, command]
    : ["send-keys", "-t", sessionName, command, "Enter"];
  
  const { exitCode } = await execa("tmux", args, { reject: false });
  return exitCode === 0;
}

/**
 * Execute a command in a tmux session.
 * Kills any existing session with the same name to ensure clean state.
 */
export async function executeInTmux(
  sessionName: string,
  command: string,
  cwd: string
): Promise<ExecutionResult> {
  // Always kill existing session to ensure clean state
  await killSession(sessionName);

  // Create new session with the command
  const tmuxResult = await execa(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      cwd,
      "bash",
      "-c",
      command,
    ],
    { reject: false }
  );

  if (tmuxResult.exitCode !== 0) {
    return { exitCode: tmuxResult.exitCode ?? 1 };
  }

  return { tmuxSession: sessionName };
}
