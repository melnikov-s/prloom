import { execa } from "execa";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import type { ExecutionResult } from "./types.js";

/**
 * Get paths for worker log files.
 */
export function getWorkerLogPaths(cwd: string) {
  const localDir = join(cwd, "prloom", ".local");
  return {
    localDir,
    logFile: join(localDir, "worker.log"),
    exitCodeFile: join(localDir, "worker.exitcode"),
  };
}

/**
 * Prepare log files directory and clean previous logs.
 */
export function prepareLogFiles(cwd: string): {
  logFile: string;
  exitCodeFile: string;
} {
  const { localDir, logFile, exitCodeFile } = getWorkerLogPaths(cwd);
  mkdirSync(localDir, { recursive: true });
  if (existsSync(logFile)) unlinkSync(logFile);
  if (existsSync(exitCodeFile)) unlinkSync(exitCodeFile);
  return { logFile, exitCodeFile };
}

/**
 * Read execution result from log files after tmux session ends.
 */
export function readExecutionResult(cwd: string): ExecutionResult {
  const { logFile, exitCodeFile } = getWorkerLogPaths(cwd);

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
