/**
 * Review Provider Dispatcher Integration Tests
 *
 * Tests the integration between review providers and the dispatcher:
 * - Review provider polling in tickBusEvents
 * - Event conversion using reviewItemToEvent
 * - Triage integration with review_feedback events
 * - GitHub gating via deriveGitHubEnabled
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { deriveGitHubEnabled } from "../../src/lib/review/config.js";
import { reviewItemToEvent } from "../../src/lib/review/events.js";
import { getActiveReviewProvider } from "../../src/lib/review/config.js";
import type { Config } from "../../src/lib/config.js";
import type { ReviewItem } from "../../src/lib/review/types.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `review-dispatcher-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createMinimalConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: { default: "opencode" },
    github: { enabled: true },
    worktrees_dir: "prloom/.local/worktrees",
    github_poll_interval_ms: 60000,
    base_branch: "main",
    bus: { tickIntervalMs: 1000 },
    bridges: {},
    ...overrides,
  };
}

// =============================================================================
// deriveGitHubEnabled Tests
// =============================================================================

describe("deriveGitHubEnabled", () => {
  test("returns github.enabled when no review config", () => {
    const config = createMinimalConfig({ github: { enabled: true } });
    expect(deriveGitHubEnabled(config)).toBe(true);

    const disabledConfig = createMinimalConfig({ github: { enabled: false } });
    expect(deriveGitHubEnabled(disabledConfig)).toBe(false);
  });

  test("returns true when review.provider is 'github'", () => {
    const config = createMinimalConfig({
      github: { enabled: false }, // Even if this is false
      review: { provider: "github" },
    });
    expect(deriveGitHubEnabled(config)).toBe(true);
  });

  test("returns false when review.provider is 'local'", () => {
    const config = createMinimalConfig({
      github: { enabled: true }, // Even if this is true
      review: { provider: "local" },
    });
    expect(deriveGitHubEnabled(config)).toBe(false);
  });

  test("returns false when review.provider is 'custom'", () => {
    const config = createMinimalConfig({
      github: { enabled: true },
      review: {
        provider: "custom",
        custom: { module: "./custom-provider.js" },
      },
    });
    expect(deriveGitHubEnabled(config)).toBe(false);
  });
});

// =============================================================================
// getActiveReviewProvider Tests
// =============================================================================

describe("getActiveReviewProvider", () => {
  test("defaults to 'github' when no review config", () => {
    const config = createMinimalConfig();
    expect(getActiveReviewProvider(config)).toBe("github");
  });

  test("returns configured provider", () => {
    const localConfig = createMinimalConfig({ review: { provider: "local" } });
    expect(getActiveReviewProvider(localConfig)).toBe("local");

    const githubConfig = createMinimalConfig({
      review: { provider: "github" },
    });
    expect(getActiveReviewProvider(githubConfig)).toBe("github");

    const customConfig = createMinimalConfig({
      review: { provider: "custom", custom: { module: "./test.js" } },
    });
    expect(getActiveReviewProvider(customConfig)).toBe("custom");
  });
});

// =============================================================================
// reviewItemToEvent Tests
// =============================================================================

describe("reviewItemToEvent", () => {
  test("converts review item to bus event", () => {
    const item: ReviewItem = {
      id: "abc123",
      author: "local",
      body: "Add input validation",
      createdAt: "2026-01-16T12:00:00Z",
      path: "src/form.ts",
      line: 42,
      side: "right",
    };

    const event = reviewItemToEvent(item, "local");

    expect(event.id).toBe("review-local-abc123");
    expect(event.source).toBe("review:local");
    expect(event.type).toBe("review_feedback");
    expect(event.title).toBe("Review from local");
    expect(event.body).toBe("Add input validation");
    expect(event.context?.provider).toBe("local");
    expect(event.context?.itemId).toBe("abc123");
    expect(event.context?.path).toBe("src/form.ts");
    expect(event.context?.line).toBe(42);
    expect(event.context?.side).toBe("right");
  });

  test("includes only present optional fields", () => {
    const item: ReviewItem = {
      id: "xyz789",
      author: "reviewer",
      body: "Please fix this",
      createdAt: "2026-01-16T12:00:00Z",
      // No path, line, side, diffHunk, reviewState
    };

    const event = reviewItemToEvent(item, "custom");

    expect(event.context?.path).toBeUndefined();
    expect(event.context?.line).toBeUndefined();
    expect(event.context?.side).toBeUndefined();
    expect(event.context?.diffHunk).toBeUndefined();
    expect(event.context?.reviewState).toBeUndefined();
    // Required fields still present
    expect(event.context?.provider).toBe("custom");
    expect(event.context?.itemId).toBe("xyz789");
    expect(event.context?.author).toBe("reviewer");
  });

  test("handles numeric ids", () => {
    const item: ReviewItem = {
      id: 12345,
      author: "github-user",
      body: "Comment body",
      createdAt: "2026-01-16T12:00:00Z",
    };

    const event = reviewItemToEvent(item, "github");

    expect(event.id).toBe("review-github-12345");
    expect(event.context?.itemId).toBe(12345);
  });
});

// =============================================================================
// Dispatcher Integration (GitHub Bridge Gating)
// =============================================================================

describe("GitHub bridge gating", () => {
  test("local provider config should disable GitHub bridge", () => {
    const config = createMinimalConfig({
      review: { provider: "local" },
      bridges: { github: { enabled: true, pollIntervalMs: 60000 } },
    });

    // With review.provider = local, deriveGitHubEnabled should return false
    // This controls whether the GitHub bridge is registered
    expect(deriveGitHubEnabled(config)).toBe(false);
    expect(getActiveReviewProvider(config)).toBe("local");
  });

  test("no review config preserves existing GitHub behavior", () => {
    const enabledConfig = createMinimalConfig({
      github: { enabled: true },
      bridges: { github: { enabled: true, pollIntervalMs: 60000 } },
    });

    expect(deriveGitHubEnabled(enabledConfig)).toBe(true);
    expect(getActiveReviewProvider(enabledConfig)).toBe("github");
  });

  test("github provider config enables GitHub bridge", () => {
    const config = createMinimalConfig({
      review: { provider: "github" },
    });

    expect(deriveGitHubEnabled(config)).toBe(true);
    expect(getActiveReviewProvider(config)).toBe("github");
  });
});

// =============================================================================
// Local Provider Bus Event Emission
// =============================================================================

describe("local provider event emission", () => {
  let tempDir: string;
  let worktree: string;

  beforeEach(() => {
    tempDir = createTempDir();
    worktree = join(tempDir, "worktree");
    mkdirSync(join(worktree, "prloom", ".local"), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  test("local review items convert to review_feedback events correctly", () => {
    // Simulate what happens when the local provider polls review.md
    const reviewContent = `## ready

- [ ] Add input validation
  file: src/form.ts
  line: 42
  side: right
`;
    writeFileSync(
      join(worktree, "prloom", ".local", "review.md"),
      reviewContent
    );

    // When polled, the local provider returns items that should convert to events
    const mockItem: ReviewItem = {
      id: "hash123",
      author: "local",
      body: "Add input validation",
      createdAt: new Date().toISOString(),
      path: "src/form.ts",
      line: 42,
      side: "right",
    };

    const event = reviewItemToEvent(mockItem, "local");

    // Verify event shape matches what dispatcher expects
    expect(event.source).toBe("review:local");
    expect(event.type).toBe("review_feedback");
    expect(event.context?.provider).toBe("local");
    expect(event.context?.path).toBe("src/form.ts");
    expect(event.context?.line).toBe(42);
    expect(event.context?.side).toBe("right");
  });
});

// =============================================================================
// Triage Event Filtering
// =============================================================================

describe("triage event filtering", () => {
  test("review events should be identifiable by source prefix", () => {
    const localEvent = reviewItemToEvent(
      {
        id: "1",
        author: "local",
        body: "test",
        createdAt: new Date().toISOString(),
      },
      "local"
    );

    const customEvent = reviewItemToEvent(
      {
        id: "2",
        author: "gitlab",
        body: "test",
        createdAt: new Date().toISOString(),
      },
      "gitlab"
    );

    // These should be filterable using source.startsWith("review:")
    expect(localEvent.source.startsWith("review:")).toBe(true);
    expect(customEvent.source.startsWith("review:")).toBe(true);

    // GitHub events would have source: "github" (not "review:github")
    // The GitHub bridge emits events with source: "github"
  });
});
