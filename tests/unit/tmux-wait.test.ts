import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  waitForExitCodeFile,
  getWorkerLogPaths,
  prepareLogFiles,
} from "../../src/lib/adapters/tmux.js";

describe("waitForExitCodeFile", () => {
  const testSessionName = "prloom-test-wait";
  let localDir: string;
  let exitCodeFile: string;

  beforeEach(() => {
    const paths = getWorkerLogPaths(testSessionName);
    localDir = paths.localDir;
    exitCodeFile = paths.exitCodeFile;

    // Clean up before each test
    if (existsSync(localDir)) {
      rmSync(localDir, { recursive: true });
    }
    mkdirSync(localDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(localDir)) {
      rmSync(localDir, { recursive: true });
    }
  });

  it("should return found: true when exit code file exists", async () => {
    // Create the exit code file
    writeFileSync(exitCodeFile, "0");

    const result = await waitForExitCodeFile(testSessionName, 5000);

    expect(result.found).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.sessionDied).toBe(false);
  });

  it("should timeout after specified duration", async () => {
    // Don't create the exit code file
    const result = await waitForExitCodeFile(testSessionName, 100);

    expect(result.found).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.sessionDied).toBe(false);
  });

  it("should detect exit code file created during wait", async () => {
    // Create the exit code file after a short delay
    setTimeout(() => {
      writeFileSync(exitCodeFile, "0");
    }, 50);

    const result = await waitForExitCodeFile(testSessionName, 5000);

    expect(result.found).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.sessionDied).toBe(false);
  });

  it("should handle default timeout value", async () => {
    // Just verify the function accepts the call without timeout argument
    // We won't actually wait 2 hours, just verify it works
    writeFileSync(exitCodeFile, "0");
    const result = await waitForExitCodeFile(testSessionName);

    expect(result.found).toBe(true);
  });
});

describe("getWorkerLogPaths", () => {
  it("should return correct paths", () => {
    const paths = getWorkerLogPaths("test-session");

    expect(paths.localDir).toBe("/tmp/test-session");
    expect(paths.logFile).toBe("/tmp/test-session/worker.log");
    expect(paths.exitCodeFile).toBe("/tmp/test-session/worker.exitcode");
    expect(paths.promptFile).toBe("/tmp/test-session/worker.prompt");
  });
});

describe("prepareLogFiles", () => {
  const testSessionName = "prloom-test-prepare";
  let localDir: string;

  beforeEach(() => {
    const paths = getWorkerLogPaths(testSessionName);
    localDir = paths.localDir;

    if (existsSync(localDir)) {
      rmSync(localDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(localDir)) {
      rmSync(localDir, { recursive: true });
    }
  });

  it("should create directory and write prompt file", () => {
    const paths = prepareLogFiles(testSessionName, "test prompt content");

    expect(existsSync(paths.promptFile)).toBe(true);
    expect(existsSync(localDir)).toBe(true);
  });

  it("should clean up old log and exitcode files", () => {
    // Create old files
    mkdirSync(localDir, { recursive: true });
    const paths = getWorkerLogPaths(testSessionName);
    writeFileSync(paths.logFile, "old log");
    writeFileSync(paths.exitCodeFile, "1");

    // Prepare should clean them
    prepareLogFiles(testSessionName, "new prompt");

    expect(existsSync(paths.logFile)).toBe(false);
    expect(existsSync(paths.exitCodeFile)).toBe(false);
  });
});
