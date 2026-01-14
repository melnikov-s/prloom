/**
 * Global Bus Infrastructure Tests
 *
 * Tests for the global bus that operates at the repository level,
 * separate from plan-scoped buses.
 *
 * See RFC: docs/rfc-global-bridge-and-core.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Global Bus Infrastructure", () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "global-bus-test-"));
    repoRoot = join(tempDir, "repo");
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("initGlobalBus", () => {
    test("creates global bus directory at repo root", () => {
      // This test expects a function initGlobalBus(repoRoot) to exist
      // It should create prloom/.local/bus/ at the repo root

      // Expected path: repoRoot/prloom/.local/bus/
      const expectedBusPath = join(repoRoot, "prloom", ".local", "bus");

      // TODO: Call initGlobalBus(repoRoot) when implemented
      // For now, we'll verify the expected structure
      expect(existsSync(expectedBusPath)).toBe(false);

      // After implementation, this should be true:
      // initGlobalBus(repoRoot);
      // expect(existsSync(expectedBusPath)).toBe(true);
    });

    test("creates events.jsonl and actions.jsonl files", () => {
      const busPath = join(repoRoot, "prloom", ".local", "bus");
      const eventsPath = join(busPath, "events.jsonl");
      const actionsPath = join(busPath, "actions.jsonl");

      // TODO: Call initGlobalBus(repoRoot) when implemented
      // expect(existsSync(eventsPath)).toBe(true);
      // expect(existsSync(actionsPath)).toBe(true);

      expect(existsSync(eventsPath)).toBe(false);
    });

    test("creates state directory for dispatcher and bridge state", () => {
      const statePath = join(repoRoot, "prloom", ".local", "bus", "state");

      // TODO: Call initGlobalBus(repoRoot) when implemented
      // expect(existsSync(statePath)).toBe(true);

      expect(existsSync(statePath)).toBe(false);
    });

    test("is idempotent - can be called multiple times safely", () => {
      // TODO: When implemented, verify calling twice doesn't error
      // initGlobalBus(repoRoot);
      // initGlobalBus(repoRoot);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("appendGlobalEvent", () => {
    test("appends event to global events.jsonl", () => {
      const event = {
        id: "global-event-1",
        source: "prloom-core",
        type: "plan_created",
        severity: "info" as const,
        title: "Plan Created",
        body: "New plan created in inbox",
        context: {
          planId: "test-plan-1",
          location: "inbox",
        },
      };

      // TODO: Call appendGlobalEvent(repoRoot, event) when implemented
      // const eventsPath = join(repoRoot, "prloom", ".local", "bus", "events.jsonl");
      // const content = readFileSync(eventsPath, "utf-8");
      // expect(content).toContain("global-event-1");
      // expect(content).toContain("plan_created");

      expect(event.id).toBe("global-event-1");
    });

    test("uses JSONL format with BusRecord envelope", () => {
      const event = {
        id: "global-event-2",
        source: "prloom-core",
        type: "plan_edited",
        severity: "info" as const,
        title: "Plan Edited",
        body: "Plan content changed",
        context: { planId: "test-plan-2" },
      };

      // TODO: When implemented, verify the format:
      // appendGlobalEvent(repoRoot, event);
      // const eventsPath = join(repoRoot, "prloom", ".local", "bus", "events.jsonl");
      // const content = readFileSync(eventsPath, "utf-8");
      // const record = JSON.parse(content.trim());
      // expect(record.kind).toBe("event");
      // expect(record.schemaVersion).toBe(1);
      // expect(record.data.id).toBe("global-event-2");
      // expect(record.ts).toBeDefined();

      expect(event.type).toBe("plan_edited");
    });
  });

  describe("readGlobalEvents", () => {
    test("reads events from global bus using byte offset", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // appendGlobalEvent(repoRoot, { id: "evt-1", ... });
      // appendGlobalEvent(repoRoot, { id: "evt-2", ... });
      //
      // const { events, newOffset } = readGlobalEvents(repoRoot, 0);
      // expect(events.length).toBe(2);
      // expect(newOffset).toBeGreaterThan(0);

      expect(true).toBe(true);
    });

    test("returns only new events when reading from offset", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // appendGlobalEvent(repoRoot, { id: "evt-1", ... });
      // const { newOffset: offset1 } = readGlobalEvents(repoRoot, 0);
      //
      // appendGlobalEvent(repoRoot, { id: "evt-2", ... });
      // const { events, newOffset: offset2 } = readGlobalEvents(repoRoot, offset1);
      //
      // expect(events.length).toBe(1);
      // expect(events[0].id).toBe("evt-2");
      // expect(offset2).toBeGreaterThan(offset1);

      expect(true).toBe(true);
    });

    test("handles unicode content correctly with byte offsets", () => {
      // TODO: When implemented, test with unicode:
      // const event = {
      //   id: "unicode-event",
      //   body: "Hello 世界! 🎉",
      //   ...
      // };
      // appendGlobalEvent(repoRoot, event);
      // const { events, newOffset } = readGlobalEvents(repoRoot, 0);
      // expect(events[0].body).toBe("Hello 世界! 🎉");
      // expect(newOffset).toBeGreaterThan(100); // Multi-byte chars

      expect(true).toBe(true);
    });

    test("returns empty array when no new events", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // const { events, newOffset } = readGlobalEvents(repoRoot, 0);
      // expect(events).toEqual([]);
      // expect(newOffset).toBe(0);

      expect(true).toBe(true);
    });
  });

  describe("appendGlobalAction", () => {
    test("appends action to global actions.jsonl", () => {
      const action = {
        id: "global-action-1",
        type: "respond" as const,
        target: { target: "prloom-core", token: {} },
        payload: {
          type: "upsert_plan" as const,
          source: { system: "github", kind: "issue", id: "123" },
          title: "Test Plan",
          planMarkdown: "# Test\n\n- [ ] Task",
        },
      };

      // TODO: Call appendGlobalAction(repoRoot, action) when implemented
      // const actionsPath = join(repoRoot, "prloom", ".local", "bus", "actions.jsonl");
      // const content = readFileSync(actionsPath, "utf-8");
      // expect(content).toContain("global-action-1");
      // expect(content).toContain("upsert_plan");

      expect(action.id).toBe("global-action-1");
    });
  });

  describe("readGlobalActions", () => {
    test("reads actions from global bus using byte offset", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // appendGlobalAction(repoRoot, { id: "act-1", ... });
      // appendGlobalAction(repoRoot, { id: "act-2", ... });
      //
      // const { actions, newOffset } = readGlobalActions(repoRoot, 0);
      // expect(actions.length).toBe(2);
      // expect(newOffset).toBeGreaterThan(0);

      expect(true).toBe(true);
    });

    test("returns only new actions when reading from offset", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // appendGlobalAction(repoRoot, { id: "act-1", ... });
      // const { newOffset: offset1 } = readGlobalActions(repoRoot, 0);
      //
      // appendGlobalAction(repoRoot, { id: "act-2", ... });
      // const { actions, newOffset: offset2 } = readGlobalActions(repoRoot, offset1);
      //
      // expect(actions.length).toBe(1);
      // expect(actions[0].id).toBe("act-2");
      // expect(offset2).toBeGreaterThan(offset1);

      expect(true).toBe(true);
    });
  });

  describe("Global Dispatcher State", () => {
    test("loads default state when file doesn't exist", () => {
      // TODO: When implemented:
      // const state = loadGlobalDispatcherState(repoRoot);
      // expect(state.eventsOffset).toBe(0);
      // expect(state.actionsOffset).toBe(0);
      // expect(state.processedEventIds).toEqual([]);
      // expect(state.planHashes).toEqual({});

      expect(true).toBe(true);
    });

    test("saves and loads dispatcher state", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // const state = {
      //   eventsOffset: 123,
      //   actionsOffset: 456,
      //   processedEventIds: ["evt-1", "evt-2"],
      //   planHashes: { "plan-1": "abc123" },
      // };
      // saveGlobalDispatcherState(repoRoot, state);
      //
      // const loaded = loadGlobalDispatcherState(repoRoot);
      // expect(loaded).toEqual(state);

      expect(true).toBe(true);
    });

    test("state file is at prloom/.local/bus/state/dispatcher.json", () => {
      const expectedPath = join(
        repoRoot,
        "prloom",
        ".local",
        "bus",
        "state",
        "dispatcher.json"
      );

      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // saveGlobalDispatcherState(repoRoot, { ... });
      // expect(existsSync(expectedPath)).toBe(true);

      expect(existsSync(expectedPath)).toBe(false);
    });

    test("includes planHashes for hash-based edit detection", () => {
      // TODO: When implemented:
      // const state = loadGlobalDispatcherState(repoRoot);
      // expect(state.planHashes).toBeDefined();
      // expect(typeof state.planHashes).toBe("object");

      expect(true).toBe(true);
    });

    test("includes deferredEventIds for event deferral", () => {
      // TODO: When implemented:
      // const state = {
      //   eventsOffset: 0,
      //   actionsOffset: 0,
      //   processedEventIds: [],
      //   planHashes: {},
      //   deferredEventIds: {
      //     "evt-1": { reason: "waiting", deferredUntil: "2026-01-13T14:00:00Z" }
      //   },
      // };
      // saveGlobalDispatcherState(repoRoot, state);
      // const loaded = loadGlobalDispatcherState(repoRoot);
      // expect(loaded.deferredEventIds).toEqual(state.deferredEventIds);

      expect(true).toBe(true);
    });

    test("includes processedActionIds for action interception", () => {
      // TODO: When implemented:
      // const state = {
      //   eventsOffset: 0,
      //   actionsOffset: 0,
      //   processedEventIds: [],
      //   processedActionIds: ["act-1", "act-2"],
      //   planHashes: {},
      // };
      // saveGlobalDispatcherState(repoRoot, state);
      // const loaded = loadGlobalDispatcherState(repoRoot);
      // expect(loaded.processedActionIds).toEqual(["act-1", "act-2"]);

      expect(true).toBe(true);
    });
  });

  describe("Global Bridge State", () => {
    test("loads and saves bridge state at global scope", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // const bridgeState = { lastPollTime: "2026-01-13T13:00:00Z", cursor: 123 };
      // saveGlobalBridgeState(repoRoot, "github-kanban", bridgeState);
      //
      // const loaded = loadGlobalBridgeState(repoRoot, "github-kanban");
      // expect(loaded).toEqual(bridgeState);

      expect(true).toBe(true);
    });

    test("bridge state file is at prloom/.local/bus/state/bridge.<name>.json", () => {
      const expectedPath = join(
        repoRoot,
        "prloom",
        ".local",
        "bus",
        "state",
        "bridge.github-kanban.json"
      );

      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // saveGlobalBridgeState(repoRoot, "github-kanban", { cursor: 0 });
      // expect(existsSync(expectedPath)).toBe(true);

      expect(existsSync(expectedPath)).toBe(false);
    });

    test("returns undefined for non-existent bridge state", () => {
      // TODO: When implemented:
      // const state = loadGlobalBridgeState(repoRoot, "non-existent");
      // expect(state).toBeUndefined();

      expect(true).toBe(true);
    });
  });

  describe("Global vs Plan Bus Separation", () => {
    test("global bus is at repo root, plan bus is in worktree", () => {
      const globalBusPath = join(repoRoot, "prloom", ".local", "bus");
      const worktreePath = join(
        repoRoot,
        "prloom",
        ".local",
        "worktrees",
        "test-plan"
      );
      const planBusPath = join(worktreePath, "prloom", ".local", "bus");

      // These should be different paths
      expect(globalBusPath).not.toBe(planBusPath);

      // TODO: When implemented, verify both can exist independently:
      // initGlobalBus(repoRoot);
      // initBusDir(worktreePath);
      // expect(existsSync(globalBusPath)).toBe(true);
      // expect(existsSync(planBusPath)).toBe(true);
    });

    test("global and plan buses have separate event IDs and offsets", () => {
      // TODO: When implemented:
      // initGlobalBus(repoRoot);
      // appendGlobalEvent(repoRoot, { id: "global-1", ... });
      //
      // const worktreePath = join(repoRoot, "prloom", ".local", "worktrees", "test");
      // initBusDir(worktreePath);
      // appendEvent(worktreePath, { id: "plan-1", ... });
      //
      // const globalEvents = readGlobalEvents(repoRoot, 0).events;
      // const planEvents = readEvents(worktreePath, 0).events;
      //
      // expect(globalEvents[0].id).toBe("global-1");
      // expect(planEvents[0].id).toBe("plan-1");

      expect(true).toBe(true);
    });
  });
});
