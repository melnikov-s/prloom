/**
 * Review Provider Types
 *
 * Core types for the review provider abstraction.
 * See RFC: docs/rfc-review-providers.md
 */

import type { BridgeLogger, JsonValue } from "../bus/types.js";

// =============================================================================
// Review Provider Context
// =============================================================================

export interface ReviewProviderContext {
  repoRoot: string;
  worktree: string;
  planId: string;
  config?: unknown;
  log: BridgeLogger;
}

// =============================================================================
// Review Item
// =============================================================================

export interface ReviewItem {
  id: string | number;
  author: string;
  body: string;
  createdAt: string; // ISO
  path?: string;
  line?: number;
  side?: "left" | "right";
  diffHunk?: string;
  reviewState?: string;
}

// =============================================================================
// Review Provider Interface
// =============================================================================

export interface ReviewProvider {
  name: string;

  poll: (
    ctx: ReviewProviderContext,
    state: Record<string, unknown> | undefined
  ) => Promise<{ items: ReviewItem[]; state: Record<string, unknown> }>;

  respond?: (
    ctx: ReviewProviderContext,
    response: { message: string; relatedItemId?: string | number }
  ) => Promise<{ success: true } | { success: false; error: string }>;
}

// =============================================================================
// Review Provider State
// =============================================================================

export interface LocalProviderState {
  /** Last poll time (for rate limiting) */
  lastPollTime?: number;
  /** Hashes of processed ready items (for dedupe) */
  processedHashes?: string[];
}

// =============================================================================
// Local Review Item (parsed from review.md)
// =============================================================================

export interface LocalReviewItem {
  text: string;
  file: string;
  line: number;
  side: "left" | "right";
  checked: boolean;
}

// =============================================================================
// Review Config Types (for prloom/config.json)
// =============================================================================

export type ReviewProviderName = "github" | "local" | "custom";

export interface ReviewLocalConfig {
  pollIntervalMs?: number;
}

export interface ReviewGitHubConfig {
  pollIntervalMs?: number;
}

export interface ReviewCustomConfig {
  module: string;
  pollIntervalMs?: number;
  config?: unknown;
}

export interface ReviewConfig {
  provider: ReviewProviderName;
  local?: ReviewLocalConfig;
  github?: ReviewGitHubConfig;
  custom?: ReviewCustomConfig;
}
