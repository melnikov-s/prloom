import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  prepareLogFiles,
  getWorkerLogPaths,
  readExecutionResult,
  waitForExitCodeFile,
} from "../../src/lib/adapters/tmux.js";

const TEST_SESSION = "prloom-test-plan-123";

afterEach(() => {
  // Clean up test directory
  const { localDir } = getWorkerLogPaths(TEST_SESSION);
  if (existsSync(localDir)) {
    rmSync(localDir, { recursive: true, force: true });
  }
});

test("getWorkerLogPaths returns correct paths in /tmp", () => {
  const paths = getWorkerLogPaths(TEST_SESSION);

  expect(paths.localDir).toBe(`/tmp/${TEST_SESSION}`);
  expect(paths.logFile).toBe(`/tmp/${TEST_SESSION}/worker.log`);
  expect(paths.exitCodeFile).toBe(`/tmp/${TEST_SESSION}/worker.exitcode`);
  expect(paths.promptFile).toBe(`/tmp/${TEST_SESSION}/worker.prompt`);
});

test("prepareLogFiles creates directory and writes prompt", () => {
  const prompt = "Test prompt content";
  const paths = prepareLogFiles(TEST_SESSION, prompt);

  expect(existsSync(paths.promptFile)).toBe(true);
  expect(readFileSync(paths.promptFile, "utf-8")).toBe(prompt);
});

test("prepareLogFiles cleans previous log files", () => {
  const { localDir, logFile, exitCodeFile, promptFile } =
    getWorkerLogPaths(TEST_SESSION);

  // Create previous files
  mkdirSync(localDir, { recursive: true });
  const fs = require("fs");
  fs.writeFileSync(logFile, "old log");
  fs.writeFileSync(exitCodeFile, "1");

  // Prepare new files
  prepareLogFiles(TEST_SESSION, "new prompt");

  // Log and exit files should be deleted, prompt should exist
  expect(existsSync(logFile)).toBe(false);
  expect(existsSync(exitCodeFile)).toBe(false);
  expect(existsSync(promptFile)).toBe(true);
});

test("readExecutionResult returns 0 when no exit code file", () => {
  const { localDir } = getWorkerLogPaths(TEST_SESSION);
  mkdirSync(localDir, { recursive: true });

  const result = readExecutionResult(TEST_SESSION);
  expect(result.exitCode).toBe(0);
});

test("readExecutionResult reads exit code from file", () => {
  const { localDir, exitCodeFile } = getWorkerLogPaths(TEST_SESSION);
  mkdirSync(localDir, { recursive: true });

  const fs = require("fs");
  fs.writeFileSync(exitCodeFile, "42");

  const result = readExecutionResult(TEST_SESSION);
  expect(result.exitCode).toBe(42);
});

test("waitForExitCodeFile resolves when exit code file exists", async () => {
  const { localDir, exitCodeFile } = getWorkerLogPaths(TEST_SESSION);
  mkdirSync(localDir, { recursive: true });

  // Create exit code file immediately
  writeFileSync(exitCodeFile, "0");

  // Should resolve immediately
  const start = Date.now();
  await waitForExitCodeFile(TEST_SESSION);
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(100); // Should be nearly instant
});

test("waitForExitCodeFile waits for exit code file to appear", async () => {
  const { localDir, exitCodeFile } = getWorkerLogPaths(TEST_SESSION);
  mkdirSync(localDir, { recursive: true });

  // Create file after a delay
  setTimeout(() => {
    writeFileSync(exitCodeFile, "0");
  }, 500);

  const start = Date.now();
  await waitForExitCodeFile(TEST_SESSION);
  const elapsed = Date.now() - start;

  // Should wait at least 500ms but not much longer than 1.5s (1s poll interval + buffer)
  expect(elapsed).toBeGreaterThanOrEqual(400);
  expect(elapsed).toBeLessThan(2000);
});
