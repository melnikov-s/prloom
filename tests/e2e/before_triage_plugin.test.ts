/**
 * E2E Test: beforeTriage Plugin Event Interception
 *
 * Tests that plugins can intercept events via the beforeTriage hook
 * and prevent them from reaching the triage agent.
 *
 * See RFC: docs/rfc-plugin-bridge-primitives.md
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  writeInboxPlan,
  buildPlanContent,
  applyEnvOverrides,
  type TempRepoResult,
} from "./harness.js";


import {
  ingestInboxPlans,
  processActivePlans,
} from "../../src/lib/dispatcher.js";
import { loadState } from "../../src/lib/state.js";
import { loadConfig, resolveWorktreesDir } from "../../src/lib/config.js";
import { appendEvent, initBusDir } from "../../src/lib/bus/manager.js";
import type { Event } from "../../src/lib/bus/types.js";

let tempRepo: TempRepoResult;
let restoreEnv: () => void;

beforeEach(async () => {
  tempRepo = await makeTempRepo();
  makeFakeBinaries(tempRepo.binDir, tempRepo.stateDir);
  restoreEnv = applyEnvOverrides(tempRepo.envOverrides);
});

afterEach(() => {
  restoreEnv();
  tempRepo.cleanup();
});

// Helper to create a test event
function createTestEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: "github",
    type: "pr_comment",
    severity: "info",
    title: "Test Comment",
    body: "Normal comment",
    replyTo: { target: "github-pr", token: { prNumber: 1 } },
    context: {
      feedbackId: Date.now(),
      feedbackType: "issue_comment",
      author: "reviewer",
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

// Helper to create an onEvent plugin that intercepts events with a marker
function createInterceptPlugin(pluginsDir: string): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  const MARKER = config.marker || "!intercept";

  const appendLog = (worktree, entry) => {
    const logPath = path.join(worktree, "prloom", ".local", "intercept-log.jsonl");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\\n");
  };

  return {
    onEvent: async (event, ctx) => {
      appendLog(ctx.worktree, { hook: "onEvent", eventId: event.id });

      if (event.body.includes(MARKER)) {
        appendLog(ctx.worktree, { action: "intercept", eventId: event.id, marker: MARKER });
        ctx.markEventHandled(event.id);

        // Emit a response comment
        ctx.emitComment(event.replyTo, "Event intercepted by plugin!");
      }
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "intercept-plugin.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}

// Helper to create a plugin that uses state persistence
function createStatefulPlugin(pluginsDir: string): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function plugin(config) {
  return {
    onEvent: async (event, ctx) => {
      // Get current count from state
      const count = ctx.getState ? ctx.getState("processedCount") || 0 : 0;

      // Increment count for this event
      const newCount = count + 1;

      // Save updated count
      if (ctx.setState) {
        ctx.setState("processedCount", newCount);
      }

      // Log for verification
      const logPath = path.join(ctx.worktree, "prloom", ".local", "stateful-log.jsonl");
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, JSON.stringify({
        previousCount: count,
        eventId: event.id,
        newCount,
        ts: new Date().toISOString()
      }) + "\\n");
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "stateful-plugin.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}

// Helper to read intercept log
function readInterceptLog(
  worktreePath: string
): Array<Record<string, unknown>> {
  const logPath = join(worktreePath, "prloom", ".local", "intercept-log.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Helper to read stateful log
function readStatefulLog(worktreePath: string): Array<Record<string, unknown>> {
  const logPath = join(worktreePath, "prloom", ".local", "stateful-log.jsonl");
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("onEvent: plugin can intercept events with marker", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create intercept plugin
  const pluginsDir = join(repoRoot, "plugins", "intercept");
  const pluginPath = createInterceptPlugin(pluginsDir);

  // Configure with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: true },
    base_branch: "main",
    plugins: {
      "intercept-plugin": {
        module: pluginPath,
        config: { marker: "!memory" },
      },
    },
  });

  const planId = "intercept-test-1";
  const planContent = buildPlanContent({
    title: "Intercept Test",
    objective: "Test event interception.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest plan
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  const worktreePath = state.plans[planId]!.worktree!;

  // Initialize bus and add events
  initBusDir(worktreePath);

  // Add events - one with marker, one without
  appendEvent(
    worktreePath,
    createTestEvent({
      id: "event-1",
      body: "Normal comment without marker",
    })
  );
  appendEvent(
    worktreePath,
    createTestEvent({
      id: "event-2",
      body: "Special comment with !memory update",
    })
  );
  appendEvent(
    worktreePath,
    createTestEvent({
      id: "event-3",
      body: "Another normal comment",
    })
  );

  // Process - this should run onEvent hooks
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger
  );

  // Read intercept log
  const logs = readInterceptLog(worktreePath);

  // Verify onEvent was called
  expect(logs.some((l) => l.hook === "onEvent")).toBe(true);

  // Verify event-2 was intercepted
  expect(
    logs.some((l) => l.action === "intercept" && l.eventId === "event-2")
  ).toBe(true);

  // Verify an action was emitted for the intercepted event
  const actionsPath = join(
    worktreePath,
    "prloom",
    ".local",
    "bus",
    "actions.jsonl"
  );
  expect(existsSync(actionsPath)).toBe(true);
  const actionsContent = readFileSync(actionsPath, "utf-8");
  expect(actionsContent).toContain("Event intercepted by plugin!");
});

test("onEvent: plugin state persists across invocations", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create stateful plugin
  const pluginsDir = join(repoRoot, "plugins", "stateful");
  const pluginPath = createStatefulPlugin(pluginsDir);

  // Configure with plugin
  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "stateful-plugin": { module: pluginPath },
    },
  });

  const planId = "stateful-test-1";
  const planContent = buildPlanContent({
    title: "Stateful Test",
    objective: "Test stateful plugins.",
    todos: ["Single task"],
  });


  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  // Ingest plan
  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  const worktreePath = state.plans[planId]!.worktree!;

  // Initialize bus and add first batch of events
  initBusDir(worktreePath);
  appendEvent(worktreePath, createTestEvent({ id: "event-1" }));
  appendEvent(worktreePath, createTestEvent({ id: "event-2" }));

  // First process
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger
  );

  // Add second batch of events
  appendEvent(worktreePath, createTestEvent({ id: "event-3" }));

  // Second process
  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger
  );

  // Read stateful log
  const logs = readStatefulLog(worktreePath);

  // Verify state was persisted across invocations
  // With onEvent, each event increments count by 1
  // First invocation: 2 events (count goes 0→1→2)
  // Second invocation: 1 event (count goes 2→3)
  expect(logs.length).toBeGreaterThanOrEqual(3); // One log entry per event

  // Find the second invocation log entry
  const secondInvocation = logs.find((l) => l.previousCount === 2);
  expect(secondInvocation).toBeDefined();
  expect(secondInvocation!.newCount).toBe(3);
});

test("onEvent: handled events are added to processedEventIds", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // Create intercept plugin
  const pluginsDir = join(repoRoot, "plugins", "intercept");
  const pluginPath = createInterceptPlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    plugins: {
      "intercept-plugin": {
        module: pluginPath,
        config: { marker: "!intercept" },
      },
    },
  });

  const planId = "processed-ids-test";
  const planContent = buildPlanContent({
    title: "Processed IDs Test",
    objective: "Test processed event tracking.",
    todos: ["Single task"],
  });

  writeInboxPlan(repoRoot, planId, planContent, "opencode");

  const config = loadConfig(repoRoot);
  const worktreesDir = resolveWorktreesDir(repoRoot, config);
  let state = loadState(repoRoot);

  const { logger } = createTestLogger(join(logsDir, "e2e.log"));

  await ingestInboxPlans(repoRoot, worktreesDir, config, state, logger, {
    tmux: false,
  });

  const worktreePath = state.plans[planId]!.worktree!;

  initBusDir(worktreePath);
  appendEvent(
    worktreePath,
    createTestEvent({
      id: "intercept-event-1",
      body: "This has !intercept marker",
    })
  );

  await processActivePlans(
    repoRoot,
    config,
    state,
    "test-bot",
    { tmux: false },
    logger
  );

  // Read dispatcher state
  const dispatcherStatePath = join(
    worktreePath,
    "prloom",
    ".local",
    "bus",
    "state",
    "dispatcher.json"
  );
  expect(existsSync(dispatcherStatePath)).toBe(true);

  const dispatcherState = JSON.parse(
    readFileSync(dispatcherStatePath, "utf-8")
  );

  // The handled event should be in processedEventIds
  expect(dispatcherState.processedEventIds).toContain("intercept-event-1");
});
