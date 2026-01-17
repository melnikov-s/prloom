/**
 * GitHub Review Provider
 *
 * Wraps the existing GitHub bridge for review feedback.
 * See RFC: docs/rfc-review-providers.md
 */

import type {
  ReviewProvider,
  ReviewProviderContext,
  ReviewItem,
  ReviewGitHubConfig,
} from "./types.js";
import type { BridgeContext, JsonValue } from "../bus/types.js";
import { githubBridge } from "../bus/bridges/github.js";

// =============================================================================
// GitHub Review Provider Implementation
// =============================================================================

/**
 * GitHub review provider - wraps the existing GitHub bridge.
 * Uses the bridge internally for polling and replies.
 */
export const githubReviewProvider: ReviewProvider = {
  name: "github",

  async poll(
    ctx: ReviewProviderContext,
    state: Record<string, unknown> | undefined
  ): Promise<{ items: ReviewItem[]; state: Record<string, unknown> }> {
    // Convert ReviewProviderContext to BridgeContext
    const bridgeCtx: BridgeContext = {
      repoRoot: ctx.repoRoot,
      worktree: ctx.worktree,
      // GitHub bridge needs changeRequestRef (PR number) from plan state
      // This will be injected by the dispatcher when calling the provider
      changeRequestRef: (ctx.config as { prNumber?: string })?.prNumber,
      config: ctx.config as JsonValue,
      log: ctx.log,
    };

    // Delegate to GitHub bridge
    const result = await githubBridge.events(bridgeCtx, state as JsonValue);

    // Convert bridge events to ReviewItems
    const items: ReviewItem[] = result.events.map((event) => {
      const context = event.context ?? {};
      return {
        id: context.feedbackId as string | number ?? event.id,
        author: context.author as string ?? "unknown",
        body: event.body,
        createdAt: context.createdAt as string ?? new Date().toISOString(),
        path: context.path as string | undefined,
        line: context.line as number | undefined,
        side: context.side as "left" | "right" | undefined,
        diffHunk: context.diffHunk as string | undefined,
        reviewState: context.reviewState as string | undefined,
      };
    });

    return {
      items,
      state: result.state as Record<string, unknown>,
    };
  },

  async respond(
    ctx: ReviewProviderContext,
    response: { message: string; relatedItemId?: string | number }
  ): Promise<{ success: true } | { success: false; error: string }> {
    // Convert to bridge action
    const bridgeCtx: BridgeContext = {
      repoRoot: ctx.repoRoot,
      worktree: ctx.worktree,
      changeRequestRef: (ctx.config as { prNumber?: string })?.prNumber,
      config: ctx.config as JsonValue,
      log: ctx.log,
    };

    const prNumber = parseInt(
      (ctx.config as { prNumber?: string })?.prNumber ?? "",
      10
    );

    if (!prNumber || isNaN(prNumber)) {
      return {
        success: false,
        error: "No PR number available for GitHub response",
      };
    }

    // Create a respond action
    const action = {
      id: `review-respond-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "respond" as const,
      target: {
        target: "github-pr",
        token: { prNumber },
      },
      payload: {
        type: "comment" as const,
        message: response.message,
      },
      relatedEventId: response.relatedItemId?.toString(),
    };

    const result = await githubBridge.actions(bridgeCtx, action);

    if (result.success) {
      return { success: true };
    }

    return {
      success: false,
      error: result.error,
    };
  },
};

// =============================================================================
// Export
// =============================================================================

export default githubReviewProvider;
