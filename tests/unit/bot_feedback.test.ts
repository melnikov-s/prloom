import { test, expect } from "bun:test";
import {
  isBotFeedback,
  filterNewFeedback,
  type PRFeedback,
} from "../../src/lib/github.js";

test("isBotFeedback returns true when body starts with robot emoji", () => {
  const feedback: PRFeedback = {
    id: 1,
    type: "issue_comment",
    author: "some-user",
    body: "🤖 This is a bot message",
    createdAt: "2026-01-04T00:00:00Z",
  };

  expect(isBotFeedback(feedback, "other-user")).toBe(true);
});

test("isBotFeedback returns true when body starts with robot emoji after whitespace", () => {
  const feedback: PRFeedback = {
    id: 1,
    type: "issue_comment",
    author: "some-user",
    body: "  \n🤖 This is a bot message",
    createdAt: "2026-01-04T00:00:00Z",
  };

  expect(isBotFeedback(feedback, "other-user")).toBe(true);
});

test("isBotFeedback returns false for human messages without robot emoji", () => {
  const feedback: PRFeedback = {
    id: 1,
    type: "issue_comment",
    author: "some-user",
    body: "This is a human comment",
    createdAt: "2026-01-04T00:00:00Z",
  };

  expect(isBotFeedback(feedback, "other-user")).toBe(false);
});

test("isBotFeedback returns false when robot emoji is not at start", () => {
  const feedback: PRFeedback = {
    id: 1,
    type: "issue_comment",
    author: "some-user",
    body: "Hello 🤖 robot in the middle",
    createdAt: "2026-01-04T00:00:00Z",
  };

  expect(isBotFeedback(feedback, "other-user")).toBe(false);
});

test("isBotFeedback ignores author matching botLogin", () => {
  // Same author as botLogin should NOT trigger bot detection
  // Only the emoji marker matters now
  const feedback: PRFeedback = {
    id: 1,
    type: "issue_comment",
    author: "bot-user",
    body: "Human message from bot account",
    createdAt: "2026-01-04T00:00:00Z",
  };

  expect(isBotFeedback(feedback, "bot-user")).toBe(false);
});

test("filterNewFeedback excludes bot messages and includes human messages", () => {
  const feedback: PRFeedback[] = [
    {
      id: 1,
      type: "issue_comment",
      author: "user1",
      body: "🤖 Bot response",
      createdAt: "2026-01-04T00:00:00Z",
    },
    {
      id: 2,
      type: "issue_comment",
      author: "user1",
      body: "Human comment",
      createdAt: "2026-01-04T00:00:01Z",
    },
    {
      id: 3,
      type: "review_comment",
      author: "user1",
      body: "🤖 Another bot message",
      createdAt: "2026-01-04T00:00:02Z",
    },
    {
      id: 4,
      type: "review",
      author: "user1",
      body: "Human review",
      createdAt: "2026-01-04T00:00:03Z",
    },
  ];

  const result = filterNewFeedback(feedback, {}, "bot-user");

  expect(result).toHaveLength(2);
  expect(result.map((f) => f.id)).toEqual([2, 4]);
});
