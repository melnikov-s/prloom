/**
 * Review Provider Registry Tests
 *
 * Tests for the review provider registry and GitHub provider wrapper.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  ReviewProviderRegistry,
  createReviewProviderRegistry,
} from "../../src/lib/review/registry.js";
import { localProvider } from "../../src/lib/review/local.js";
import type {
  ReviewProvider,
  ReviewProviderContext,
} from "../../src/lib/review/types.js";
import type { Config } from "../../src/lib/config.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `review-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// ReviewProviderRegistry Tests
// =============================================================================

describe("ReviewProviderRegistry", () => {
  test("registers and retrieves providers by name", () => {
    const registry = new ReviewProviderRegistry();

    registry.register(localProvider);

    const provider = registry.get("local");
    expect(provider).toBe(localProvider);
  });

  test("returns undefined for unknown provider", () => {
    const registry = new ReviewProviderRegistry();

    const provider = registry.get("unknown");
    expect(provider).toBeUndefined();
  });

  test("throws when registering duplicate provider", () => {
    const registry = new ReviewProviderRegistry();

    registry.register(localProvider);

    expect(() => registry.register(localProvider)).toThrow(
      "Review provider 'local' is already registered"
    );
  });

  test("lists all registered providers", () => {
    const registry = new ReviewProviderRegistry();

    const customProvider: ReviewProvider = {
      name: "custom",
      poll: async () => ({ items: [], state: {} }),
    };

    registry.register(localProvider);
    registry.register(customProvider);

    const names = registry.list();
    expect(names).toContain("local");
    expect(names).toContain("custom");
    expect(names).toHaveLength(2);
  });
});

// =============================================================================
// createReviewProviderRegistry Tests
// =============================================================================

describe("createReviewProviderRegistry", () => {
  test("creates registry with built-in providers", async () => {
    const config: Config = {
      agents: { default: "opencode" },
      github: { enabled: true },
      worktrees_dir: "prloom/.local/worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      bus: { tickIntervalMs: 1000 },
      bridges: {},
    };

    const registry = await createReviewProviderRegistry(config);

    expect(registry.get("local")).toBeDefined();
    expect(registry.get("github")).toBeDefined();
  });

  test("returns local provider when review.provider is 'local'", async () => {
    const config: Config = {
      agents: { default: "opencode" },
      github: { enabled: true },
      worktrees_dir: "prloom/.local/worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      bus: { tickIntervalMs: 1000 },
      bridges: {},
      review: {
        provider: "local",
      },
    };

    const registry = await createReviewProviderRegistry(config);
    const activeProvider = registry.getActive(config);

    expect(activeProvider?.name).toBe("local");
  });

  test("returns github provider when review.provider is 'github'", async () => {
    const config: Config = {
      agents: { default: "opencode" },
      github: { enabled: true },
      worktrees_dir: "prloom/.local/worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      bus: { tickIntervalMs: 1000 },
      bridges: {},
      review: {
        provider: "github",
      },
    };

    const registry = await createReviewProviderRegistry(config);
    const activeProvider = registry.getActive(config);

    expect(activeProvider?.name).toBe("github");
  });

  test("returns github provider by default (backwards compatible)", async () => {
    const config: Config = {
      agents: { default: "opencode" },
      github: { enabled: true },
      worktrees_dir: "prloom/.local/worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      bus: { tickIntervalMs: 1000 },
      bridges: {},
      // No review config
    };

    const registry = await createReviewProviderRegistry(config);
    const activeProvider = registry.getActive(config);

    expect(activeProvider?.name).toBe("github");
  });
});

// =============================================================================
// Provider Mutual Exclusivity Tests
// =============================================================================

describe("provider mutual exclusivity", () => {
  test("only one provider can be active at a time", async () => {
    const config: Config = {
      agents: { default: "opencode" },
      github: { enabled: true },
      worktrees_dir: "prloom/.local/worktrees",
      github_poll_interval_ms: 60000,
      base_branch: "main",
      bus: { tickIntervalMs: 1000 },
      bridges: {},
      review: {
        provider: "local",
        local: { pollIntervalMs: 2000 },
        github: { pollIntervalMs: 60000 }, // Both configs present
      },
    };

    const registry = await createReviewProviderRegistry(config);
    const activeProvider = registry.getActive(config);

    // Only local should be active (per review.provider)
    expect(activeProvider?.name).toBe("local");
  });
});
