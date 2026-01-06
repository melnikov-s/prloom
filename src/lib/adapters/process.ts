import { spawn } from "child_process";
import type { SpawnOptions } from "child_process";

/**
 * Spawn a command as a detached process.
 * Returns the child PID immediately without waiting.
 */
export function spawnDetached(
  command: string,
  args: string[],
  options: { cwd?: string; logFile?: string } = {}
): number {
  const spawnOpts: SpawnOptions = {
    cwd: options.cwd,
    detached: true,
    stdio: options.logFile ? ["ignore", "pipe", "pipe"] : "ignore",
  };

  const child = spawn(command, args, spawnOpts);

  // Redirect stdout/stderr to log file if specified
  if (options.logFile && child.stdout && child.stderr) {
    const fs = require("fs");
    const logStream = fs.createWriteStream(options.logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
  }

  // Unreference so parent can exit independently
  child.unref();

  if (!child.pid) {
    throw new Error(`Failed to spawn: ${command}`);
  }

  return child.pid;
}

/**
 * Check if a process is alive by PID.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID.
 * Returns true if killed, false if already dead.
 */
export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process to complete by polling.
 * Returns when the process is no longer alive.
 */
export async function waitForProcess(
  pid: number,
  pollIntervalMs: number = 1000
): Promise<void> {
  while (isProcessAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
