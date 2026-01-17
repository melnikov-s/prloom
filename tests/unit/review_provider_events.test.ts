/**
 * Review Provider Events Tests
 *
 * Tests for converting review items to bus events.
 */

import { describe, test, expect } from "bun:test";

import { reviewItemToEvent } from "../../src/lib/review/events.js";
import type { ReviewItem } from "../../src/lib/review/types.js";

// =============================================================================
// reviewItemToEvent Tests
// =============================================================================

describe("reviewItemToEvent", () => {
  test("converts review item to bus event", () => {
    const item: ReviewItem = {
      id: "hash123",
      author: "user",
      body: "Add input validation",
      createdAt: "2026-01-16T12:00:00Z",
      path: "src/form.ts",
      line: 42,
      side: "right",
    };

    const event = reviewItemToEvent(item, "local");

    expect(event.id).toBe("review-local-hash123");
    expect(event.source).toBe("review:local");
    expect(event.type).toBe("review_feedback");
    expect(event.severity).toBe("info");
    expect(event.title).toBe("Review from user");
    expect(event.body).toBe("Add input validation");
    expect(event.context?.provider).toBe("local");
    expect(event.context?.itemId).toBe("hash123");
    expect(event.context?.path).toBe("src/form.ts");
    expect(event.context?.line).toBe(42);
    expect(event.context?.side).toBe("right");
  });

  test("includes review state when present", () => {
    const item: ReviewItem = {
      id: 123,
      author: "reviewer",
      body: "Please fix this",
      createdAt: "2026-01-16T12:00:00Z",
      path: "src/api.ts",
      line: 100,
      reviewState: "changes_requested",
    };

    const event = reviewItemToEvent(item, "github");

    expect(event.context?.reviewState).toBe("changes_requested");
  });

  test("includes diff hunk when present", () => {
    const item: ReviewItem = {
      id: "abc",
      author: "reviewer",
      body: "Typo here",
      createdAt: "2026-01-16T12:00:00Z",
      path: "src/utils.ts",
      line: 10,
      diffHunk: "@@ -8,6 +8,7 @@ function foo() {",
    };

    const event = reviewItemToEvent(item, "github");

    expect(event.context?.diffHunk).toBe("@@ -8,6 +8,7 @@ function foo() {");
  });

  test("omits optional fields when not present", () => {
    const item: ReviewItem = {
      id: "minimal",
      author: "local",
      body: "Simple comment",
      createdAt: "2026-01-16T12:00:00Z",
    };

    const event = reviewItemToEvent(item, "local");

    expect(event.context?.path).toBeUndefined();
    expect(event.context?.line).toBeUndefined();
    expect(event.context?.side).toBeUndefined();
    expect(event.context?.diffHunk).toBeUndefined();
    expect(event.context?.reviewState).toBeUndefined();
  });

  test("handles numeric IDs", () => {
    const item: ReviewItem = {
      id: 12345,
      author: "user",
      body: "Comment",
      createdAt: "2026-01-16T12:00:00Z",
    };

    const event = reviewItemToEvent(item, "github");

    expect(event.id).toBe("review-github-12345");
    expect(event.context?.itemId).toBe(12345);
  });

  test("preserves createdAt in context", () => {
    const item: ReviewItem = {
      id: "test",
      author: "user",
      body: "Comment",
      createdAt: "2026-01-16T15:30:00Z",
    };

    const event = reviewItemToEvent(item, "local");

    expect(event.context?.createdAt).toBe("2026-01-16T15:30:00Z");
  });

  test("sets reply address for local provider (no reply)", () => {
    const item: ReviewItem = {
      id: "local-item",
      author: "local",
      body: "Local comment",
      createdAt: "2026-01-16T12:00:00Z",
      path: "src/file.ts",
      line: 10,
    };

    const event = reviewItemToEvent(item, "local");

    // Local provider doesn't set a reply address (no external replies)
    expect(event.replyTo).toBeUndefined();
  });
});
