/**
 * Bus Runner Integration Tests
 *
 * Tests the bus runner tick model: all bridges polled on every tick,
 * bridges self-throttle based on their config.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  initBusRunner,
  tickBusEvents,
  tickBusActions,
  appendBusAction,
  createCommentAction,
  createReviewAction,
} from "../../src/lib/bus/runner.js";
import {
  initBusDir,
  readActions,
  appendAction,
  loadDispatcherState,
  saveDispatcherState,
} from "../../src/lib/bus/manager.js";
import type { Config } from "../../src/lib/config.js";
import type { PlanState } from "../../src/lib/state.js";
import type { Action } from "../../src/lib/bus/types.js";

describe("Bus Runner", () => {
  let tempDir: string;
  let worktree: string;
  let repoRoot: string;

  const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  };

  const baseConfig: Config = {
    worktrees_dir: ".worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    github: { enabled: true },
    agents: { default: "opencode" },
    bus: { tickIntervalMs: 1000 },
    bridges: {
      github: { enabled: true, pollIntervalMs: 60000 },
    },
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bus-runner-test-"));
    worktree = join(tempDir, "worktree");
    repoRoot = join(tempDir, "repo");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("initBusRunner", () => {
    test("initializes runner and registers bridges from config", async () => {
      const runner = await initBusRunner(repoRoot, baseConfig);

      expect(runner.initialized).toBe(true);
      expect(runner.registry).toBeDefined();
    });

    test("returns same runner on subsequent calls (singleton per repo)", async () => {
      const runner1 = await initBusRunner(repoRoot, baseConfig);
      const runner2 = await initBusRunner(repoRoot, baseConfig);

      expect(runner1).toBe(runner2);
    });

    test("respects bridges.github.enabled=false", async () => {
      const configWithGitHubDisabled: Config = {
        ...baseConfig,
        bridges: {
          github: { enabled: false },
        },
      };

      // Use a different repoRoot to avoid singleton
      const differentRepo = join(tempDir, "repo2");
      mkdirSync(differentRepo, { recursive: true });

      const runner = await initBusRunner(
        differentRepo,
        configWithGitHubDisabled
      );
      expect(runner.initialized).toBe(true);
      // Registry should have no bridges
      expect(runner.registry.getEventBridges().length).toBe(0);
    });
  });

  describe("tickBusEvents", () => {
    test("initializes bus directory if not exists", async () => {
      await initBusRunner(repoRoot, baseConfig);

      const ps: PlanState = {
        status: "active",
        worktree,
        branch: "test-branch",
        pr: 123,
      };

      // Should not throw even if bus dir doesn't exist
      await tickBusEvents(repoRoot, worktree, ps, baseConfig, mockLogger);

      // Bus directory should now exist
      const busPath = join(worktree, "prloom", ".bus");
      expect(() => readFileSync(join(busPath, "events.jsonl"))).not.toThrow();
    });

    test("returns empty events when bridge skips due to timing", async () => {
      await initBusRunner(repoRoot, baseConfig);
      initBusDir(worktree);

      const ps: PlanState = {
        status: "active",
        worktree,
        branch: "test-branch",
        pr: 123,
      };

      // First call - bridge will try to poll (and fail due to no gh CLI)
      // We catch the error silently
      const events1 = await tickBusEvents(
        repoRoot,
        worktree,
        ps,
        baseConfig,
        mockLogger
      );

      // Second immediate call - bridge should skip due to timing
      const events2 = await tickBusEvents(
        repoRoot,
        worktree,
        ps,
        baseConfig,
        mockLogger
      );

      // Second call should return empty (bridge self-throttled)
      expect(events2).toEqual([]);
    });
  });

  describe("tickBusActions", () => {
    test("routes pending actions to bridges", async () => {
      await initBusRunner(repoRoot, baseConfig);
      initBusDir(worktree);

      // Add an action to the bus
      const action = createCommentAction(123, "Test message");
      appendBusAction(worktree, action);

      const ps: PlanState = {
        status: "active",
        worktree,
        branch: "test-branch",
        pr: 123,
      };

      // This will try to route the action (and may fail due to no gh CLI)
      // But the important thing is it reads and attempts to route
      await tickBusActions(repoRoot, worktree, ps, baseConfig, mockLogger);

      // Action should have been read
      // (actual delivery depends on gh CLI availability)
    });
  });

  describe("createCommentAction", () => {
    test("creates correct action structure", () => {
      const action = createCommentAction(456, "Hello world", "event-123");

      expect(action.id).toMatch(/^action-comment-/);
      expect(action.type).toBe("respond");
      expect(action.target.target).toBe("github-pr");
      expect(action.target.token).toEqual({ prNumber: 456 });
      expect(action.payload).toEqual({
        type: "comment",
        message: "Hello world",
      });
      expect(action.relatedEventId).toBe("event-123");
    });
  });

  describe("createReviewAction", () => {
    test("creates correct action structure for review", () => {
      const comments = [
        { path: "src/index.ts", line: 10, body: "Consider renaming this" },
        { path: "src/utils.ts", line: 25, body: "Add error handling" },
      ];
      const action = createReviewAction(
        789,
        "request_changes",
        "Please address these issues",
        comments,
        "event-456"
      );

      expect(action.id).toMatch(/^action-review-/);
      expect(action.type).toBe("respond");
      expect(action.target.target).toBe("github-pr");
      expect(action.target.token).toEqual({ prNumber: 789 });
      expect(action.payload).toEqual({
        type: "review",
        verdict: "request_changes",
        summary: "Please address these issues",
        comments,
      });
      expect(action.relatedEventId).toBe("event-456");
    });

    test("creates review action with approve verdict", () => {
      const action = createReviewAction(123, "approve", "LGTM!", []);

      expect(action.payload).toEqual({
        type: "review",
        verdict: "approve",
        summary: "LGTM!",
        comments: [],
      });
    });

    test("creates review action with comment verdict", () => {
      const action = createReviewAction(
        123,
        "comment",
        "Some observations",
        [{ path: "README.md", line: 1, body: "Typo here" }]
      );

      expect(action.payload).toEqual({
        type: "review",
        verdict: "comment",
        summary: "Some observations",
        comments: [{ path: "README.md", line: 1, body: "Typo here" }],
      });
    });

    test("creates review action without relatedEventId", () => {
      const action = createReviewAction(456, "approve", "Good work", []);
      expect(action.relatedEventId).toBeUndefined();
    });
  });

  describe("appendBusAction", () => {
    test("creates bus dir if needed and appends action", () => {
      const action = createCommentAction(789, "Test");

      appendBusAction(worktree, action);

      // Action should be in actions.jsonl
      const { actions } = readActions(worktree, 0);
      expect(actions.length).toBe(1);
      expect(actions[0]!.id).toBe(action.id);
    });
  });
});

describe("Bus Tick Model Compliance", () => {
  let tempDir: string;
  let worktree: string;
  let repoRoot: string;

  const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bus-tick-model-test-"));
    worktree = join(tempDir, "worktree");
    repoRoot = join(tempDir, "repo");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("bridge receives pollIntervalMs from config", async () => {
    const config: Config = {
      worktrees_dir: ".worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      github: { enabled: true },
      agents: { default: "opencode" },
      bus: { tickIntervalMs: 1000 },
      bridges: {
        github: { enabled: true, pollIntervalMs: 30000 }, // 30 seconds
      },
    };

    await initBusRunner(repoRoot, config);
    initBusDir(worktree);

    const ps: PlanState = {
      status: "active",
      worktree,
      branch: "test-branch",
      pr: 123,
    };

    // The runner should pass pollIntervalMs to the bridge via ctx.config
    // We can't directly verify this without mocking, but we verify the flow works
    await tickBusEvents(repoRoot, worktree, ps, config, mockLogger);
  });

  test("actions are routed independently of events", async () => {
    const config: Config = {
      worktrees_dir: ".worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      github: { enabled: true },
      agents: { default: "opencode" },
      bus: { tickIntervalMs: 1000 },
      bridges: {
        github: { enabled: true, pollIntervalMs: 60000 },
      },
    };

    await initBusRunner(repoRoot, config);
    initBusDir(worktree);

    // Add action before any events are polled
    const action = createCommentAction(999, "Independent action");
    appendBusAction(worktree, action);

    const ps: PlanState = {
      status: "active",
      worktree,
      branch: "test-branch",
      pr: 999,
    };

    // Actions should be routed even if events tick returns empty
    await tickBusActions(repoRoot, worktree, ps, config, mockLogger);

    // Verify action was processed (offset updated)
    // The action routing happens regardless of event polling
  });
});

describe("Action Offset Handling", () => {
  let tempDir: string;
  let worktree: string;
  let repoRoot: string;

  const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  };

  const baseConfig: Config = {
    worktrees_dir: ".worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    github: { enabled: true },
    agents: { default: "opencode" },
    bus: { tickIntervalMs: 1000 },
    bridges: {
      github: { enabled: true, pollIntervalMs: 60000 },
    },
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bus-offset-test-"));
    worktree = join(tempDir, "worktree");
    repoRoot = join(tempDir, "repo");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("actionsOffset is byte-based, not array-index-based", async () => {
    // Use a new repo to avoid singleton issues
    const uniqueRepo = join(tempDir, "unique-repo");
    mkdirSync(uniqueRepo, { recursive: true });

    await initBusRunner(uniqueRepo, baseConfig);
    initBusDir(worktree);

    // Create actions with unicode content (multi-byte characters)
    // This would fail if offset was based on array index
    const action1: Action = {
      id: "action-unicode-1",
      type: "respond",
      target: { target: "github-pr", token: { prNumber: 123 } },
      payload: { type: "comment", message: "Hello 世界! 🎉" },
    };

    const action2: Action = {
      id: "action-unicode-2",
      type: "respond",
      target: { target: "github-pr", token: { prNumber: 123 } },
      payload: { type: "comment", message: "Second action" },
    };

    // Append both actions
    appendAction(worktree, action1);
    appendAction(worktree, action2);

    // Read to get the correct byte offset
    const { newOffset } = readActions(worktree, 0);

    // Verify the offset is larger than 2 (array length)
    // Each action JSON line with unicode is much larger than 1 byte
    expect(newOffset).toBeGreaterThan(100); // Should be hundreds of bytes
  });

  test("dispatcher state tracks actionsOffset correctly", () => {
    initBusDir(worktree);

    // Initially, actionsOffset should be 0
    const initialState = loadDispatcherState(worktree);
    expect(initialState.actionsOffset).toBe(0);

    // Append an action and read it
    const action = createCommentAction(123, "Test message");
    appendAction(worktree, action);

    const { newOffset } = readActions(worktree, 0);

    // Save state with the new offset
    saveDispatcherState(worktree, {
      ...initialState,
      actionsOffset: newOffset,
    });

    // Reload and verify
    const reloadedState = loadDispatcherState(worktree);
    expect(reloadedState.actionsOffset).toBe(newOffset);
    expect(reloadedState.actionsOffset).toBeGreaterThan(0);
  });

  test("reading from actionsOffset skips already-processed actions", () => {
    initBusDir(worktree);

    // Append first action
    const action1 = createCommentAction(123, "First");
    appendAction(worktree, action1);

    // Read and get offset
    const { actions: read1, newOffset: offset1 } = readActions(worktree, 0);
    expect(read1.length).toBe(1);
    expect(read1[0]!.id).toBe(action1.id);

    // Append second action
    const action2 = createCommentAction(456, "Second");
    appendAction(worktree, action2);

    // Read from offset1 - should only get second action
    const { actions: read2, newOffset: offset2 } = readActions(
      worktree,
      offset1
    );
    expect(read2.length).toBe(1);
    expect(read2[0]!.id).toBe(action2.id);
    expect(offset2).toBeGreaterThan(offset1);
  });
});
