/**
 * Review Provider Events
 *
 * Converts review items to bus events for triage.
 * See RFC: docs/rfc-review-providers.md
 */

import type { Event, JsonValue } from "../bus/types.js";
import type { ReviewItem } from "./types.js";

// =============================================================================
// Event Conversion
// =============================================================================

/**
 * Convert a ReviewItem to a bus Event for triage processing.
 *
 * Per RFC, the event uses:
 * - source: "review:<providerName>"
 * - type: "review_feedback"
 * - context: Contains provider, itemId, path, line, side, etc.
 */
export function reviewItemToEvent(
  item: ReviewItem,
  providerName: string
): Event {
  const context: Record<string, JsonValue> = {
    provider: providerName,
    itemId: item.id as JsonValue,
    author: item.author,
    createdAt: item.createdAt,
  };

  if (item.path !== undefined) {
    context.path = item.path;
  }
  if (item.line !== undefined) {
    context.line = item.line;
  }
  if (item.side !== undefined) {
    context.side = item.side;
  }
  if (item.diffHunk !== undefined) {
    context.diffHunk = item.diffHunk;
  }
  if (item.reviewState !== undefined) {
    context.reviewState = item.reviewState;
  }

  return {
    id: `review-${providerName}-${item.id}`,
    source: `review:${providerName}`,
    type: "review_feedback",
    severity: "info",
    title: `Review from ${item.author}`,
    body: item.body,
    context,
    // Local provider doesn't have a reply target
    // GitHub provider would set replyTo for posting responses
    replyTo: undefined,
  };
}
