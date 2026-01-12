/**
 * Plugin Bridge Primitives Tests
 *
 * Tests for RFC: docs/rfc-plugin-bridge-primitives.md
 * Following TDD - tests written before implementation.
 *
 * Tests cover:
 * - beforeTriage hook point and event interception
 * - Plugin state store (per-plan)
 * - Global plugin state store
 * - readEvents helper
 * - Action helpers (emitComment, emitReview, emitMerge)
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { join } from "path";

import type {
  HookPoint,
  HookContext,
  Hook,
  HookRegistry,
  BeforeTriageContext,
} from "../../src/lib/hooks/types.js";
import { loadPlugins } from "../../src/lib/hooks/loader.js";
import { runHooks, buildHookContext, buildBeforeTriageContext } from "../../src/lib/hooks/runner.js";
import {
  loadPluginState,
  savePluginState,
  loadGlobalPluginState,
  saveGlobalPluginState,
} from "../../src/lib/hooks/state.js";
import type { Event, Action, ReplyAddress } from "../../src/lib/bus/types.js";
import type { Config } from "../../src/lib/config.js";

const TEST_DIR = "/tmp/prloom-test-plugin-primitives";
const TEST_PLUGINS_DIR = join(TEST_DIR, "plugins");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_PLUGINS_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "prloom"), { recursive: true });
  mkdirSync(join(TEST_DIR, "prloom", ".local"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Helper: Create a minimal config
function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: { default: "opencode" },
    github: { enabled: true },
    worktrees_dir: "prloom/.local/worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    bus: { tickIntervalMs: 1000 },
    bridges: { github: { enabled: true } },
    ...overrides,
  };
}

// Helper: Write a test plugin to disk
function writeTestPlugin(name: string, code: string): string {
  const pluginPath = join(TEST_PLUGINS_DIR, `${name}.js`);
  writeFileSync(pluginPath, code);
  return pluginPath;
}

// Helper: Create test events
function createTestEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: "github",
    type: "pr_comment",
    severity: "info",
    title: "Test Comment",
    body: "This is a test comment",
    replyTo: { target: "github-pr", token: { prNumber: 123 } },
    ...overrides,
  };
}

// =============================================================================
// beforeTriage Hook Point Tests
// =============================================================================

describe("beforeTriage hook point", () => {
  test("HookPoint type includes beforeTriage", async () => {
    // This is a compile-time check, but we verify it loads correctly
    const hookPoint: HookPoint = "beforeTriage";
    expect(hookPoint).toBe("beforeTriage");
  });

  test("loadPlugins loads beforeTriage hooks", async () => {
    const pluginPath = writeTestPlugin(
      "before-triage-plugin",
      `
module.exports = function(config) {
  return {
    beforeTriage: async (plan, ctx) => {
      return plan;
    }
  };
};
`
    );

    const config = createConfig({
      plugins: {
        "before-triage-plugin": { module: pluginPath },
      },
    });

    const registry = await loadPlugins(config, TEST_DIR);

    expect(registry.beforeTriage).toBeDefined();
    expect(registry.beforeTriage!.length).toBe(1);
  });

  test("beforeTriage hook receives events in context", async () => {
    let receivedEvents: Event[] | undefined;

    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [
      createTestEvent({ id: "event-1", body: "First comment" }),
      createTestEvent({ id: "event-2", body: "Second comment" }),
    ];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
    });

    expect(ctx.events).toBeDefined();
    expect(ctx.events!.length).toBe(2);
    expect(ctx.events![0]!.id).toBe("event-1");
    expect(ctx.events![1]!.id).toBe("event-2");
  });
});

// =============================================================================
// Event Interception Tests
// =============================================================================

describe("event interception", () => {
  test("markEventHandled marks event as handled", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [
      createTestEvent({ id: "event-1" }),
      createTestEvent({ id: "event-2" }),
    ];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
    });

    // Mark first event as handled
    ctx.markEventHandled!("event-1");

    // Check handled events
    const handledIds = ctx.getHandledEventIds!();
    expect(handledIds).toContain("event-1");
    expect(handledIds).not.toContain("event-2");
  });

  test("markEventDeferred marks event as deferred with reason", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [createTestEvent({ id: "event-1" })];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
    });

    // Defer event with reason
    ctx.markEventDeferred!("event-1", "rate-limit-exceeded");

    const deferredIds = ctx.getDeferredEventIds!();
    expect(deferredIds).toContain("event-1");
  });

  test("markEventDeferred supports retryAfterMs backoff", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [createTestEvent({ id: "event-1" })];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
    });

    const now = Date.now();
    ctx.markEventDeferred!("event-1", "rate-limit", 60000);

    const deferredInfo = ctx.getDeferredEventInfo!("event-1");
    expect(deferredInfo).toBeDefined();
    expect(deferredInfo!.reason).toBe("rate-limit");
    expect(deferredInfo!.deferredUntil).toBeGreaterThanOrEqual(now + 60000);
  });

  test("unmarked events are passed to triage", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [
      createTestEvent({ id: "event-1" }),
      createTestEvent({ id: "event-2" }),
      createTestEvent({ id: "event-3" }),
    ];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
    });

    // Mark some as handled/deferred
    ctx.markEventHandled!("event-1");
    ctx.markEventDeferred!("event-2", "pending");

    // Get events for triage (should only include unmarked)
    const eventsForTriage = ctx.getEventsForTriage!();
    expect(eventsForTriage.length).toBe(1);
    expect(eventsForTriage[0]!.id).toBe("event-3");
  });
});

// =============================================================================
// Plugin State Store Tests (Per-Plan)
// =============================================================================

describe("plugin state store (per-plan)", () => {
  test("setState saves state to plugin-state directory", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    savePluginState(worktree, "my-plugin", "lastCursor", "abc123");

    const statePath = join(
      worktree,
      "prloom",
      ".local",
      "plugin-state",
      "my-plugin.json"
    );
    expect(existsSync(statePath)).toBe(true);

    const content = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(content.lastCursor).toBe("abc123");
  });

  test("getState retrieves previously saved state", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    savePluginState(worktree, "my-plugin", "counter", 42);
    savePluginState(worktree, "my-plugin", "enabled", true);

    const counter = loadPluginState(worktree, "my-plugin", "counter");
    const enabled = loadPluginState(worktree, "my-plugin", "enabled");

    expect(counter).toBe(42);
    expect(enabled).toBe(true);
  });

  test("getState returns undefined for non-existent key", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const value = loadPluginState(worktree, "my-plugin", "nonexistent");
    expect(value).toBeUndefined();
  });

  test("setState supports complex JSON values", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const complexValue = {
      nested: { key: "value" },
      array: [1, 2, 3],
      nullValue: null,
    };

    savePluginState(worktree, "my-plugin", "complex", complexValue);
    const retrieved = loadPluginState(worktree, "my-plugin", "complex");

    expect(retrieved).toEqual(complexValue);
  });

  test("HookContext includes getState and setState", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    expect(ctx.getState).toBeDefined();
    expect(ctx.setState).toBeDefined();

    // Test using context methods
    ctx.setState!("myKey", "myValue");
    const value = ctx.getState!("myKey");
    expect(value).toBe("myValue");
  });

  test("plugin state persists across restarts", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    // First "session"
    savePluginState(worktree, "persistent-plugin", "cursor", "page-5");

    // Simulate restart - load fresh
    const cursor = loadPluginState(worktree, "persistent-plugin", "cursor");
    expect(cursor).toBe("page-5");
  });
});

// =============================================================================
// Global Plugin State Store Tests
// =============================================================================

describe("global plugin state store", () => {
  test("setGlobalState saves to repo-level plugin-state-global", () => {
    const repoRoot = TEST_DIR;

    saveGlobalPluginState(repoRoot, "rate-limiter", "requestCount", 100);

    const statePath = join(
      repoRoot,
      "prloom",
      ".local",
      "plugin-state-global",
      "rate-limiter.json"
    );
    expect(existsSync(statePath)).toBe(true);

    const content = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(content.requestCount).toBe(100);
  });

  test("getGlobalState retrieves repo-level state", () => {
    const repoRoot = TEST_DIR;

    saveGlobalPluginState(repoRoot, "reviewer-rotation", "currentIndex", 3);
    saveGlobalPluginState(repoRoot, "reviewer-rotation", "reviewers", [
      "alice",
      "bob",
    ]);

    const currentIndex = loadGlobalPluginState(
      repoRoot,
      "reviewer-rotation",
      "currentIndex"
    );
    const reviewers = loadGlobalPluginState(
      repoRoot,
      "reviewer-rotation",
      "reviewers"
    );

    expect(currentIndex).toBe(3);
    expect(reviewers).toEqual(["alice", "bob"]);
  });

  test("global state is shared across plans", () => {
    const repoRoot = TEST_DIR;
    const worktree1 = join(TEST_DIR, "worktree1");
    const worktree2 = join(TEST_DIR, "worktree2");
    mkdirSync(join(worktree1, "prloom", ".local"), { recursive: true });
    mkdirSync(join(worktree2, "prloom", ".local"), { recursive: true });

    // Set global state
    saveGlobalPluginState(repoRoot, "shared-plugin", "globalCounter", 1);

    // Both worktrees should see the same global state
    const ctx1 = buildBeforeTriageContext({
      repoRoot,
      worktree: worktree1,
      planId: "plan-1",
      events: [],
      pluginName: "shared-plugin",
    });

    const ctx2 = buildBeforeTriageContext({
      repoRoot,
      worktree: worktree2,
      planId: "plan-2",
      events: [],
      pluginName: "shared-plugin",
    });

    expect(ctx1.getGlobalState!("globalCounter")).toBe(1);
    expect(ctx2.getGlobalState!("globalCounter")).toBe(1);
  });

  test("HookContext includes getGlobalState and setGlobalState", async () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    expect(ctx.getGlobalState).toBeDefined();
    expect(ctx.setGlobalState).toBeDefined();
  });
});

// =============================================================================
// readEvents Helper Tests
// =============================================================================

describe("readEvents helper", () => {
  test("readEvents returns events from bus", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus");
    mkdirSync(busDir, { recursive: true });

    // Write events to events.jsonl
    const events = [
      createTestEvent({ id: "event-1", type: "pr_comment" }),
      createTestEvent({ id: "event-2", type: "pr_review" }),
    ];

    const lines = events.map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "event",
        schemaVersion: 1,
        data: e,
      })
    );
    writeFileSync(join(busDir, "events.jsonl"), lines.join("\n") + "\n");

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const result = await ctx.readEvents!({});
    expect(result.events.length).toBe(2);
  });

  test("readEvents filters by event types", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus");
    mkdirSync(busDir, { recursive: true });

    const events = [
      createTestEvent({ id: "event-1", type: "pr_comment" }),
      createTestEvent({ id: "event-2", type: "pr_review" }),
      createTestEvent({ id: "event-3", type: "pr_comment" }),
    ];

    const lines = events.map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "event",
        schemaVersion: 1,
        data: e,
      })
    );
    writeFileSync(join(busDir, "events.jsonl"), lines.join("\n") + "\n");

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const result = await ctx.readEvents!({ types: ["pr_comment"] });
    expect(result.events.length).toBe(2);
    expect(result.events.every((e) => e.type === "pr_comment")).toBe(true);
  });

  test("readEvents supports sinceId cursor", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus");
    mkdirSync(busDir, { recursive: true });

    const events = [
      createTestEvent({ id: "event-1" }),
      createTestEvent({ id: "event-2" }),
      createTestEvent({ id: "event-3" }),
    ];

    const lines = events.map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "event",
        schemaVersion: 1,
        data: e,
      })
    );
    writeFileSync(join(busDir, "events.jsonl"), lines.join("\n") + "\n");

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const result = await ctx.readEvents!({ sinceId: "event-1" });
    expect(result.events.length).toBe(2);
    expect(result.events[0]!.id).toBe("event-2");
  });

  test("readEvents supports limit parameter", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus");
    mkdirSync(busDir, { recursive: true });

    const events = [
      createTestEvent({ id: "event-1" }),
      createTestEvent({ id: "event-2" }),
      createTestEvent({ id: "event-3" }),
      createTestEvent({ id: "event-4" }),
    ];

    const lines = events.map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "event",
        schemaVersion: 1,
        data: e,
      })
    );
    writeFileSync(join(busDir, "events.jsonl"), lines.join("\n") + "\n");

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const result = await ctx.readEvents!({ limit: 2 });
    expect(result.events.length).toBe(2);
    expect(result.lastId).toBe("event-2");
  });

  test("readEvents returns lastId for cursor tracking", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus");
    mkdirSync(busDir, { recursive: true });

    const events = [
      createTestEvent({ id: "event-1" }),
      createTestEvent({ id: "event-2" }),
    ];

    const lines = events.map((e) =>
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "event",
        schemaVersion: 1,
        data: e,
      })
    );
    writeFileSync(join(busDir, "events.jsonl"), lines.join("\n") + "\n");

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const result = await ctx.readEvents!({});
    expect(result.lastId).toBe("event-2");
  });
});

// =============================================================================
// Action Helpers Tests
// =============================================================================

describe("action helpers", () => {
  test("emitComment creates comment action", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const target: ReplyAddress = { target: "github-pr", token: { prNumber: 123 } };
    ctx.emitComment!(target, "Hello from plugin!");

    // Verify action was written
    const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
    expect(existsSync(actionsPath)).toBe(true);

    const content = readFileSync(actionsPath, "utf-8");
    expect(content).toContain("Hello from plugin!");
    expect(content).toContain('"type":"comment"');
  });

  test("emitReview creates review action", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const target: ReplyAddress = { target: "github-pr", token: { prNumber: 456 } };
    ctx.emitReview!(target, {
      verdict: "approve",
      summary: "LGTM!",
      comments: [],
    });

    const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
    const content = readFileSync(actionsPath, "utf-8");
    expect(content).toContain('"type":"review"');
    expect(content).toContain('"verdict":"approve"');
    expect(content).toContain("LGTM!");
  });

  test("emitMerge creates merge action with default method", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const target: ReplyAddress = { target: "github-pr", token: { prNumber: 789 } };
    ctx.emitMerge!(target);

    const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
    const content = readFileSync(actionsPath, "utf-8");
    expect(content).toContain('"type":"merge"');
  });

  test("emitMerge supports squash method", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const target: ReplyAddress = { target: "github-pr", token: { prNumber: 789 } };
    ctx.emitMerge!(target, "squash");

    const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
    const content = readFileSync(actionsPath, "utf-8");
    expect(content).toContain('"method":"squash"');
  });

  test("action helpers generate unique IDs", () => {
    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [],
      pluginName: "test-plugin",
    });

    const target: ReplyAddress = { target: "github-pr", token: { prNumber: 123 } };
    ctx.emitComment!(target, "First");
    ctx.emitComment!(target, "Second");

    const actionsPath = join(worktree, "prloom", ".local", "bus", "actions.jsonl");
    const lines = readFileSync(actionsPath, "utf-8").trim().split("\n");
    const ids = lines.map((l) => JSON.parse(l).data.id);

    // IDs should be unique
    expect(new Set(ids).size).toBe(2);
  });
});

// =============================================================================
// Integration Tests: Plugin with beforeTriage
// =============================================================================

describe("beforeTriage plugin integration", () => {
  test("plugin can intercept and handle events", async () => {
    const handledEvents: string[] = [];

    const pluginPath = writeTestPlugin(
      "intercept-plugin",
      `
module.exports = function(config) {
  return {
    beforeTriage: async (plan, ctx) => {
      if (!ctx.events) return plan;
      
      for (const event of ctx.events) {
        if (event.body.includes("!memory")) {
          ctx.markEventHandled(event.id);
        }
      }
      
      return plan;
    }
  };
};
`
    );

    const config = createConfig({
      plugins: {
        "intercept-plugin": { module: pluginPath },
      },
    });

    const registry = await loadPlugins(config, TEST_DIR);

    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [
      createTestEvent({ id: "event-1", body: "Normal comment" }),
      createTestEvent({ id: "event-2", body: "!memory update policy" }),
      createTestEvent({ id: "event-3", body: "Another comment" }),
    ];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
      pluginName: "intercept-plugin",
    });

    // Run beforeTriage hooks
    await runHooks("beforeTriage", "# Test Plan", ctx, registry);

    // event-2 should be handled (has !memory)
    const eventsForTriage = ctx.getEventsForTriage!();
    expect(eventsForTriage.length).toBe(2);
    expect(eventsForTriage.map((e) => e.id)).not.toContain("event-2");
  });

  test("plugin can defer events with backoff", async () => {
    const pluginPath = writeTestPlugin(
      "defer-plugin",
      `
module.exports = function(config) {
  return {
    beforeTriage: async (plan, ctx) => {
      if (!ctx.events) return plan;
      
      for (const event of ctx.events) {
        if (event.body.includes("rate-limited")) {
          ctx.markEventDeferred(event.id, "rate-limit", 60000);
        }
      }
      
      return plan;
    }
  };
};
`
    );

    const config = createConfig({
      plugins: {
        "defer-plugin": { module: pluginPath },
      },
    });

    const registry = await loadPlugins(config, TEST_DIR);

    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    const events: Event[] = [
      createTestEvent({ id: "event-1", body: "rate-limited request" }),
    ];

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events,
      pluginName: "defer-plugin",
    });

    await runHooks("beforeTriage", "# Test Plan", ctx, registry);

    const deferredInfo = ctx.getDeferredEventInfo!("event-1");
    expect(deferredInfo).toBeDefined();
    expect(deferredInfo!.reason).toBe("rate-limit");
  });

  test("plugin can use state to track across invocations", async () => {
    const pluginPath = writeTestPlugin(
      "stateful-plugin",
      `
module.exports = function(config) {
  return {
    beforeTriage: async (plan, ctx) => {
      // Get current count
      const count = ctx.getState("processedCount") || 0;
      
      // Process events
      for (const event of ctx.events || []) {
        ctx.markEventHandled(event.id);
      }
      
      // Update count
      ctx.setState("processedCount", count + (ctx.events?.length || 0));
      
      return plan;
    }
  };
};
`
    );

    const config = createConfig({
      plugins: {
        "stateful-plugin": { module: pluginPath },
      },
    });

    const registry = await loadPlugins(config, TEST_DIR);

    const worktree = join(TEST_DIR, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });

    // First invocation
    const ctx1 = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [createTestEvent({ id: "e1" }), createTestEvent({ id: "e2" })],
      pluginName: "stateful-plugin",
    });

    await runHooks("beforeTriage", "# Plan", ctx1, registry);

    // Second invocation
    const ctx2 = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [createTestEvent({ id: "e3" })],
      pluginName: "stateful-plugin",
    });

    await runHooks("beforeTriage", "# Plan", ctx2, registry);

    // Check total count
    const count = loadPluginState(worktree, "stateful-plugin", "processedCount");
    expect(count).toBe(3);
  });
});

// =============================================================================
// Dispatcher State Integration Tests
// =============================================================================

describe("dispatcher state with deferred events", () => {
  test("deferred events are tracked in dispatcher state", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus", "state");
    mkdirSync(busDir, { recursive: true });

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [createTestEvent({ id: "event-1" })],
      pluginName: "test-plugin",
    });

    ctx.markEventDeferred!("event-1", "pending", 30000);

    // Verify deferred state is persisted
    const statePath = join(busDir, "dispatcher.json");
    
    // The context should save the deferred state
    ctx.saveInterceptionState!();
    
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.deferredEventIds).toBeDefined();
    expect(state.deferredEventIds["event-1"]).toBeDefined();
  });

  test("deferred events with elapsed backoff are retried", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus", "state");
    mkdirSync(busDir, { recursive: true });

    // Set up deferred event with past deferredUntil time
    const pastTime = Date.now() - 1000; // 1 second ago
    writeFileSync(
      join(busDir, "dispatcher.json"),
      JSON.stringify({
        eventsOffset: 0,
        actionsOffset: 0,
        processedEventIds: [],
        deferredEventIds: {
          "event-1": { reason: "rate-limit", deferredUntil: pastTime },
        },
      })
    );

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [createTestEvent({ id: "event-1" })],
      pluginName: "test-plugin",
    });

    // Event should be available for triage (backoff elapsed)
    const eventsForTriage = ctx.getEventsForTriage!();
    expect(eventsForTriage.length).toBe(1);
    expect(eventsForTriage[0]!.id).toBe("event-1");
  });

  test("deferred events with future backoff are skipped", async () => {
    const worktree = join(TEST_DIR, "worktree");
    const busDir = join(worktree, "prloom", ".local", "bus", "state");
    mkdirSync(busDir, { recursive: true });

    // Set up deferred event with future deferredUntil time
    const futureTime = Date.now() + 60000; // 1 minute from now
    writeFileSync(
      join(busDir, "dispatcher.json"),
      JSON.stringify({
        eventsOffset: 0,
        actionsOffset: 0,
        processedEventIds: [],
        deferredEventIds: {
          "event-1": { reason: "rate-limit", deferredUntil: futureTime },
        },
      })
    );

    const ctx = buildBeforeTriageContext({
      repoRoot: TEST_DIR,
      worktree,
      planId: "test-plan",
      events: [createTestEvent({ id: "event-1" })],
      pluginName: "test-plugin",
    });

    // Event should NOT be available for triage (backoff not elapsed)
    const eventsForTriage = ctx.getEventsForTriage!();
    expect(eventsForTriage.length).toBe(0);
  });
});
