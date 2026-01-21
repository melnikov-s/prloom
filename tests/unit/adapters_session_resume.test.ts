/**
 * Unit tests for adapter session resume functionality.
 *
 * Tests session ID extraction and arg building for all 5 agents.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  extractSessionIdFromOutput,
  parseLogFileForSessionId,
  buildInitialArgs,
  buildResumeArgs,
  generateSessionId,
} from "../../src/lib/adapters/session.js";

// =============================================================================
// Session ID Extraction Tests
// =============================================================================

describe("extractSessionIdFromOutput", () => {
  test("opencode: extracts sessionID from JSON output", () => {
    const stdout = `{"type":"status","message":"Starting..."}
{"sessionID":"sess-abc123","type":"init"}
{"type":"complete"}`;

    const sessionId = extractSessionIdFromOutput("opencode", stdout);
    expect(sessionId).toBe("sess-abc123");
  });

  test("opencode: returns undefined if no sessionID found", () => {
    const stdout = `{"type":"status","message":"Starting..."}
{"type":"complete"}`;

    const sessionId = extractSessionIdFromOutput("opencode", stdout);
    expect(sessionId).toBeUndefined();
  });

  test("claude: returns pre-generated UUID", () => {
    const generatedId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionId = extractSessionIdFromOutput(
      "claude",
      "any output",
      generatedId,
    );
    expect(sessionId).toBe(generatedId);
  });

  test("codex: extracts thread_id from thread.started event", () => {
    const stdout = `{"type":"session.start"}
{"type":"thread.started","thread_id":"thrd-xyz789"}
{"type":"message","content":"Hello"}`;

    const sessionId = extractSessionIdFromOutput("codex", stdout);
    expect(sessionId).toBe("thrd-xyz789");
  });

  test("codex: returns undefined if no thread.started found", () => {
    const stdout = `{"type":"session.start"}
{"type":"message","content":"Hello"}`;

    const sessionId = extractSessionIdFromOutput("codex", stdout);
    expect(sessionId).toBeUndefined();
  });

  test("gemini: extracts session_id from init event", () => {
    const stdout = `{"type":"init","session_id":"gemini-sess-456"}
{"type":"content","text":"Response"}`;

    const sessionId = extractSessionIdFromOutput("gemini", stdout);
    expect(sessionId).toBe("gemini-sess-456");
  });

  test("gemini: returns undefined if no init event found", () => {
    const stdout = `{"type":"content","text":"Response"}`;

    const sessionId = extractSessionIdFromOutput("gemini", stdout);
    expect(sessionId).toBeUndefined();
  });

  test("amp: extracts session_id from JSON output", () => {
    const stdout = `{"session_id":"amp-session-001","status":"started"}
{"type":"message"}`;

    const sessionId = extractSessionIdFromOutput("amp", stdout);
    expect(sessionId).toBe("amp-session-001");
  });

  test("amp: falls back to generated ID if not in output", () => {
    const stdout = `{"type":"message"}`;
    const generatedId = "fallback-amp-123";

    const sessionId = extractSessionIdFromOutput("amp", stdout, generatedId);
    expect(sessionId).toBe(generatedId);
  });
});

// =============================================================================
// Log File Parsing Tests
// =============================================================================

describe("parseLogFileForSessionId", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "session-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("parses session ID from log file", () => {
    const logPath = join(tempDir, "worker.log");
    writeFileSync(
      logPath,
      `Some preamble output
{"sessionID":"from-log-file-123"}
More output`,
    );

    const sessionId = parseLogFileForSessionId("opencode", logPath);
    expect(sessionId).toBe("from-log-file-123");
  });

  test("returns generatedId if file does not exist", () => {
    const sessionId = parseLogFileForSessionId(
      "claude",
      "/nonexistent/path.log",
      "generated-uuid",
    );
    expect(sessionId).toBe("generated-uuid");
  });

  test("returns undefined if file is empty and no generatedId", () => {
    const logPath = join(tempDir, "empty.log");
    writeFileSync(logPath, "");

    const sessionId = parseLogFileForSessionId("opencode", logPath);
    expect(sessionId).toBeUndefined();
  });
});

// =============================================================================
// Build Initial Args Tests
// =============================================================================

describe("buildInitialArgs", () => {
  const promptFile = "/tmp/prompt.txt";

  test("opencode: includes --format json", () => {
    const prompt = "raw prompt string";
    const args = buildInitialArgs("opencode", prompt);
    expect(args).toContain("run");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args[args.length - 1]).toBe(prompt);
  });

  test("opencode: handles shell command as prompt", () => {
    const prompt = "$(cat '/tmp/prompt.txt')";
    const args = buildInitialArgs("opencode", prompt);
    expect(args[args.length - 1]).toBe(prompt);
  });

  test("opencode: includes model when provided", () => {
    const args = buildInitialArgs("opencode", promptFile, "gpt-4");
    expect(args).toContain("--model");
    expect(args).toContain("gpt-4");
  });

  test("claude: includes --session-id with generated UUID", () => {
    const uuid = "test-uuid-123";
    const prompt = "hi";
    const args = buildInitialArgs("claude", prompt, undefined, uuid);
    expect(args).toContain("-p");
    expect(args).toContain(prompt);
    expect(args).toContain("--session-id");
    expect(args).toContain(uuid);
    expect(args).toContain("--dangerously-skip-permissions");
  });

  test("codex: includes --json and --full-auto", () => {
    const args = buildInitialArgs("codex", promptFile);
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--full-auto");
  });

  test("gemini: uses --output-format stream-json and --prompt", () => {
    const args = buildInitialArgs("gemini", promptFile);
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--prompt");
    expect(args).toContain("--yolo");
  });

  test("amp: includes --execute and --stream-json", () => {
    const args = buildInitialArgs("amp", promptFile);
    expect(args).toContain("--execute");
    expect(args).toContain("--stream-json");
  });
});

// =============================================================================
// Build Resume Args Tests
// =============================================================================

describe("buildResumeArgs", () => {
  const promptFile = "/tmp/prompt.txt";
  const sessionId = "session-12345";

  test("opencode: includes --session with session ID", () => {
    const args = buildResumeArgs("opencode", sessionId, promptFile);
    expect(args).toContain("--session");
    expect(args).toContain(sessionId);
    expect(args).toContain("--format");
    expect(args).toContain("json");
  });

  test("claude: uses --resume instead of --session-id", () => {
    const args = buildResumeArgs("claude", sessionId, promptFile);
    expect(args).toContain("--resume");
    expect(args).toContain(sessionId);
    expect(args).not.toContain("--session-id");
  });

  test("codex: uses 'exec resume <sessionId>' pattern", () => {
    const args = buildResumeArgs("codex", sessionId, promptFile);
    expect(args[0]).toBe("exec");
    expect(args[1]).toBe("resume");
    expect(args[2]).toBe(sessionId);
    expect(args).toContain("--json");
    expect(args).toContain("--full-auto");
  });

  test("gemini: uses --resume", () => {
    const args = buildResumeArgs("gemini", sessionId, promptFile);
    expect(args).toContain("--resume");
    expect(args).toContain(sessionId);
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  test("amp: uses 'threads continue' pattern", () => {
    const args = buildResumeArgs("amp", sessionId, promptFile);
    expect(args[0]).toBe("threads");
    expect(args[1]).toBe("continue");
    expect(args).toContain("--execute");
    expect(args).toContain("--stream-json");
  });
});

// =============================================================================
// Utility Tests
// =============================================================================

describe("generateSessionId", () => {
  test("generates a valid UUID", () => {
    const id = generateSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("generates unique IDs", () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();
    expect(id1).not.toBe(id2);
  });
});
