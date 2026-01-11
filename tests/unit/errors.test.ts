import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  logError,
  logDispatcherError,
  logAdapterError,
  logBusError,
  logBridgeError,
  logFatalError,
  logWarning,
  readErrors,
  readRecentErrors,
  clearErrors,
  getErrorsPath,
  flushErrorBuffer,
} from "../../src/lib/errors.js";

describe("Error Logging", () => {
  const testWorktree = "/tmp/prloom-test-errors";

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testWorktree)) {
      rmSync(testWorktree, { recursive: true });
    }
    mkdirSync(testWorktree, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testWorktree)) {
      rmSync(testWorktree, { recursive: true });
    }
  });

  it("should log errors to jsonl file", () => {
    logError({
      worktree: testWorktree,
      category: "dispatcher",
      message: "Test error message",
    });

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe("Test error message");
    expect(errors[0]!.category).toBe("dispatcher");
    expect(errors[0]!.severity).toBe("error");
  });

  it("should log errors with stack traces", () => {
    const testError = new Error("Test stack trace");
    logError({
      worktree: testWorktree,
      category: "adapter",
      message: "Adapter failed",
      error: testError,
    });

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.stack).toBeDefined();
    expect(errors[0]!.stack).toContain("Test stack trace");
  });

  it("should log errors with context", () => {
    logError({
      worktree: testWorktree,
      category: "bus",
      message: "Bus error",
      context: { actionId: "test-123", retryable: true },
    });

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toEqual({ actionId: "test-123", retryable: true });
  });

  it("should log errors with planId", () => {
    logError({
      worktree: testWorktree,
      category: "dispatcher",
      message: "Plan error",
      planId: "my-plan-123",
    });

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.planId).toBe("my-plan-123");
  });

  it("should append multiple errors", () => {
    logDispatcherError(testWorktree, "Error 1");
    logDispatcherError(testWorktree, "Error 2");
    logDispatcherError(testWorktree, "Error 3");

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(3);
    expect(errors.map((e) => e.message)).toEqual([
      "Error 1",
      "Error 2",
      "Error 3",
    ]);
  });

  it("should read recent errors", () => {
    for (let i = 0; i < 10; i++) {
      logDispatcherError(testWorktree, `Error ${i}`);
    }

    const recentErrors = readRecentErrors(testWorktree, 3);
    expect(recentErrors.length).toBe(3);
    expect(recentErrors.map((e) => e.message)).toEqual([
      "Error 7",
      "Error 8",
      "Error 9",
    ]);
  });

  it("should clear errors", () => {
    logDispatcherError(testWorktree, "Error to clear");
    expect(readErrors(testWorktree).length).toBe(1);

    clearErrors(testWorktree);
    expect(readErrors(testWorktree).length).toBe(0);
  });

  it("should handle logAdapterError", () => {
    logAdapterError(testWorktree, "Adapter error", undefined, "plan-123");

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.category).toBe("adapter");
    expect(errors[0]!.planId).toBe("plan-123");
  });

  it("should handle logBusError", () => {
    logBusError(testWorktree, "Bus error", undefined, undefined, {
      actionId: "act-1",
    });

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.category).toBe("bus");
    expect(errors[0]!.context?.actionId).toBe("act-1");
  });

  it("should handle logBridgeError with bridge name", () => {
    logBridgeError(testWorktree, "github", "GitHub API error");

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.category).toBe("bridge");
    expect(errors[0]!.context?.bridgeName).toBe("github");
  });

  it("should handle logFatalError", () => {
    logFatalError(testWorktree, "dispatcher", "Fatal error");

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.severity).toBe("fatal");
  });

  it("should handle logWarning", () => {
    logWarning(testWorktree, "adapter", "Warning message");

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.severity).toBe("warn");
  });

  it("should create .local directory if it doesn't exist", () => {
    const newWorktree = join(testWorktree, "nested");
    mkdirSync(newWorktree, { recursive: true });

    logDispatcherError(newWorktree, "Error");

    expect(existsSync(getErrorsPath(newWorktree))).toBe(true);
  });

  it("should return empty array if no errors file", () => {
    const emptyWorktree = join(testWorktree, "empty");
    mkdirSync(emptyWorktree, { recursive: true });

    const errors = readErrors(emptyWorktree);
    expect(errors).toEqual([]);
  });

  it("should include timestamp in errors", () => {
    const before = new Date().toISOString();
    logDispatcherError(testWorktree, "Timestamped error");
    const after = new Date().toISOString();

    const errors = readErrors(testWorktree);
    expect(errors.length).toBe(1);
    expect(errors[0]!.ts).toBeDefined();
    expect(errors[0]!.ts >= before).toBe(true);
    expect(errors[0]!.ts <= after).toBe(true);
  });
});
