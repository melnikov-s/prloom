import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import {
  initBusDir,
  hasBusDir,
  getBusDir,
  appendEvent,
  readEvents,
  appendAction,
  readActions,
  loadDispatcherState,
  saveDispatcherState,
  loadBridgeState,
  saveBridgeState,
  loadBridgeActionState,
  saveBridgeActionState,
  deduplicateEvents,
  pruneProcessedIds,
} from "../../src/lib/bus/manager.js";
import type {
  Event,
  Action,
  DispatcherBusState,
} from "../../src/lib/bus/types.js";

const TEST_WORKTREE = join("/tmp", `prloom-bus-test-${Date.now()}`);

beforeEach(() => {
  if (existsSync(TEST_WORKTREE)) {
    rmSync(TEST_WORKTREE, { recursive: true });
  }
  mkdirSync(TEST_WORKTREE, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_WORKTREE)) {
    rmSync(TEST_WORKTREE, { recursive: true });
  }
});

// =============================================================================
// Directory Management Tests
// =============================================================================

test("initBusDir creates bus directory structure", () => {
  expect(hasBusDir(TEST_WORKTREE)).toBe(false);

  initBusDir(TEST_WORKTREE);

  expect(hasBusDir(TEST_WORKTREE)).toBe(true);
  expect(existsSync(join(getBusDir(TEST_WORKTREE), "events.jsonl"))).toBe(true);
  expect(existsSync(join(getBusDir(TEST_WORKTREE), "actions.jsonl"))).toBe(
    true
  );
  expect(existsSync(join(getBusDir(TEST_WORKTREE), "state"))).toBe(true);
});

test("initBusDir is idempotent", () => {
  initBusDir(TEST_WORKTREE);
  initBusDir(TEST_WORKTREE);

  expect(hasBusDir(TEST_WORKTREE)).toBe(true);
});

// =============================================================================
// Event Operations Tests
// =============================================================================

test("appendEvent and readEvents round-trip", () => {
  initBusDir(TEST_WORKTREE);

  const event: Event = {
    id: "test-event-1",
    source: "test",
    type: "test_type",
    severity: "info",
    title: "Test Event",
    body: "Event body content",
  };

  appendEvent(TEST_WORKTREE, event);

  const { events, newOffset } = readEvents(TEST_WORKTREE, 0);

  expect(events.length).toBe(1);
  expect(events[0]!.id).toBe("test-event-1");
  expect(events[0]!.source).toBe("test");
  expect(events[0]!.body).toBe("Event body content");
  expect(newOffset).toBeGreaterThan(0);
});

test("readEvents with offset skips already-read events", () => {
  initBusDir(TEST_WORKTREE);

  const event1: Event = {
    id: "event-1",
    source: "test",
    type: "test",
    severity: "info",
    title: "Event 1",
    body: "Body 1",
  };

  const event2: Event = {
    id: "event-2",
    source: "test",
    type: "test",
    severity: "info",
    title: "Event 2",
    body: "Body 2",
  };

  appendEvent(TEST_WORKTREE, event1);
  const { newOffset: offset1 } = readEvents(TEST_WORKTREE, 0);

  appendEvent(TEST_WORKTREE, event2);
  const { events, newOffset: offset2 } = readEvents(TEST_WORKTREE, offset1);

  expect(events.length).toBe(1);
  expect(events[0]!.id).toBe("event-2");
  expect(offset2).toBeGreaterThan(offset1);
});

test("readEvents returns empty for non-existent file", () => {
  const { events, newOffset } = readEvents(TEST_WORKTREE, 0);

  expect(events).toEqual([]);
  expect(newOffset).toBe(0);
});

// =============================================================================
// Action Operations Tests
// =============================================================================

test("appendAction and readActions round-trip", () => {
  initBusDir(TEST_WORKTREE);

  const action: Action = {
    id: "test-action-1",
    type: "respond",
    target: { target: "github-pr", token: { prNumber: 123 } },
    payload: { type: "comment", message: "Test comment" },
  };

  appendAction(TEST_WORKTREE, action);

  const { actions, newOffset } = readActions(TEST_WORKTREE, 0);

  expect(actions.length).toBe(1);
  expect(actions[0]!.id).toBe("test-action-1");
  expect(actions[0]!.type).toBe("respond");
  expect(newOffset).toBeGreaterThan(0);
});

// =============================================================================
// Dispatcher State Tests
// =============================================================================

test("loadDispatcherState returns defaults for missing file", () => {
  initBusDir(TEST_WORKTREE);

  const state = loadDispatcherState(TEST_WORKTREE);

  expect(state.eventsOffset).toBe(0);
  expect(state.processedEventIds).toEqual([]);
});

test("saveDispatcherState and loadDispatcherState round-trip", () => {
  initBusDir(TEST_WORKTREE);

  const state: DispatcherBusState = {
    eventsOffset: 1234,
    actionsOffset: 5678,
    processedEventIds: ["event-1", "event-2"],
  };

  saveDispatcherState(TEST_WORKTREE, state);
  const loaded = loadDispatcherState(TEST_WORKTREE);

  expect(loaded.eventsOffset).toBe(1234);
  expect(loaded.actionsOffset).toBe(5678);
  expect(loaded.processedEventIds).toEqual(["event-1", "event-2"]);
});

// =============================================================================
// Bridge State Tests
// =============================================================================

test("loadBridgeState returns undefined for missing file", () => {
  initBusDir(TEST_WORKTREE);

  const state = loadBridgeState(TEST_WORKTREE, "github");

  expect(state).toBeUndefined();
});

test("saveBridgeState and loadBridgeState round-trip", () => {
  initBusDir(TEST_WORKTREE);

  const state = { lastPollTime: 1234567890, cursors: { lastId: 42 } };

  saveBridgeState(TEST_WORKTREE, "github", state);
  const loaded = loadBridgeState(TEST_WORKTREE, "github");

  expect(loaded).toEqual(state);
});

test("loadBridgeActionState returns empty deliveredActions for missing file", () => {
  initBusDir(TEST_WORKTREE);

  const state = loadBridgeActionState(TEST_WORKTREE, "github");

  expect(state.deliveredActions).toEqual({});
});

test("saveBridgeActionState and loadBridgeActionState round-trip", () => {
  initBusDir(TEST_WORKTREE);

  const state = {
    deliveredActions: {
      "action-1": { commentId: 123 },
      "action-2": { reviewId: 456 },
    },
  };

  saveBridgeActionState(TEST_WORKTREE, "github", state);
  const loaded = loadBridgeActionState(TEST_WORKTREE, "github");

  expect(loaded.deliveredActions["action-1"]).toEqual({ commentId: 123 });
  expect(loaded.deliveredActions["action-2"]).toEqual({ reviewId: 456 });
});

// =============================================================================
// Deduplication Tests
// =============================================================================

test("deduplicateEvents filters already-processed events", () => {
  const events: Event[] = [
    {
      id: "e1",
      source: "test",
      type: "t",
      severity: "info",
      title: "1",
      body: "",
    },
    {
      id: "e2",
      source: "test",
      type: "t",
      severity: "info",
      title: "2",
      body: "",
    },
    {
      id: "e3",
      source: "test",
      type: "t",
      severity: "info",
      title: "3",
      body: "",
    },
  ];

  const processedIds = new Set(["e1"]);
  const newEvents = deduplicateEvents(events, processedIds);

  expect(newEvents.length).toBe(2);
  expect(newEvents.map((e) => e.id)).toEqual(["e2", "e3"]);
  expect(processedIds.has("e2")).toBe(true);
  expect(processedIds.has("e3")).toBe(true);
});

test("pruneProcessedIds limits array size", () => {
  const ids = Array.from({ length: 1500 }, (_, i) => `id-${i}`);
  const pruned = pruneProcessedIds(ids, 1000);

  expect(pruned.length).toBe(1000);
  expect(pruned[0]).toBe("id-500");
  expect(pruned[999]).toBe("id-1499");
});

test("pruneProcessedIds returns original if under limit", () => {
  const ids = ["a", "b", "c"];
  const pruned = pruneProcessedIds(ids, 1000);

  expect(pruned).toEqual(ids);
});

// =============================================================================
// Byte Offset Tests (Unicode/Non-ASCII Content)
// =============================================================================

test("readEvents handles non-ASCII content correctly with byte offsets", () => {
  initBusDir(TEST_WORKTREE);

  // Event with emoji and unicode characters (multi-byte in UTF-8)
  const event1: Event = {
    id: "event-emoji-1",
    source: "test",
    type: "test",
    severity: "info",
    title: "Event with emoji 🎉",
    body: "Hello 世界! 🚀 Testing unicode: café, naïve, 日本語",
  };

  const event2: Event = {
    id: "event-emoji-2",
    source: "test",
    type: "test",
    severity: "info",
    title: "Second event",
    body: "After unicode content",
  };

  // Append first event
  appendEvent(TEST_WORKTREE, event1);
  const { events: firstRead, newOffset: offset1 } = readEvents(TEST_WORKTREE, 0);

  expect(firstRead.length).toBe(1);
  expect(firstRead[0]!.id).toBe("event-emoji-1");
  expect(firstRead[0]!.body).toContain("世界");
  expect(firstRead[0]!.body).toContain("🚀");

  // Append second event
  appendEvent(TEST_WORKTREE, event2);
  const { events: secondRead, newOffset: offset2 } = readEvents(TEST_WORKTREE, offset1);

  // Should only get the second event, not re-read the first
  expect(secondRead.length).toBe(1);
  expect(secondRead[0]!.id).toBe("event-emoji-2");
  expect(offset2).toBeGreaterThan(offset1);
});

test("readActions handles non-ASCII content correctly with byte offsets", () => {
  initBusDir(TEST_WORKTREE);

  // Action with unicode in message
  const action1: Action = {
    id: "action-unicode-1",
    type: "respond",
    target: { target: "github-pr", token: { prNumber: 123 } },
    payload: { type: "comment", message: "Great work! 👍 Changes look 完璧です" },
  };

  const action2: Action = {
    id: "action-unicode-2",
    type: "respond",
    target: { target: "github-pr", token: { prNumber: 123 } },
    payload: { type: "comment", message: "Follow-up comment" },
  };

  // Append first action
  appendAction(TEST_WORKTREE, action1);
  const { actions: firstRead, newOffset: offset1 } = readActions(TEST_WORKTREE, 0);

  expect(firstRead.length).toBe(1);
  expect(firstRead[0]!.id).toBe("action-unicode-1");

  // Append second action
  appendAction(TEST_WORKTREE, action2);
  const { actions: secondRead, newOffset: offset2 } = readActions(TEST_WORKTREE, offset1);

  // Should only get the second action
  expect(secondRead.length).toBe(1);
  expect(secondRead[0]!.id).toBe("action-unicode-2");
  expect(offset2).toBeGreaterThan(offset1);
});

test("byte offset correctly handles multi-byte characters at boundaries", () => {
  initBusDir(TEST_WORKTREE);

  // Create events where multi-byte characters might cause boundary issues
  // if using string index instead of byte offset
  const events: Event[] = [];
  for (let i = 0; i < 5; i++) {
    events.push({
      id: `event-${i}`,
      source: "test",
      type: "test",
      severity: "info",
      title: `Event ${i}`,
      // Each emoji is 4 bytes in UTF-8, varying the count to create different byte lengths
      body: "🎯".repeat(i + 1) + " content",
    });
  }

  // Append and read incrementally
  let currentOffset = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    appendEvent(TEST_WORKTREE, event);
    const { events: readResult, newOffset } = readEvents(TEST_WORKTREE, currentOffset);

    expect(readResult.length).toBe(1);
    expect(readResult[0]!.id).toBe(`event-${i}`);
    expect(readResult[0]!.body).toContain("🎯");

    currentOffset = newOffset;
  }

  // Final verification: read all from start
  const { events: allEvents } = readEvents(TEST_WORKTREE, 0);
  expect(allEvents.length).toBe(5);
});

// =============================================================================
// JSONL Partial Line Hazard Tests
// =============================================================================

test("readEvents returns offset at last complete newline, not buffer end", () => {
  initBusDir(TEST_WORKTREE);

  // Write a complete event
  const event1: Event = {
    id: "event-complete-1",
    source: "test",
    type: "test",
    severity: "info",
    title: "Complete Event",
    body: "This event is complete",
  };
  appendEvent(TEST_WORKTREE, event1);

  // Now simulate a partial write by appending incomplete JSON without newline
  const eventsPath = join(getBusDir(TEST_WORKTREE), "events.jsonl");
  const partialJson = '{"ts":"2026-01-10","kind":"event","schemaVersion":1,"data":{"id":"partial"';
  writeFileSync(eventsPath, readFileSync(eventsPath) + partialJson);

  // Read events - should only get the complete event
  const { events, newOffset } = readEvents(TEST_WORKTREE, 0);

  expect(events.length).toBe(1);
  expect(events[0]!.id).toBe("event-complete-1");

  // Critical: newOffset should point to just after the complete line (including newline)
  // NOT to buffer.length which would include the partial line
  // This ensures the partial line will be re-read when it's completed
  const fileContent = readFileSync(eventsPath);
  expect(newOffset).toBeLessThan(fileContent.length);
});

test("readActions returns offset at last complete newline, not buffer end", () => {
  initBusDir(TEST_WORKTREE);

  // Write a complete action
  const action1: Action = {
    id: "action-complete-1",
    type: "respond",
    target: { target: "github-pr", token: { prNumber: 123 } },
    payload: { type: "comment", message: "Complete action" },
  };
  appendAction(TEST_WORKTREE, action1);

  // Now simulate a partial write by appending incomplete JSON without newline
  const actionsPath = join(getBusDir(TEST_WORKTREE), "actions.jsonl");
  const partialJson = '{"ts":"2026-01-10","kind":"action","schemaVersion":1,"data":{"id":"partial"';
  writeFileSync(actionsPath, readFileSync(actionsPath) + partialJson);

  // Read actions - should only get the complete action
  const { actions, newOffset } = readActions(TEST_WORKTREE, 0);

  expect(actions.length).toBe(1);
  expect(actions[0]!.id).toBe("action-complete-1");

  // Critical: newOffset should NOT include the partial line
  const fileContent = readFileSync(actionsPath);
  expect(newOffset).toBeLessThan(fileContent.length);
});

test("partial line at end of file does not cause data loss on subsequent read", () => {
  initBusDir(TEST_WORKTREE);

  // Write complete event
  const event1: Event = {
    id: "event-1",
    source: "test",
    type: "test",
    severity: "info",
    title: "Event 1",
    body: "Body 1",
  };
  appendEvent(TEST_WORKTREE, event1);

  // Simulate partial write
  const eventsPath = join(getBusDir(TEST_WORKTREE), "events.jsonl");
  const partialJson = '{"ts":"2026-01-10","kind":"event","schemaVersion":1,"data":{"id":"event-2"';
  writeFileSync(eventsPath, readFileSync(eventsPath) + partialJson);

  // First read - get complete event and offset
  const { events: read1, newOffset: offset1 } = readEvents(TEST_WORKTREE, 0);
  expect(read1.length).toBe(1);
  expect(read1[0]!.id).toBe("event-1");

  // Now "complete" the partial line by appending the rest
  const restOfJson = ',"source":"test","type":"test","severity":"info","title":"Event 2","body":"Body 2"}}\n';
  writeFileSync(eventsPath, readFileSync(eventsPath) + restOfJson);

  // Second read from offset1 - should now get the completed event-2
  const { events: read2 } = readEvents(TEST_WORKTREE, offset1);
  expect(read2.length).toBe(1);
  expect(read2[0]!.id).toBe("event-2");
});

test("empty file returns offset 0", () => {
  initBusDir(TEST_WORKTREE);

  const { events, newOffset } = readEvents(TEST_WORKTREE, 0);

  expect(events).toEqual([]);
  expect(newOffset).toBe(0);
});

test("file with only whitespace returns offset at end", () => {
  initBusDir(TEST_WORKTREE);

  const eventsPath = join(getBusDir(TEST_WORKTREE), "events.jsonl");
  writeFileSync(eventsPath, "   \n\n   \n");

  const { events, newOffset } = readEvents(TEST_WORKTREE, 0);

  expect(events).toEqual([]);
  // Whitespace-only lines are valid - offset should advance past them
  expect(newOffset).toBeGreaterThan(0);
});

// =============================================================================
// Dispatcher State Default Tests
// =============================================================================

test("loadDispatcherState returns actionsOffset in defaults", () => {
  initBusDir(TEST_WORKTREE);

  const state = loadDispatcherState(TEST_WORKTREE);

  expect(state.eventsOffset).toBe(0);
  expect(state.actionsOffset).toBe(0);
  expect(state.processedEventIds).toEqual([]);
});

test("saveDispatcherState preserves actionsOffset", () => {
  initBusDir(TEST_WORKTREE);

  const state: DispatcherBusState = {
    eventsOffset: 100,
    actionsOffset: 200,
    processedEventIds: ["e1"],
  };

  saveDispatcherState(TEST_WORKTREE, state);
  const loaded = loadDispatcherState(TEST_WORKTREE);

  expect(loaded.eventsOffset).toBe(100);
  expect(loaded.actionsOffset).toBe(200);
  expect(loaded.processedEventIds).toEqual(["e1"]);
});

test("eventsOffset and actionsOffset are tracked independently", () => {
  initBusDir(TEST_WORKTREE);

  // Simulate: events and actions have different offsets
  const state: DispatcherBusState = {
    eventsOffset: 500,
    actionsOffset: 1200,
    processedEventIds: [],
  };

  saveDispatcherState(TEST_WORKTREE, state);

  // Add more events
  appendEvent(TEST_WORKTREE, {
    id: "new-event",
    source: "test",
    type: "test",
    severity: "info",
    title: "New",
    body: "body",
  });

  // Add more actions
  appendAction(TEST_WORKTREE, {
    id: "new-action",
    type: "respond",
    target: { target: "github-pr", token: { prNumber: 1 } },
    payload: { type: "comment", message: "msg" },
  });

  // Load state - offsets should be unchanged
  const loaded = loadDispatcherState(TEST_WORKTREE);
  expect(loaded.eventsOffset).toBe(500);
  expect(loaded.actionsOffset).toBe(1200);
});
