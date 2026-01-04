import { test, expect } from "bun:test";
import { getFeedbackPollDecision } from "../../src/lib/dispatcher.js";

test("getFeedbackPollDecision polls when pollOnce set", () => {
  const decision = getFeedbackPollDecision({
    now: Date.parse("2026-01-04T00:00:10Z"),
    pollIntervalMs: 60000,
    lastPolledAt: "2026-01-04T00:00:09Z",
    pollOnce: true,
  });

  expect(decision.shouldPoll).toBe(true);
  expect(decision.clearPollOnce).toBe(true);
  expect(decision.shouldUpdateLastPolledAt).toBe(false);
});

test("getFeedbackPollDecision does not poll before interval", () => {
  const decision = getFeedbackPollDecision({
    now: Date.parse("2026-01-04T00:00:10Z"),
    pollIntervalMs: 60000,
    lastPolledAt: "2026-01-04T00:00:00Z",
    pollOnce: false,
  });

  expect(decision.shouldPoll).toBe(false);
  expect(decision.clearPollOnce).toBe(false);
  expect(decision.shouldUpdateLastPolledAt).toBe(false);
});

test("getFeedbackPollDecision polls after interval and updates schedule", () => {
  const decision = getFeedbackPollDecision({
    now: Date.parse("2026-01-04T00:01:10Z"),
    pollIntervalMs: 60000,
    lastPolledAt: "2026-01-04T00:00:00Z",
    pollOnce: false,
  });

  expect(decision.shouldPoll).toBe(true);
  expect(decision.clearPollOnce).toBe(false);
  expect(decision.shouldUpdateLastPolledAt).toBe(true);
});

test("getFeedbackPollDecision treats invalid lastPolledAt as 0", () => {
  const decision = getFeedbackPollDecision({
    now: Date.parse("2026-01-04T00:00:10Z"),
    pollIntervalMs: 1000,
    lastPolledAt: "not-a-date",
    pollOnce: false,
  });

  expect(decision.shouldPoll).toBe(true);
  expect(decision.shouldUpdateLastPolledAt).toBe(true);
});
