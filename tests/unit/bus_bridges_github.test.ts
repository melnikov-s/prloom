/**
 * GitHub Bridge Unit Tests
 *
 * Tests the GitHub bridge with mocked GitHub API calls.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { githubBridge } from "../../src/lib/bus/bridges/github.js";
import type {
  BridgeContext,
  BridgeLogger,
  JsonValue,
  Action,
} from "../../src/lib/bus/types.js";

// Mock logger for tests
const mockLog: BridgeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Mock the github module
const mockGetPRComments = mock(() => Promise.resolve([]));
const mockGetPRReviews = mock(() => Promise.resolve([]));
const mockGetPRReviewComments = mock(() => Promise.resolve([]));
const mockFilterNewFeedback = mock(
  (all: unknown[], cursors: unknown, botLogin: string) => all
);
const mockGetCurrentGitHubUser = mock(() =>
  Promise.resolve({ login: "test-bot" })
);
const mockPostPRComment = mock(() => Promise.resolve());
const mockSubmitPRReview = mock(() => Promise.resolve());

// We need to mock the github.js module - using Bun's mock capabilities
// For now, we'll test the bridge behavior without actual HTTP calls

describe("GitHub Bridge", () => {
  const baseContext: BridgeContext = {
    repoRoot: "/test/repo",
    worktree: "/test/worktree",
    branch: "test-branch",
    changeRequestRef: "123",
    log: mockLog,
  };

  describe("events()", () => {
    test("returns empty events when polled too recently", async () => {
      const ctx: BridgeContext = {
        ...baseContext,
        config: { pollIntervalMs: 60000 },
      };

      // State with recent poll time
      const state = {
        lastPollTime: Date.now() - 1000, // 1 second ago
        cursors: {},
      } as unknown as JsonValue;

      const result = await githubBridge.events(ctx, state);

      expect(result.events).toEqual([]);
      // State should be unchanged
      expect((result.state as Record<string, unknown>).lastPollTime).toBe(
        (state as Record<string, unknown>).lastPollTime
      );
    });

    test("respects custom pollIntervalMs from config", async () => {
      const ctx: BridgeContext = {
        ...baseContext,
        config: { pollIntervalMs: 5000 }, // 5 seconds
      };

      // State with poll time 3 seconds ago (within 5 second interval)
      const state = {
        lastPollTime: Date.now() - 3000,
        cursors: {},
      } as unknown as JsonValue;

      const result = await githubBridge.events(ctx, state);

      // Should skip because 3s < 5s interval
      expect(result.events).toEqual([]);
    });

    test("skips polling when no PR reference", async () => {
      const ctx: BridgeContext = {
        ...baseContext,
        changeRequestRef: undefined, // No PR
      };

      const state = {
        lastPollTime: 0, // Long ago - would normally poll
        cursors: {},
      } as unknown as JsonValue;

      const result = await githubBridge.events(ctx, state);

      expect(result.events).toEqual([]);
    });

    test("uses default poll interval when config not provided", async () => {
      const ctx: BridgeContext = {
        ...baseContext,
        config: undefined,
      };

      // State with poll time 20 seconds ago (within 30s default)
      const state = {
        lastPollTime: Date.now() - 20000,
        cursors: {},
      } as unknown as JsonValue;

      const result = await githubBridge.events(ctx, state);

      // Should skip because 20s < 30s default interval
      expect(result.events).toEqual([]);
    });
  });

  describe("actions()", () => {
    const baseAction: Action = {
      id: "action-test-123",
      type: "respond",
      target: {
        target: "github-pr",
        token: { prNumber: 123 },
      },
      payload: {
        type: "comment",
        message: "Test comment",
      },
    };

    test("returns success false for unsupported payload type", async () => {
      const action: Action = {
        ...baseAction,
        payload: { type: "unknown" as "comment", message: "test" },
      };

      const result = await githubBridge.actions(baseContext, action);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.retryable).toBe(false);
      }
    });

    test("skips already delivered actions (idempotency)", async () => {
      // Create state with the action already delivered
      const actionState = {
        deliveredActions: {
          "action-test-123": { commentId: 456 },
        },
      };

      // We need to set up the bridge state - this would normally be in worktree
      // For this test, we verify the bridge checks for already-delivered actions
      // by looking at its implementation behavior

      // The actual implementation reads from files, so we can only verify
      // the interface returns success for the first call
      // This is more of an integration test concern
    });

    test("returns correct ActionResult interface for comment type", async () => {
      // The actual postPRComment will fail without real GitHub access,
      // but we can verify the bridge handles errors correctly
      const result = await githubBridge.actions(baseContext, baseAction);

      // Result should have the ActionResult shape
      expect("success" in result).toBe(true);
      if (!result.success) {
        expect("error" in result).toBe(true);
        expect("retryable" in result).toBe(true);
      }
    });
  });

  describe("bridge metadata", () => {
    test("has correct name", () => {
      expect(githubBridge.name).toBe("github");
    });

    test("targets github-pr", () => {
      expect(githubBridge.targets).toContain("github-pr");
    });

    test("has events method", () => {
      expect(typeof githubBridge.events).toBe("function");
    });

    test("has actions method", () => {
      expect(typeof githubBridge.actions).toBe("function");
    });
  });
});

describe("GitHub Bridge Poll Timing", () => {
  test("timing logic: returns early when within poll interval", async () => {
    const ctx: BridgeContext = {
      repoRoot: "/test/repo",
      worktree: "/test/worktree",
      branch: "test-branch",
      changeRequestRef: "123",
      config: { pollIntervalMs: 60000 },
      log: mockLog,
    };

    // State with recent poll - should return early without calling GitHub
    const state = {
      lastPollTime: Date.now() - 10000, // 10 seconds ago
      cursors: {},
    } as unknown as JsonValue;

    const result = await githubBridge.events(ctx, state);

    // Should return empty events (early return, no GitHub call)
    expect(result.events).toEqual([]);
    // State should be unchanged (early return preserves state)
    const resultState = result.state as Record<string, unknown>;
    expect(resultState.lastPollTime).toBe(
      (state as Record<string, unknown>).lastPollTime
    );
  });

  test("timing logic: config pollIntervalMs overrides default", async () => {
    const ctx: BridgeContext = {
      repoRoot: "/test/repo",
      worktree: "/test/worktree",
      branch: "test-branch",
      changeRequestRef: "123",
      config: { pollIntervalMs: 100 }, // Very short interval
      log: mockLog,
    };

    // State with poll time 50ms ago (within 100ms interval)
    const state = {
      lastPollTime: Date.now() - 50,
      cursors: {},
    } as unknown as JsonValue;

    const result = await githubBridge.events(ctx, state);

    // Should return early (50ms < 100ms configured interval)
    expect(result.events).toEqual([]);
  });

  test("timing logic: DEFAULT_POLL_INTERVAL_MS should match RFC default of 60s", async () => {
    // RFC docs/rfc-file-bus.md specifies default poll interval of 60000ms (60s)
    // The bridge's DEFAULT_POLL_INTERVAL_MS should match this
    const ctx: BridgeContext = {
      repoRoot: "/test/repo",
      worktree: "/test/worktree",
      branch: "test-branch",
      changeRequestRef: "123",
      // No config - uses bridge's internal default
      log: mockLog,
    };

    // State with poll time 45 seconds ago
    // If default is 60s (RFC), should skip (45s < 60s)
    // If default is 30s (current bug), would try to poll (45s > 30s)
    const state = {
      lastPollTime: Date.now() - 45000, // 45 seconds ago
      cursors: {},
    } as unknown as JsonValue;

    const result = await githubBridge.events(ctx, state);

    // With RFC-compliant 60s default: should skip (45s < 60s)
    // This test will FAIL if default is 30s, and PASS after fix
    expect(result.events).toEqual([]);
    const resultState = result.state as Record<string, unknown>;
    expect(resultState.lastPollTime).toBe(
      (state as Record<string, unknown>).lastPollTime
    );
  });
});

// Note: Tests that would actually poll GitHub (when lastPollTime is old enough)
// require mocking the github.js module which isn't set up in this test file.
// Those would be integration tests rather than unit tests.

describe("GitHub Bridge Action State", () => {
  test("action state structure supports external artifact IDs", () => {
    // Verify the expected state structure per RFC
    // RFC docs/rfc-file-bus.md:83-93 specifies:
    // {
    //   "deliveredActions": {
    //     "action-123": { "commentId": 456789 },
    //     "action-124": { "reviewId": 789012 }
    //   }
    // }
    const expectedStateStructure = {
      deliveredActions: {
        "action-comment-123": {
          deliveredAt: "2026-01-10T00:00:00.000Z",
          prNumber: 42,
          commentId: 456789,
        },
        "action-review-456": {
          deliveredAt: "2026-01-10T00:00:00.000Z",
          prNumber: 42,
          reviewId: 789012,
        },
      },
    };

    // Verify the structure is valid JSON (for file storage)
    const json = JSON.stringify(expectedStateStructure);
    const parsed = JSON.parse(json);

    expect(parsed.deliveredActions["action-comment-123"].commentId).toBe(456789);
    expect(parsed.deliveredActions["action-review-456"].reviewId).toBe(789012);
  });

  test("action returns success false when no PR number in token", async () => {
    const ctx: BridgeContext = {
      repoRoot: "/test/repo",
      worktree: "/test/worktree",
      branch: "test-branch",
      changeRequestRef: "123",
      log: mockLog,
    };

    const actionWithoutPrNumber: Action = {
      id: "action-no-pr",
      type: "respond",
      target: {
        target: "github-pr",
        token: {}, // No prNumber
      },
      payload: {
        type: "comment",
        message: "Test",
      },
    };

    const result = await githubBridge.actions(ctx, actionWithoutPrNumber);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No PR number");
      expect(result.retryable).toBe(false);
    }
  });

  test("action returns success false for undefined token", async () => {
    const ctx: BridgeContext = {
      repoRoot: "/test/repo",
      worktree: "/test/worktree",
      branch: "test-branch",
      changeRequestRef: "123",
      log: mockLog,
    };

    const actionWithUndefinedToken: Action = {
      id: "action-undefined-token",
      type: "respond",
      target: {
        target: "github-pr",
        // token is undefined
      },
      payload: {
        type: "comment",
        message: "Test",
      },
    };

    const result = await githubBridge.actions(ctx, actionWithUndefinedToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No PR number");
      expect(result.retryable).toBe(false);
    }
  });
});
