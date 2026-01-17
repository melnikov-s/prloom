/**
 * Review Provider Configuration
 *
 * Configuration parsing and resolution for review providers.
 * See RFC: docs/rfc-review-providers.md
 */

import type { Config } from "../config.js";
import type {
  ReviewConfig,
  ReviewProviderName,
  ReviewLocalConfig,
  ReviewGitHubConfig,
  ReviewCustomConfig,
} from "./types.js";

// =============================================================================
// Valid Provider Names
// =============================================================================

const VALID_PROVIDERS: ReviewProviderName[] = ["github", "local", "custom"];

function isValidProvider(value: unknown): value is ReviewProviderName {
  return typeof value === "string" && VALID_PROVIDERS.includes(value as ReviewProviderName);
}

// =============================================================================
// Parse Review Config
// =============================================================================

/**
 * Parse review configuration from raw config object.
 * Returns undefined if review config is not present or invalid.
 */
export function parseReviewConfig(raw: unknown): ReviewConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;

  if (!isValidProvider(obj.provider)) {
    return undefined;
  }

  const config: ReviewConfig = {
    provider: obj.provider,
  };

  // Parse provider-specific config
  if (obj.provider === "local" && obj.local) {
    config.local = parseLocalConfig(obj.local);
  }

  if (obj.provider === "github" && obj.github) {
    config.github = parseGitHubConfig(obj.github);
  }

  if (obj.provider === "custom" && obj.custom) {
    config.custom = parseCustomConfig(obj.custom);
  }

  return config;
}

function parseLocalConfig(raw: unknown): ReviewLocalConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const config: ReviewLocalConfig = {};

  if (typeof obj.pollIntervalMs === "number") {
    config.pollIntervalMs = obj.pollIntervalMs;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function parseGitHubConfig(raw: unknown): ReviewGitHubConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const config: ReviewGitHubConfig = {};

  if (typeof obj.pollIntervalMs === "number") {
    config.pollIntervalMs = obj.pollIntervalMs;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function parseCustomConfig(raw: unknown): ReviewCustomConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const config: ReviewCustomConfig = {
    module: typeof obj.module === "string" ? obj.module : "",
  };

  if (typeof obj.pollIntervalMs === "number") {
    config.pollIntervalMs = obj.pollIntervalMs;
  }

  if (obj.config !== undefined) {
    config.config = obj.config;
  }

  return config;
}

// =============================================================================
// Get Active Review Provider
// =============================================================================

/**
 * Get the active review provider name from config.
 * Falls back to "github" for backwards compatibility.
 */
export function getActiveReviewProvider(config: Config): ReviewProviderName {
  if (config.review?.provider) {
    return config.review.provider;
  }

  // Backwards compatible: default to github
  return "github";
}

// =============================================================================
// Derive GitHub Enabled
// =============================================================================

/**
 * Determine if GitHub integration should be enabled based on review config.
 * Per RFC: If review is present, derive github.enabled from the provider.
 */
export function deriveGitHubEnabled(config: Config): boolean {
  if (!config.review) {
    // No review config - use existing github.enabled
    return config.github.enabled;
  }

  // Review config present - github is enabled only if provider is github
  return config.review.provider === "github";
}

// =============================================================================
// Validate Config
// =============================================================================

export interface ConfigValidationWarning {
  code: string;
  message: string;
}

/**
 * Validate review config and return any warnings.
 */
export function validateReviewConfig(config: Config): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Warn if both review and bridges.github are configured
  if (config.review && config.bridges.github?.enabled) {
    warnings.push({
      code: "REVIEW_BRIDGES_CONFLICT",
      message:
        "Both review.provider and bridges.github are configured. " +
        "review.provider takes precedence. Consider removing bridges.github.",
    });
  }

  // Warn if custom provider is missing module
  if (config.review?.provider === "custom" && !config.review.custom?.module) {
    warnings.push({
      code: "CUSTOM_PROVIDER_NO_MODULE",
      message: "review.provider is 'custom' but review.custom.module is not specified.",
    });
  }

  return warnings;
}
