import { test, expect, spyOn } from "bun:test";
import { dispatcherEvents } from "../../src/lib/events.js";
import { formatEventPlanRef } from "../../src/lib/events.js";
import type { State } from "../../src/lib/state.js";

// We can't easily test the internal createLogger from dispatcher.ts
// but we can test that dispatcherEvents.log actually works
// as it's what we now rely on strictly.

test("dispatcherEvents: logs and emits updates", () => {
  const updateSpy = spyOn(dispatcherEvents, "emit");

  dispatcherEvents.info("test message", "plan-123");

  const events = dispatcherEvents.getEvents();
  expect(events).toHaveLength(1);
  expect(events[0]!.message).toBe("test message");
  expect(events[0]!.planId).toBe("plan-123");
  expect(events[0]!.type).toBe("info");

  // Verify emit was called (for update and event)
  expect(updateSpy).toHaveBeenCalled();
});

test("dispatcherEvents: maintains max events", () => {
  // Clear events first
  dispatcherEvents.start();

  for (let i = 0; i < 110; i++) {
    dispatcherEvents.info(`msg ${i}`);
  }

  const events = dispatcherEvents.getEvents();
  expect(events.length).toBeLessThanOrEqual(100);
  expect(events[0]!.message).toBe("msg 109");
});

test("formatEventPlanRef: formats branch name with plan ID in brackets", () => {
  const state: State = {
    control_cursor: 0,
    plans: {
      "abc12": { status: "active", branch: "fix-bug-123" },
      "xyz78": { status: "review", branch: "feature-new-ui" },
    },
  };

  expect(formatEventPlanRef(state, "abc12")).toBe("fix-bug-123 (abc12)");
  expect(formatEventPlanRef(state, "xyz78")).toBe("feature-new-ui (xyz78)");
});

test("formatEventPlanRef: falls back to plan ID when branch is missing", () => {
  const state: State = {
    control_cursor: 0,
    plans: {
      "abc12": { status: "draft" }, // no branch set yet
    },
  };

  expect(formatEventPlanRef(state, "abc12")).toBe("abc12");
});

test("formatEventPlanRef: handles missing plan ID", () => {
  const state: State = {
    control_cursor: 0,
    plans: {},
  };

  expect(formatEventPlanRef(state, undefined)).toBe("");
  expect(formatEventPlanRef(state, "nonexistent")).toBe("");
});
