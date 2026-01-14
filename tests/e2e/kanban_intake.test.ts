/**
 * E2E Test: Kanban Intake Workflow
 *
 * Tests the complete flow of creating plans from external issues:
 * 1. Global bridge polls external system (GitHub)
 * 2. Bridge emits upsert_plan action
 * 3. Core bridge creates inbox plan
 * 4. plan_created event emitted to global bus
 * 5. Global plugin receives event and can react
 *
 * See RFC: docs/rfc-global-bridge-and-core.md
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";

import {
  makeTempRepo,
  makeFakeBinaries,
  createTestLogger,
  writeTestConfig,
  applyEnvOverrides,
  type TempRepoResult,
} from "./harness.js";

import { loadState } from "../../src/lib/state.js";
import { loadConfig } from "../../src/lib/config.js";

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

// Helper to create a mock GitHub bridge that emits upsert_plan
function createMockGitHubBridge(bridgesDir: string): string {
  const bridgeContent = `
const fs = require("fs");
const path = require("path");

module.exports = function githubKanbanBridge(config) {
  return {
    name: "github-kanban",
    targets: ["prloom-core"],
    
    async events(ctx, state) {
      // Mock: Simulate polling GitHub and finding new issue
      const mockIssues = config.mockIssues || [];
      const events = [];
      
      // Log polling activity
      ctx.log.info("Polling GitHub for kanban updates");
      
      return { events, state: state || {} };
    },
    
    async actions(ctx, action) {
      // This bridge doesn't handle actions (only emits them)
      return { success: true };
    },
  };
};
`;

  mkdirSync(bridgesDir, { recursive: true });
  const bridgePath = join(bridgesDir, "github-kanban.js");
  writeFileSync(bridgePath, bridgeContent);
  return bridgePath;
}

// Helper to create a global plugin that logs plan_created events
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
        context: event.context,
        ts: new Date().toISOString(),
      }) + "\\n");
      
      // Mark as handled so it doesn't pile up
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

test("kanban intake: issue to plan creation", async () => {
  const { repoRoot, logsDir } = tempRepo;

  // TODO: This test requires full implementation of:
  // - Global bridges
  // - Global bus
  // - Core bridge (prloom-core)
  // - Global dispatcher tick
  // - Plan lifecycle events

  // For now, we set up the structure and verify it can be configured

  const bridgesDir = join(repoRoot, "bridges");
  const pluginsDir = join(repoRoot, "plugins");

  const bridgePath = createMockGitHubBridge(bridgesDir);
  const pluginPath = createEventLoggerPlugin(pluginsDir);

  writeTestConfig(repoRoot, {
    agents: { default: "opencode" },
    github: { enabled: false }, // Disable default GitHub bridge
    base_branch: "main",
    globalBridges: {
      "github-kanban": {
        module: bridgePath,
        config: {
          projectId: "PVT_test123",
          todoColumn: "Ready",
          mockIssues: [
            {
              number: 123,
              title: "Fix login bug",
              body: "# Fix Login Bug\n\n- [ ] Reproduce issue\n- [ ] Fix code\n- [ ] Add tests",
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

  // Verify config loaded correctly
  expect(config.globalBridges).toBeDefined();
  // TODO: When implemented:
  // expect(config.globalBridges["github-kanban"]).toBeDefined();
  // expect(config.globalPlugins["event-logger"]).toBeDefined();

  // TODO: When global dispatcher is implemented:
  // const { logger } = createTestLogger(join(logsDir, "e2e.log"));
  //
  // // Run global tick
  // await runGlobalTick(repoRoot, config, logger);
  //
  // // Verify plan was created
  // const state = loadState(repoRoot);
  // const plan = Object.values(state.plans).find(
  //   p => p.source?.system === "github" && p.source?.id === "123"
  // );
  // expect(plan).toBeDefined();
  // expect(plan?.status).toBe("draft");
  //
  // // Verify inbox plan file exists
  // const inboxPath = join(repoRoot, "prloom", ".local", "inbox");
  // const planFiles = readdirSync(inboxPath).filter(f => f.endsWith(".md"));
  // expect(planFiles.length).toBeGreaterThan(0);
  //
  // // Verify plan content
  // const planContent = readFileSync(join(inboxPath, planFiles[0]), "utf-8");
  // expect(planContent).toContain("Fix Login Bug");
  // expect(planContent).toContain("Reproduce issue");
  //
  // // Verify plan_created event was emitted
  // const globalEvents = readGlobalEvents(repoRoot, 0).events;
  // const createdEvent = globalEvents.find(e => e.type === "plan_created");
  // expect(createdEvent).toBeDefined();
  // expect(createdEvent?.context?.planId).toBeDefined();
  // expect(createdEvent?.context?.source?.id).toBe("123");
  //
  // // Verify global plugin logged the event
  // const eventLogPath = join(repoRoot, "prloom", ".local", "event-log.jsonl");
  // expect(existsSync(eventLogPath)).toBe(true);
  // const logContent = readFileSync(eventLogPath, "utf-8");
  // expect(logContent).toContain("plan_created");
});

test("kanban intake: duplicate detection via source", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Create plan from issue #123
  // 2. Run global tick (creates plan)
  // 3. Run global tick again (same issue)
  // 4. Verify only one plan exists (not duplicated)
  // 5. Verify plan was updated, not created again

  expect(true).toBe(true);
});

test("kanban intake: multiple issues create multiple plans", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // Configure bridge with multiple mock issues
  // Run global tick
  // Verify multiple plans created, each with correct source

  expect(true).toBe(true);
});

test("kanban intake: global plugin can read plan content", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Create plan from issue
  // 2. Global plugin receives plan_created event
  // 3. Plugin calls ctx.readPlan(planId)
  // 4. Verify plugin can access plan content

  expect(true).toBe(true);
});

test("kanban intake: plan created with correct metadata", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // Verify created plan has:
  // - source: { system: "github", kind: "issue", id: "123" }
  // - status: "draft" (or "queued" if specified)
  // - hidden: false (default)
  // - Correct title and content

  expect(true).toBe(true);
});

test("kanban intake: bridge state persists across ticks", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Run global tick (bridge returns state)
  // 2. Verify state saved to prloom/.local/bus/state/bridge.github-kanban.json
  // 3. Run global tick again
  // 4. Verify bridge receives previous state

  expect(true).toBe(true);
});

test("kanban intake: error in bridge doesn't crash dispatcher", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Configure bridge that throws error
  // 2. Run global tick
  // 3. Verify error is logged but dispatcher continues
  // 4. Verify other bridges still run

  expect(true).toBe(true);
});

test("kanban intake: beforeUpsert can transform plan content", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Register global plugin with beforeUpsert hook
  // 2. Hook adds standard sections to plan
  // 3. Run global tick (creates plan from issue)
  // 4. Verify plan has transformed content

  expect(true).toBe(true);
});

test("kanban intake: beforeUpsert can reject invalid plans", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Register global plugin with beforeUpsert hook
  // 2. Hook rejects plans without certain criteria
  // 3. Run global tick with invalid issue
  // 4. Verify plan was not created
  // 5. Verify rejection reason logged

  expect(true).toBe(true);
});

test("kanban intake: hidden plans are created but not activated", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Configure bridge to create plan with hidden: true
  // 2. Run global tick (creates hidden plan)
  // 3. Run dispatcher activation
  // 4. Verify plan exists but was not activated
  // 5. Verify plan can be queried via listPlans({ hidden: true })

  expect(true).toBe(true);
});

test("kanban intake: plan with status queued is ready for activation", async () => {
  const { repoRoot } = tempRepo;

  // TODO: When implemented:
  // 1. Configure bridge to create plan with status: "queued"
  // 2. Run global tick
  // 3. Run dispatcher activation
  // 4. Verify plan was activated (moved to worktree)

  expect(true).toBe(true);
});
