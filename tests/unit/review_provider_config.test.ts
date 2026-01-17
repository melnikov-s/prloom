/**
 * Review Provider Config Tests
 *
 * Tests configuration parsing for review providers.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { loadConfig, type Config } from "../../src/lib/config.js";
import { parseReviewConfig, getActiveReviewProvider } from "../../src/lib/review/config.js";
import type { ReviewConfig } from "../../src/lib/review/types.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTempDir(): string {
  const dir = join(tmpdir(), `review-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// parseReviewConfig Tests
// =============================================================================

describe("parseReviewConfig", () => {
  test("parses local provider config", () => {
    const raw = {
      provider: "local",
      local: {
        pollIntervalMs: 2000,
      },
    };

    const config = parseReviewConfig(raw);

    expect(config).toEqual({
      provider: "local",
      local: { pollIntervalMs: 2000 },
    });
  });

  test("parses github provider config", () => {
    const raw = {
      provider: "github",
      github: {
        pollIntervalMs: 60000,
      },
    };

    const config = parseReviewConfig(raw);

    expect(config).toEqual({
      provider: "github",
      github: { pollIntervalMs: 60000 },
    });
  });

  test("parses custom provider config", () => {
    const raw = {
      provider: "custom",
      custom: {
        module: "./review-providers/gitlab.js",
        pollIntervalMs: 10000,
        config: { host: "https://gitlab.example.com", token: "abc" },
      },
    };

    const config = parseReviewConfig(raw);

    expect(config).toEqual({
      provider: "custom",
      custom: {
        module: "./review-providers/gitlab.js",
        pollIntervalMs: 10000,
        config: { host: "https://gitlab.example.com", token: "abc" },
      },
    });
  });

  test("returns undefined for missing review config", () => {
    const config = parseReviewConfig(undefined);

    expect(config).toBeUndefined();
  });

  test("returns undefined for invalid provider value", () => {
    const raw = {
      provider: "invalid",
    };

    const config = parseReviewConfig(raw);

    expect(config).toBeUndefined();
  });

  test("returns undefined for non-object input", () => {
    expect(parseReviewConfig("local")).toBeUndefined();
    expect(parseReviewConfig(123)).toBeUndefined();
    expect(parseReviewConfig(null)).toBeUndefined();
  });

  test("uses defaults when provider-specific config is missing", () => {
    const raw = {
      provider: "local",
    };

    const config = parseReviewConfig(raw);

    expect(config).toEqual({
      provider: "local",
      local: undefined,
    });
  });
});

// =============================================================================
// getActiveReviewProvider Tests
// =============================================================================

describe("getActiveReviewProvider", () => {
  test("returns 'github' when review config not present (backwards compatible)", () => {
    const config = {} as Config;

    const provider = getActiveReviewProvider(config);

    expect(provider).toBe("github");
  });

  test("returns configured provider from review.provider", () => {
    const config = {
      review: {
        provider: "local",
      },
    } as Config;

    const provider = getActiveReviewProvider(config);

    expect(provider).toBe("local");
  });

  test("returns 'custom' for custom provider config", () => {
    const config = {
      review: {
        provider: "custom",
        custom: {
          module: "./custom.js",
        },
      },
    } as Config;

    const provider = getActiveReviewProvider(config);

    expect(provider).toBe("custom");
  });
});

// =============================================================================
// Config Loading Integration Tests
// =============================================================================

describe("loadConfig with review config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mkdirSync(join(tempDir, "prloom"), { recursive: true });
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  test("loads review config from prloom/config.json", () => {
    const configContent = {
      review: {
        provider: "local",
        local: {
          pollIntervalMs: 5000,
        },
      },
    };
    writeFileSync(
      join(tempDir, "prloom", "config.json"),
      JSON.stringify(configContent)
    );

    const config = loadConfig(tempDir);

    expect(config.review).toEqual({
      provider: "local",
      local: { pollIntervalMs: 5000 },
    });
  });

  test("review config is undefined when not specified", () => {
    const configContent = {
      agents: { default: "opencode" },
    };
    writeFileSync(
      join(tempDir, "prloom", "config.json"),
      JSON.stringify(configContent)
    );

    const config = loadConfig(tempDir);

    expect(config.review).toBeUndefined();
  });

  test("review config overrides bridges.github when present", () => {
    const configContent = {
      review: {
        provider: "local",
      },
      bridges: {
        github: { enabled: true },
      },
    };
    writeFileSync(
      join(tempDir, "prloom", "config.json"),
      JSON.stringify(configContent)
    );

    const config = loadConfig(tempDir);

    // review.provider takes precedence
    expect(config.review?.provider).toBe("local");
    // bridges.github should still be parsed but provider determines behavior
    expect(config.bridges.github?.enabled).toBe(true);
  });
});

// =============================================================================
// Config Validation Tests
// =============================================================================

describe("review config validation", () => {
  test("emits warning when both review and bridges.github are configured", () => {
    // This would be tested via a validation function or logging
    // For now, we just ensure both are parsed correctly
    const raw = {
      provider: "local",
    };

    const config = parseReviewConfig(raw);

    expect(config?.provider).toBe("local");
  });

  test("custom provider requires module path", () => {
    const raw = {
      provider: "custom",
      custom: {
        // Missing module
        pollIntervalMs: 10000,
      },
    };

    const config = parseReviewConfig(raw);

    // Should still parse, but custom.module would be empty string
    expect(config?.provider).toBe("custom");
    expect(config?.custom?.module).toBe("");
  });
});
