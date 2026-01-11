/**
 * Error Logging System
 *
 * Provides persistent error logging to a JSONL file in the worktree's .local directory.
 * This helps diagnose issues that might otherwise be silently swallowed.
 */

import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "fs";

// =============================================================================
// Types
// =============================================================================

export type ErrorSeverity = "error" | "warn" | "fatal";

export type ErrorCategory =
  | "dispatcher"
  | "adapter"
  | "bus"
  | "bridge"
  | "hook"
  | "git"
  | "github"
  | "triage"
  | "review"
  | "unknown";

export interface ErrorRecord {
  /** ISO timestamp */
  ts: string;
  /** Error severity */
  severity: ErrorSeverity;
  /** Category of the error */
  category: ErrorCategory;
  /** Human-readable error message */
  message: string;
  /** Plan ID if applicable */
  planId?: string;
  /** Stack trace if available */
  stack?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

// =============================================================================
// Constants
// =============================================================================

const LOCAL_DIR = "prloom/.local";
const ERRORS_FILE = "errors.jsonl";

// In-memory buffer for global errors (before worktree is available)
let globalErrorBuffer: ErrorRecord[] = [];

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the errors file path for a worktree.
 */
export function getErrorsPath(worktree: string): string {
  return join(worktree, LOCAL_DIR, ERRORS_FILE);
}

/**
 * Ensure the .local directory exists in a worktree.
 */
function ensureLocalDir(worktree: string): void {
  const localDir = join(worktree, LOCAL_DIR);
  if (!existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
  }
}

// =============================================================================
// Error Logging
// =============================================================================

/**
 * Log an error to the errors.jsonl file in the worktree.
 * If no worktree is provided, the error is buffered in memory.
 */
export function logError(
  options: {
    worktree?: string;
    severity?: ErrorSeverity;
    category: ErrorCategory;
    message: string;
    planId?: string;
    error?: unknown;
    context?: Record<string, unknown>;
  }
): void {
  const record: ErrorRecord = {
    ts: new Date().toISOString(),
    severity: options.severity ?? "error",
    category: options.category,
    message: options.message,
    planId: options.planId,
    context: options.context,
  };

  // Extract stack trace if error is provided
  if (options.error instanceof Error) {
    record.stack = options.error.stack;
    // Append error message to context if different from main message
    if (options.error.message !== options.message) {
      record.context = {
        ...record.context,
        errorMessage: options.error.message,
      };
    }
  } else if (options.error !== undefined) {
    record.context = {
      ...record.context,
      errorValue: String(options.error),
    };
  }

  if (options.worktree) {
    appendErrorToFile(options.worktree, record);
  } else {
    // Buffer errors when worktree is not available
    globalErrorBuffer.push(record);
  }
}

/**
 * Append an error record to the errors.jsonl file.
 */
function appendErrorToFile(worktree: string, record: ErrorRecord): void {
  try {
    ensureLocalDir(worktree);
    const errorsPath = getErrorsPath(worktree);
    appendFileSync(errorsPath, JSON.stringify(record) + "\n");
  } catch (e) {
    // Last resort: log to console if we can't write to file
    console.error("[ERROR LOGGER FAILED]", e);
    console.error("[ORIGINAL ERROR]", record);
  }
}

/**
 * Flush buffered global errors to a worktree's error log.
 * Call this once a worktree becomes available.
 */
export function flushErrorBuffer(worktree: string): void {
  if (globalErrorBuffer.length === 0) return;

  for (const record of globalErrorBuffer) {
    appendErrorToFile(worktree, record);
  }
  globalErrorBuffer = [];
}

/**
 * Read all errors from the errors.jsonl file.
 */
export function readErrors(worktree: string): ErrorRecord[] {
  const errorsPath = getErrorsPath(worktree);

  if (!existsSync(errorsPath)) {
    return [];
  }

  const content = readFileSync(errorsPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  const errors: ErrorRecord[] = [];
  for (const line of lines) {
    try {
      errors.push(JSON.parse(line) as ErrorRecord);
    } catch {
      // Skip malformed lines
    }
  }

  return errors;
}

/**
 * Read recent errors (last N entries).
 */
export function readRecentErrors(
  worktree: string,
  count: number = 50
): ErrorRecord[] {
  const errors = readErrors(worktree);
  return errors.slice(-count);
}

/**
 * Clear the errors log file.
 */
export function clearErrors(worktree: string): void {
  const errorsPath = getErrorsPath(worktree);
  if (existsSync(errorsPath)) {
    writeFileSync(errorsPath, "");
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Log a dispatcher error.
 */
export function logDispatcherError(
  worktree: string | undefined,
  message: string,
  error?: unknown,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    category: "dispatcher",
    message,
    error,
    planId,
    context,
  });
}

/**
 * Log an adapter error.
 */
export function logAdapterError(
  worktree: string | undefined,
  message: string,
  error?: unknown,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    category: "adapter",
    message,
    error,
    planId,
    context,
  });
}

/**
 * Log a bus/bridge error.
 */
export function logBusError(
  worktree: string | undefined,
  message: string,
  error?: unknown,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    category: "bus",
    message,
    error,
    planId,
    context,
  });
}

/**
 * Log a bridge-specific error.
 */
export function logBridgeError(
  worktree: string | undefined,
  bridgeName: string,
  message: string,
  error?: unknown,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    category: "bridge",
    message,
    error,
    planId,
    context: { ...context, bridgeName },
  });
}

/**
 * Log a fatal error (should trigger plan blocking).
 */
export function logFatalError(
  worktree: string | undefined,
  category: ErrorCategory,
  message: string,
  error?: unknown,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    severity: "fatal",
    category,
    message,
    error,
    planId,
    context,
  });
}

/**
 * Log a warning (non-fatal but noteworthy).
 */
export function logWarning(
  worktree: string | undefined,
  category: ErrorCategory,
  message: string,
  planId?: string,
  context?: Record<string, unknown>
): void {
  logError({
    worktree,
    severity: "warn",
    category,
    message,
    planId,
    context,
  });
}
