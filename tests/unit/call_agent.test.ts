/**
 * Tests for callAgent with resume functionality
 *
 * TDD: Tests written before implementation.
 *
 * callAgent returns a result with a resume() helper that allows
 * continuing the same conversation session.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Will be imported once implemented
// import { callAgent, type CallAgentResult } from "../../src/lib/adapters/call.js";

describe("callAgent", () => {
  let tempDir: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "call-agent-test-"));
    cwd = join(tempDir, "workspace");
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("return value", () => {
    test("returns object with sessionId and resume function", async () => {
      // Import dynamically to allow the module to be created
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      // Mock CLI execution to return session ID
      const mockExeca = mock(() =>
        Promise.resolve({
          stdout: JSON.stringify({ sessionID: "test-session-123" }) + "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "Hello world",
        _execaOverride: mockExeca as any,
      });

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("resume");
      expect(typeof result.resume).toBe("function");
    });

    test("resume throws if prompt is missing", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout: JSON.stringify({ sessionID: "test-session-123" }) + "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "Hello",
        _execaOverride: mockExeca as any,
      });

      // @ts-expect-error Testing runtime behavior - no argument
      expect(() => result.resume()).toThrow();
      // Empty string should also throw
      expect(() => result.resume("")).toThrow();
    });

    test("resume uses captured sessionId and same adapter", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ sessionID: "captured-session-456" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "First message",
        _execaOverride: mockExeca as any,
      });

      expect(result.sessionId).toBe("captured-session-456");

      // Now call resume
      await result.resume("Follow-up question");

      // Should have made two calls
      expect(execaCalls.length).toBe(2);

      // Second call should include --session flag with captured ID
      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("--session");
      expect(resumeArgs).toContain("captured-session-456");
    });

    test("resume reuses original options", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ sessionID: "session-789" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "First",
        model: "gpt-4",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Second");

      expect(execaCalls[0]![2]?.cwd).toBe(cwd);
      expect(execaCalls[1]![2]?.cwd).toBe(cwd);
    });
  });
});

describe("Adapter session ID extraction", () => {
  let tempDir: string;
  let cwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "adapter-session-test-"));
    cwd = join(tempDir, "workspace");
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("OpenCode", () => {
    test("extracts sessionID from JSON output", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout:
            JSON.stringify({ sessionID: "opencode-session-abc" }) +
            "\n" +
            JSON.stringify({ type: "message", content: "Hello" }) +
            "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      expect(result.sessionId).toBe("opencode-session-abc");
    });

    test("uses --format json for initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ sessionID: "test" }) + "\n",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "opencode",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--format");
      expect(args).toContain("json");
    });

    test("resume uses --session and --format json", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ sessionID: "oc-resume-test" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "opencode",
        cwd,
        prompt: "First",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Second");

      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("--session");
      expect(resumeArgs).toContain("oc-resume-test");
      expect(resumeArgs).toContain("--format");
      expect(resumeArgs).toContain("json");
    });
  });

  describe("Codex", () => {
    test("extracts thread_id from thread.started event", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout:
            JSON.stringify({
              type: "thread.started",
              thread_id: "codex-thread-xyz",
            }) +
            "\n" +
            JSON.stringify({ type: "message", content: "Done" }) +
            "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "codex",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      expect(result.sessionId).toBe("codex-thread-xyz");
    });

    test("uses --json for initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout:
            JSON.stringify({ type: "thread.started", thread_id: "t1" }) + "\n",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "codex",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--json");
    });

    test("resume uses codex exec resume <id> format", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout:
            JSON.stringify({ type: "thread.started", thread_id: "cx-123" }) +
            "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "codex",
        cwd,
        prompt: "First",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Follow-up");

      // Resume should use: codex exec resume <id> "<prompt>" --json
      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("exec");
      expect(resumeArgs).toContain("resume");
      expect(resumeArgs).toContain("cx-123");
      expect(resumeArgs).toContain("--json");
    });
  });

  describe("Claude", () => {
    test("generates UUID for sessionId on initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout: "Response from Claude",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "claude",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      // Should be a UUID format
      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test("uses --session-id on initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: "OK",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "claude",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--session-id");
    });

    test("resume uses --resume flag", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: "OK",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "claude",
        cwd,
        prompt: "First",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Second");

      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("--resume");
      expect(resumeArgs).toContain(result.sessionId);
    });
  });

  describe("Gemini", () => {
    test("extracts session_id from init event", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout:
            JSON.stringify({ type: "init", session_id: "gemini-sess-001" }) +
            "\n" +
            JSON.stringify({ type: "response", text: "Hello" }) +
            "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "gemini",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      expect(result.sessionId).toBe("gemini-sess-001");
    });

    test("uses --output-format stream-json for initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout:
            JSON.stringify({ type: "init", session_id: "g1" }) + "\n",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "gemini",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
    });

    test("resume uses --resume and --output-format stream-json", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout:
            JSON.stringify({ type: "init", session_id: "gem-resume" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "gemini",
        cwd,
        prompt: "First",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Follow-up");

      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("--resume");
      expect(resumeArgs).toContain("gem-resume");
      expect(resumeArgs).toContain("--output-format");
      expect(resumeArgs).toContain("stream-json");
      expect(resumeArgs).toContain("--prompt");
    });
  });

  describe("Amp", () => {
    test("extracts session_id from stream json output", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const mockExeca = mock(() =>
        Promise.resolve({
          stdout:
            JSON.stringify({ type: "system", session_id: "T-abc123" }) +
            "\n" +
            JSON.stringify({ type: "result", session_id: "T-abc123" }) +
            "\n",
          exitCode: 0,
        })
      );

      const result = await callAgent({
        agent: "amp",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      expect(result.sessionId).toBe("T-abc123");
    });

    test("uses --execute and --stream-json for initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ type: "system", session_id: "T-init" }) + "\n",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "amp",
        cwd,
        prompt: "Test",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--execute");
      expect(args).toContain("--stream-json");
    });

    test("initial call uses --model when provided", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ type: "system", session_id: "T-model" }) + "\n",
          exitCode: 0,
        });
      });

      await callAgent({
        agent: "amp",
        cwd,
        prompt: "Test",
        model: "smart",
        _execaOverride: mockExeca as any,
      });

      const args = execaCalls[0]![1];
      expect(args).toContain("--model");
      expect(args).toContain("smart");
    });

    test("resume uses amp threads continue with --stream-json", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ type: "system", session_id: "T-resume" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "amp",
        cwd,
        prompt: "First",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Follow-up");

      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).toContain("threads");
      expect(resumeArgs).toContain("continue");
      expect(resumeArgs).toContain("--execute");
      expect(resumeArgs).toContain("--stream-json");
    });

    test("resume ignores model override from initial call", async () => {
      const { callAgent } = await import("../../src/lib/adapters/call.js");

      const execaCalls: any[] = [];
      const mockExeca = mock((...args: any[]) => {
        execaCalls.push(args);
        return Promise.resolve({
          stdout: JSON.stringify({ type: "system", session_id: "T-resume-model" }) + "\n",
          exitCode: 0,
        });
      });

      const result = await callAgent({
        agent: "amp",
        cwd,
        prompt: "First",
        model: "smart",
        _execaOverride: mockExeca as any,
      });

      await result.resume("Follow-up");

      const resumeArgs = execaCalls[1]![1];
      expect(resumeArgs).not.toContain("--model");
      expect(resumeArgs).not.toContain("smart");
    });
  });
});
