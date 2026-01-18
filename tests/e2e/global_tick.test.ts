/**
 * E2E Test: Global Tick
 *
 * Tests the complete global tick flow:
 * 1. Global bridge polls and emits upsert_plan action
 * 2. Core bridge creates inbox plan
 * 3. plan_created event emitted to global bus
 * 4. Global plugin receives event via onGlobalEvent
 *
 * See RFC: docs/rfc-global-bridge-and-core.md
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  applyEnvOverrides,
  buildPlanContent,
  type TempRepoResult,
} from "./harness.js";

import { loadState, findPlanBySource } from "../../src/lib/state.js";
import { loadConfig } from "../../src/lib/config.js";
import { runGlobalTick } from "../../src/lib/dispatcher.js";
import { readGlobalEvents } from "../../src/lib/bus/manager.js";

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

/**
 * Create a mock global bridge that emits upsert_plan actions for issues.
 */
function createMockGlobalBridge(bridgesDir: string): string {
  const bridgeContent = `
const fs = require("fs");
const path = require("path");

module.exports = function mockGlobalBridge(config) {
  return {
    name: "mock-global",
    targets: ["prloom-core"],
    
    async events(ctx, state) {
      const actions = [];
      const mockIssues = config.mockIssues || [];
      const processedIds = state.processedIssueIds || [];
      
      ctx.log.info("Mock global bridge polling...");
      
      for (const issue of mockIssues) {
        // Skip already processed issues
        if (processedIds.includes(issue.id)) {
          continue;
        }
        
        // Emit upsert_plan action for new issue
        actions.push({
          id: "action-" + Date.now() + "-" + issue.id,
          type: "respond",
          target: "prloom-core",
          payload: {
            type: "upsert_plan",
            source: {
              system: "github",
              kind: "issue",
              id: String(issue.id),
            },
            title: issue.title,
            planMarkdown: issue.body,
            status: issue.status || "draft",
            hidden: issue.hidden || false,
          },
        });
        
        processedIds.push(issue.id);
      }
      
      return { 
        events: [], 
        actions,
        state: { ...state, processedIssueIds: processedIds } 
      };
    },
  };
};
`;

  mkdirSync(bridgesDir, { recursive: true });
  const bridgePath = join(bridgesDir, "mock-global-bridge.js");
  writeFileSync(bridgePath, bridgeContent);
  return bridgePath;
}

/**
 * Create a global plugin that logs plan_created events.
 */
function createEventLoggerPlugin(pluginsDir: string): string {
  const pluginContent = `
const fs = require("fs");
const path = require("path");

module.exports = function eventLogger(config) {
  return {
    onGlobalEvent: async (event, ctx) => {
      const logPath = path.join(ctx.repoRoot, "prloom", ".local", "event-log.jsonl");
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, JSON.stringify({
        eventId: event.id,
        eventType: event.type,
        eventSource: event.source,
        context: event.context,
        ts: new Date().toISOString(),
      }) + "\\n");
      
      ctx.markEventHandled(event.id);
    },
  };
};
`;

  mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = join(pluginsDir, "event-logger.js");
  writeFileSync(pluginPath, pluginContent);
  return pluginPath;
}

// =============================================================================
// Tests
// =============================================================================

test("global tick: bridge emits upsert_plan, core bridge creates inbox plan", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const bridgesDir = join(repoRoot, "bridges");
  const bridgePath = createMockGlobalBridge(bridgesDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    globalBridges: {
      "mock-global": {
        module: bridgePath,
        config: {
          mockIssues: [
            {
              id: 123,
              title: "Fix login bug",
              body: buildPlanContent({
                title: "Fix Login Bug",
                summary: "- Login fix",
                objective: "Fix the login issue.",
                context: "Plan-specific setup",
                scope: "In: login flow\nOut: signup flow",
                successCriteria: "- Login works",
                todos: ["Reproduce issue", "Fix code"],
              }),
            },
          ],
        },
      },
    },
  });

  const config = loadConfig(repoRoot);
  const { logger } = createTestLogger(join(logsDir, "global-tick.log"));

  // Run global tick
  await runGlobalTick(repoRoot, config, logger);

  // Verify inbox plan was created
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  expect(existsSync(inboxDir)).toBe(true);

  const planFiles = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  expect(planFiles.length).toBeGreaterThan(0);

  // Verify plan content
  const planContent = readFileSync(join(inboxDir, planFiles[0]!), "utf-8");
  expect(planContent).toContain("Fix Login Bug");
  expect(planContent).toContain("Reproduce issue");

  // Verify plan has correct source metadata
  const state = loadState(repoRoot);
  const planWithSource = findPlanBySource(repoRoot, {
    system: "github",
    kind: "issue",
    id: "123",
  });
  expect(planWithSource).toBeDefined();
  expect(planWithSource!.state.source?.system).toBe("github");
  expect(planWithSource!.state.source?.id).toBe("123");
});

test("global tick: duplicate detection via source identity", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const bridgesDir = join(repoRoot, "bridges");
  const bridgePath = createMockGlobalBridge(bridgesDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    globalBridges: {
      "mock-global": {
        module: bridgePath,
        config: {
          mockIssues: [
            {
              id: 456,
              title: "Original title",
              body: buildPlanContent({
                title: "Original",
                todos: ["Task 1"],
              }),
            },
          ],
        },
      },
    },
  });

  const config = loadConfig(repoRoot);
  const { logger } = createTestLogger(join(logsDir, "global-tick.log"));

  // Run global tick twice - second should not duplicate
  await runGlobalTick(repoRoot, config, logger);
  await runGlobalTick(repoRoot, config, logger);

  // Count inbox plans - should only be 1
  const inboxDir = join(repoRoot, "prloom", ".local", "inbox");
  const planFiles = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
  expect(planFiles.length).toBe(1);
});

test("global tick: plan_created lifecycle event emitted", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const bridgesDir = join(repoRoot, "bridges");
  const bridgePath = createMockGlobalBridge(bridgesDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    globalBridges: {
      "mock-global": {
        module: bridgePath,
        config: {
          mockIssues: [
            {
              id: 789,
              title: "New feature",
              body: buildPlanContent({
                title: "New Feature",
                summary: "- New feature",
                objective: "Ship the feature",
                context: "Plan-specific setup",
                scope: "In: feature\nOut: extras",
                successCriteria: "- Feature works",
                todos: ["Implement"],
              }),
            },
          ],
        },
      },
    },
  });

  const config = loadConfig(repoRoot);
  const { logger } = createTestLogger(join(logsDir, "global-tick.log"));

  // Run global tick
  await runGlobalTick(repoRoot, config, logger);

  // Verify plan_created event was emitted to global bus
  const { events } = readGlobalEvents(repoRoot, 0);
  const createdEvent = events.find((e) => e.type === "plan_created");

  expect(createdEvent).toBeDefined();
  const source = createdEvent!.context?.source as { id?: string } | undefined;
  expect(source?.id).toBe("789");
});

test("global tick: global plugin receives plan_created event", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const bridgesDir = join(repoRoot, "bridges");
  const pluginsDir = join(repoRoot, "plugins");

  const bridgePath = createMockGlobalBridge(bridgesDir);
  const pluginPath = createEventLoggerPlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    globalBridges: {
      "mock-global": {
        module: bridgePath,
        config: {
          mockIssues: [
            {
              id: 999,
              title: "Plugin test",
              body: buildPlanContent({
                title: "Plugin Test",
                summary: "- Plugin test",
                objective: "Validate plugin",
                context: "Plan-specific setup",
                scope: "In: plugin test\nOut: extras",
                successCriteria: "- Plugin runs",
                todos: ["Test"],
              }),
            },
          ],
        },
      },
    },
    globalPlugins: {
      "event-logger": {
        module: pluginPath,
      },
    },
  });

  const config = loadConfig(repoRoot);
  const { logger } = createTestLogger(join(logsDir, "global-tick.log"));

  // Run global tick twice:
  // First tick creates the plan and emits plan_created event
  // Second tick processes the plan_created event and runs onGlobalEvent hooks
  await runGlobalTick(repoRoot, config, logger);
  await runGlobalTick(repoRoot, config, logger);

  // Verify plugin logged the event
  const eventLogPath = join(repoRoot, "prloom", ".local", "event-log.jsonl");
  expect(existsSync(eventLogPath)).toBe(true);

  const logContent = readFileSync(eventLogPath, "utf-8");
  expect(logContent).toContain("plan_created");
});

test("global tick: bridge state persists across invocations", async () => {
  const { repoRoot, logsDir } = tempRepo;

  const bridgesDir = join(repoRoot, "bridges");
  const bridgePath = createMockGlobalBridge(bridgesDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false },
    base_branch: "main",
    globalBridges: {
      "mock-global": {
        module: bridgePath,
        config: {
          mockIssues: [
            {
              id: 1,
              title: "Issue 1",
              body: buildPlanContent({
                title: "Issue 1",
                todos: ["Task"],
              }),
            },
            {
              id: 2,
              title: "Issue 2",
              body: buildPlanContent({
                title: "Issue 2",
                todos: ["Task"],
              }),
            },
          ],
        },
      },
    },
  });

  const config = loadConfig(repoRoot);
  const { logger } = createTestLogger(join(logsDir, "global-tick.log"));

  // Run global tick
  await runGlobalTick(repoRoot, config, logger);

  // Verify bridge state file exists
  const bridgeStatePath = join(
    repoRoot,
    "prloom",
    ".local",
    "bus",
    "state",
    "bridge.mock-global.json"
  );
  expect(existsSync(bridgeStatePath)).toBe(true);

  // Verify state contains processed issue IDs
  const bridgeState = JSON.parse(readFileSync(bridgeStatePath, "utf-8"));
  expect(bridgeState.processedIssueIds).toContain(1);
  expect(bridgeState.processedIssueIds).toContain(2);
});
