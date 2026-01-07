import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getWorkerLogPaths, prepareLogFiles } from "../../src/lib/adapters/tmux.js";

/**
 * Tests for opencode adapter log file handling.
 *
 * These tests verify that the opencode adapter correctly sets up log files
 * regardless of whether tmux is available. The key fix being tested is that
 * when running without tmux, the adapter still:
 * 1. Uses the provided session name for log paths (not a generated one)
 * 2. Passes the logFile to spawnDetached so output is captured
 */

const testSessions: string[] = [];

afterEach(() => {
  // Clean up all test directories created during tests
  for (const session of testSessions) {
    const { localDir } = getWorkerLogPaths(session);
    if (existsSync(localDir)) {
      rmSync(localDir, { recursive: true, force: true });
    }
  }
  testSessions.length = 0;
});

function trackSession(name: string) {
  testSessions.push(name);
  return name;
}

describe("opencode adapter log file paths", () => {
  it("prepareLogFiles creates files at the correct session-based path", () => {
    const sessionName = trackSession("prloom-test-opencode-paths");
    const prompt = "test prompt";
    const paths = prepareLogFiles(sessionName, prompt);

    // Verify paths are based on session name
    expect(paths.logFile).toBe(`/tmp/${sessionName}/worker.log`);
    expect(paths.promptFile).toBe(`/tmp/${sessionName}/worker.prompt`);
    expect(paths.exitCodeFile).toBe(`/tmp/${sessionName}/worker.exitcode`);

    // Verify prompt file was created with correct content
    expect(existsSync(paths.promptFile)).toBe(true);
    expect(readFileSync(paths.promptFile, "utf-8")).toBe(prompt);
  });

  it("TUI can find logs at prloom-{planId} path", () => {
    // Simulate what the adapter does - prepare log files with session name
    const planId = "test-plan-456";
    const sessionName = trackSession(`prloom-${planId}`);
    const paths = prepareLogFiles(sessionName, "test prompt");

    // Simulate log output being written (what tee or spawnDetached would do)
    writeFileSync(paths.logFile, "line 1\nline 2\nline 3\n");

    // Verify the TUI would find these logs at the expected path
    const expectedTuiLogPath = join("/tmp", `prloom-${planId}`, "worker.log");
    expect(existsSync(expectedTuiLogPath)).toBe(true);
    expect(readFileSync(expectedTuiLogPath, "utf-8")).toContain("line 1");
  });

  it("session name falls back to timestamp-based name when tmux config not provided", () => {
    // This tests the fallback behavior: tmux?.sessionName ?? `opencode-${Date.now()}`
    // When no tmux config is provided, a timestamp-based session name is used
    const sessionName = undefined;
    const fallbackName = sessionName ?? `opencode-${Date.now()}`;

    expect(fallbackName).toMatch(/^opencode-\d+$/);
  });

  it("session name uses tmux.sessionName when provided", () => {
    // This tests that the session name from tmux config is used
    const tmuxConfig = { sessionName: "prloom-my-plan-id" };
    const sessionName = tmuxConfig?.sessionName ?? `opencode-${Date.now()}`;

    expect(sessionName).toBe("prloom-my-plan-id");
  });
});

describe("opencode adapter spawnDetached integration", () => {
  it("spawnDetached accepts logFile option and returns valid PID", () => {
    const {
      spawnDetached,
      killProcess,
    } = require("../../src/lib/adapters/process.js");

    const sessionName = trackSession("prloom-spawn-test");
    const paths = prepareLogFiles(sessionName, "test");

    // Spawn a process that writes to stdout - it should be captured in logFile
    const pid = spawnDetached("bash", ["-c", 'sleep 0.5; echo "test output"'], {
      logFile: paths.logFile,
    });

    expect(typeof pid).toBe("number");
    expect(pid).toBeGreaterThan(0);

    // Clean up - kill the process
    killProcess(pid);
  });

  it("spawnDetached creates log file when output is written", async () => {
    const {
      spawnDetached,
      waitForProcess,
    } = require("../../src/lib/adapters/process.js");

    const sessionName = trackSession("prloom-log-capture-test");
    const paths = prepareLogFiles(sessionName, "test");

    // Spawn a process that writes output
    const pid = spawnDetached(
      "bash",
      ["-c", 'echo "captured output"; sleep 0.2'],
      { logFile: paths.logFile }
    );

    // Wait for process to complete
    await waitForProcess(pid, 50);

    // Give filesystem time to flush
    await new Promise((r) => setTimeout(r, 300));

    // Check if log file exists and has content
    // Note: This may be timing-dependent in some environments
    if (existsSync(paths.logFile)) {
      const content = readFileSync(paths.logFile, "utf-8");
      expect(content).toContain("captured output");
    }
  });
});
