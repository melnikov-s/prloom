import { test, expect, spyOn } from "bun:test";
import { dispatcherEvents } from "../../src/lib/events.js";

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
