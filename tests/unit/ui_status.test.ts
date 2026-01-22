import { test, expect } from "bun:test";
import { getStatusColor, getStatusEmoji } from "../../src/ui/App.js";

test("getStatusColor returns correct color for all valid statuses", () => {
  expect(getStatusColor("draft")).toBe("yellowBright");
  expect(getStatusColor("queued")).toBe("yellow");
  expect(getStatusColor("active")).toBe("green");
  expect(getStatusColor("paused")).toBe("blue");
  expect(getStatusColor("review")).toBe("cyan");
  expect(getStatusColor("triaging")).toBe("magenta");
  expect(getStatusColor("done")).toBe("gray");
});

test("getStatusColor returns red for blocked plans", () => {
  expect(getStatusColor("active", true)).toBe("red");
  expect(getStatusColor("review", true)).toBe("red");
  expect(getStatusColor("triaging", true)).toBe("red");
});

test("getStatusColor returns white for unknown status", () => {
  expect(getStatusColor("unknown")).toBe("white");
  expect(getStatusColor("invalid")).toBe("white");
});

test("getStatusEmoji returns correct emoji for all valid statuses", () => {
  expect(getStatusEmoji("draft")).toBe("📝");
  expect(getStatusEmoji("queued")).toBe("🟡");
  expect(getStatusEmoji("active")).toBe("🟢");
  expect(getStatusEmoji("paused")).toBe("⏸️");
  expect(getStatusEmoji("review")).toBe("👀");
  expect(getStatusEmoji("triaging")).toBe("🔍");
  expect(getStatusEmoji("done")).toBe("✅");
});

test("getStatusEmoji returns red circle for blocked plans", () => {
  expect(getStatusEmoji("active", true)).toBe("🔴");
  expect(getStatusEmoji("review", true)).toBe("🔴");
  expect(getStatusEmoji("triaging", true)).toBe("🔴");
});

test("getStatusEmoji returns white circle for unknown status", () => {
  expect(getStatusEmoji("unknown")).toBe("⚪");
  expect(getStatusEmoji("invalid")).toBe("⚪");
});
