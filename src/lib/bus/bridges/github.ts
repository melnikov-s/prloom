/**
 * GitHub Bridge
 *
 * Full bridge for GitHub PR feedback (comments, reviews).
 * See RFC: docs/rfc-file-bus.md
 */

import type {
  FullBridge,
  BridgeContext,
  Event,
  Action,
  ActionResult,
  JsonValue,
} from "../types.js";
import {
  getPRComments,
  getPRReviews,
  getPRReviewComments,
  filterNewFeedback,
  getMaxFeedbackIds,
  postPRComment,
  submitPRReview,
  getCurrentGitHubUser,
  requestReviewers,
  mergePR,
  closePR,
  addLabels,
  removeLabels,
  assignUsers,
  setMilestone,
  type PRFeedback,
  type FeedbackCursors,
} from "../../github.js";
import { loadBridgeActionState, saveBridgeActionState } from "../manager.js";

// =============================================================================
// Constants
// =============================================================================

const BRIDGE_NAME = "github";
const TARGET_GITHUB_PR = "github-pr";

/** Default poll interval: 60 seconds (per RFC docs/rfc-file-bus.md) */
const DEFAULT_POLL_INTERVAL_MS = 60000;

// =============================================================================
// State Types
// =============================================================================

interface GitHubBridgeState {
  /** Last poll timestamp */
  lastPollTime?: number;
  /** Feedback cursors for incremental polling */
  cursors?: FeedbackCursors;
  /** Bot login for filtering */
  botLogin?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function feedbackToEvent(feedback: PRFeedback, prNumber: number): Event {
  // Determine event type based on feedback type
  let eventType: string;
  let title: string;

  switch (feedback.type) {
    case "issue_comment":
      eventType = "pr_comment";
      title = `Comment from ${feedback.author}`;
      break;
    case "review":
      eventType = "pr_review";
      title = `Review from ${feedback.author}: ${
        feedback.reviewState ?? "comment"
      }`;
      break;
    case "review_comment":
      eventType = "pr_inline_comment";
      title = `Inline comment from ${feedback.author}`;
      break;
  }

  // Build context with optional path/line for inline comments
  const context: Record<string, JsonValue> = {
    feedbackId: feedback.id,
    feedbackType: feedback.type,
    author: feedback.author,
    createdAt: feedback.createdAt,
  };

  if (feedback.path) {
    context.path = feedback.path;
  }
  if (feedback.line !== undefined) {
    context.line = feedback.line;
  }
  if (feedback.diffHunk) {
    context.diffHunk = feedback.diffHunk;
  }
  if (feedback.reviewState) {
    context.reviewState = feedback.reviewState;
  }
  if (feedback.inReplyToId) {
    context.inReplyToId = feedback.inReplyToId;
  }

  return {
    id: `github-${feedback.type}-${feedback.id}`,
    source: BRIDGE_NAME,
    type: eventType,
    severity: "info",
    title,
    body: feedback.body,
    replyTo: {
      target: TARGET_GITHUB_PR,
      token: { prNumber },
    },
    context,
  };
}

// =============================================================================
// GitHub Bridge Implementation
// =============================================================================

export const githubBridge: FullBridge = {
  name: BRIDGE_NAME,
  targets: [TARGET_GITHUB_PR],

  async events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{ events: Event[]; state: JsonValue }> {
    const bridgeState = (state as GitHubBridgeState) ?? {};
    const now = Date.now();

    // Check timing - skip if polled too recently
    // Use configured poll interval, fallback to default
    const lastPollTime = bridgeState.lastPollTime ?? 0;
    const configObj = ctx.config as { pollIntervalMs?: number } | undefined;
    const pollInterval = configObj?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    if (now - lastPollTime < pollInterval) {
      // Too soon, return empty events
      return { events: [], state: bridgeState as unknown as JsonValue };
    }

    // Ensure we have a PR reference
    const prNumber = ctx.changeRequestRef
      ? parseInt(ctx.changeRequestRef, 10)
      : undefined;

    if (!prNumber || isNaN(prNumber)) {
      // No PR, can't poll
      return {
        events: [],
        state: { ...bridgeState, lastPollTime: now } as unknown as JsonValue,
      };
    }

    ctx.log.info(`Polling PR #${prNumber} for feedback...`);

    // Get bot login for filtering (cached after first call)
    let botLogin = bridgeState.botLogin;
    if (!botLogin) {
      try {
        const user = await getCurrentGitHubUser();
        botLogin = user.login;
      } catch {
        botLogin = "";
      }
    }

    // Fetch all feedback types
    const [issueComments, reviews, reviewComments] = await Promise.all([
      getPRComments(ctx.repoRoot, prNumber),
      getPRReviews(ctx.repoRoot, prNumber),
      getPRReviewComments(ctx.repoRoot, prNumber),
    ]);

    const allFeedback = [...issueComments, ...reviews, ...reviewComments];

    // Filter to only new feedback
    const cursors = bridgeState.cursors ?? {};
    const newFeedback = filterNewFeedback(allFeedback, cursors, botLogin);

    // Convert to events
    const events = newFeedback.map((f) => feedbackToEvent(f, prNumber));

    // Update cursors
    const newCursors = getMaxFeedbackIds(allFeedback);
    const mergedCursors: FeedbackCursors = {
      lastIssueCommentId:
        newCursors.lastIssueCommentId ?? cursors.lastIssueCommentId,
      lastReviewId: newCursors.lastReviewId ?? cursors.lastReviewId,
      lastReviewCommentId:
        newCursors.lastReviewCommentId ?? cursors.lastReviewCommentId,
    };

    if (events.length > 0) {
      ctx.log.info(`Found ${events.length} new feedback items`);
    }

    return {
      events,
      state: {
        lastPollTime: now,
        cursors: mergedCursors,
        botLogin,
      } as unknown as JsonValue,
    };
  },

  async actions(ctx: BridgeContext, action: Action): Promise<ActionResult> {
    // Check for idempotency - was this action already delivered?
    const actionState = loadBridgeActionState(ctx.worktree, BRIDGE_NAME);

    if (actionState.deliveredActions[action.id]) {
      // Already delivered, skip
      ctx.log.info(`Action ${action.id} already delivered, skipping`);
      return { success: true };
    }

    // Extract PR number from action target token
    const token = action.target.token as { prNumber?: number } | undefined;
    const prNumber = token?.prNumber;

    if (!prNumber) {
      ctx.log.error(`Action ${action.id} has no PR number in token`);
      return {
        success: false,
        error: "No PR number in action target token",
        retryable: false,
      };
    }

    try {
      const payload = action.payload;
      let externalId: { commentId?: number; reviewId?: number } = {};

      if (payload.type === "comment") {
        ctx.log.info(`Posting comment to PR #${prNumber}`);
        const result = await postPRComment(
          ctx.repoRoot,
          prNumber,
          payload.message
        );
        externalId = { commentId: result.id };
      } else if (payload.type === "inline_comment") {
        ctx.log.info(`Posting inline comment to PR #${prNumber} at ${payload.path}:${payload.line}`);
        // For inline comments, use a review with single comment
        const result = await submitPRReview(ctx.repoRoot, prNumber, {
          verdict: "comment",
          summary: "",
          comments: [
            {
              path: payload.path,
              line: payload.line,
              body: payload.message,
            },
          ],
        });
        externalId = { reviewId: result.id };
      } else if (payload.type === "review") {
        ctx.log.info(`Submitting ${payload.verdict} review to PR #${prNumber}`);
        const result = await submitPRReview(ctx.repoRoot, prNumber, {
          verdict: payload.verdict,
          summary: payload.summary,
          comments: payload.comments,
        });
        externalId = { reviewId: result.id };
      } else if (payload.type === "request_reviewers") {
        ctx.log.info(`Requesting reviewers for PR #${prNumber}: ${payload.reviewers.join(", ")}`);
        await requestReviewers(ctx.repoRoot, prNumber, payload.reviewers);
      } else if (payload.type === "merge") {
        ctx.log.info(`Merging PR #${prNumber} with method ${payload.method ?? "merge"}`);
        await mergePR(ctx.repoRoot, prNumber, payload.method);
      } else if (payload.type === "close_pr") {
        ctx.log.info(`Closing PR #${prNumber}`);
        await closePR(ctx.repoRoot, prNumber);
      } else if (payload.type === "add_labels") {
        ctx.log.info(`Adding labels to PR #${prNumber}: ${payload.labels.join(", ")}`);
        await addLabels(ctx.repoRoot, prNumber, payload.labels);
      } else if (payload.type === "remove_labels") {
        ctx.log.info(`Removing labels from PR #${prNumber}: ${payload.labels.join(", ")}`);
        await removeLabels(ctx.repoRoot, prNumber, payload.labels);
      } else if (payload.type === "assign_users") {
        ctx.log.info(`Assigning users to PR #${prNumber}: ${payload.users.join(", ")}`);
        await assignUsers(ctx.repoRoot, prNumber, payload.users);
      } else if (payload.type === "set_milestone") {
        ctx.log.info(`Setting milestone for PR #${prNumber}: ${payload.milestone}`);
        await setMilestone(ctx.repoRoot, prNumber, payload.milestone);
      } else {
        ctx.log.error(`Unknown payload type: ${(payload as { type: string }).type}`);
        return {
          success: false,
          error: `Unknown payload type: ${(payload as { type: string }).type}`,
          retryable: false,
        };
      }

      // Mark as delivered with external artifact ID (per RFC for idempotency/debugging)
      actionState.deliveredActions[action.id] = {
        deliveredAt: new Date().toISOString(),
        prNumber,
        ...externalId,
      };
      saveBridgeActionState(ctx.worktree, BRIDGE_NAME, actionState);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Check if retryable (rate limits, network errors)
      const isRetryable =
        message.includes("rate limit") ||
        message.includes("ECONNREFUSED") ||
        message.includes("timeout");

      ctx.log.error(`Action failed: ${message}${isRetryable ? " (will retry)" : ""}`);

      return {
        success: false,
        error: message,
        retryable: isRetryable,
      };
    }
  },
};

// =============================================================================
// Export
// =============================================================================

export default githubBridge;
