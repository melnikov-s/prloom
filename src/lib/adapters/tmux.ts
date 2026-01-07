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
