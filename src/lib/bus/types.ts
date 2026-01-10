/**
 * File Bus Types
 *
 * Core types for the event/action bus architecture.
 * See RFC: docs/rfc-file-bus.md
 */

// =============================================================================
// JSON Value Types
// =============================================================================

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// =============================================================================
// Bus Record (JSONL Envelope)
// =============================================================================

export interface BusRecord {
  ts: string;
  kind: "event" | "action";
  schemaVersion: 1;
  data: Event | Action;
}

// =============================================================================
// Reply Address
// =============================================================================

export interface ReplyAddress {
  target: string;
  token?: JsonValue;
}

// =============================================================================
// Event Types
// =============================================================================

export interface Event {
  id: string;
  source: string;
  type: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  replyTo?: ReplyAddress;
  context?: Record<string, JsonValue>;
}

// =============================================================================
// Action Types
// =============================================================================

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export type OutboundPayload =
  | { type: "comment"; message: string }
  | { type: "inline_comment"; path: string; line: number; message: string }
  | {
      type: "review";
      verdict: "approve" | "request_changes" | "comment";
      summary: string;
      comments: InlineComment[];
    };

export interface Action {
  id: string;
  type: "respond";
  target: ReplyAddress;
  payload: OutboundPayload;
  relatedEventId?: string;
}

// =============================================================================
// Bridge Context
// =============================================================================

export interface BridgeContext {
  repoRoot: string;
  worktree: string;
  branch?: string;
  changeRequestRef?: string;
  /** Bridge-specific config from prloom/config.json - fully freeform per bridge */
  config?: JsonValue;
}

// =============================================================================
// Action Result
// =============================================================================

export type ActionResult =
  | { success: true }
  | { success: false; error: string; retryable: boolean };

// =============================================================================
// Bridge Interfaces
// =============================================================================

/**
 * Inbound-only bridge - produces events but doesn't handle actions.
 * Example: Buildkite CI failure notifications
 */
export interface InboundBridge {
  name: string;
  events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
}

/**
 * Outbound-only bridge - handles actions but doesn't produce events.
 * Rare use case.
 */
export interface OutboundBridge {
  name: string;
  targets: string[];
  actions(ctx: BridgeContext, action: Action): Promise<ActionResult>;
}

/**
 * Full bridge - both produces events and handles actions.
 * Example: GitHub (poll comments, post responses)
 */
export interface FullBridge {
  name: string;
  targets: string[];
  events(
    ctx: BridgeContext,
    state: JsonValue | undefined
  ): Promise<{
    events: Event[];
    state: JsonValue;
  }>;
  actions(ctx: BridgeContext, action: Action): Promise<ActionResult>;
}

/**
 * Union of all bridge types.
 * Key constraint: If `actions` is defined, `targets` must be defined.
 */
export type Bridge = InboundBridge | OutboundBridge | FullBridge;

// =============================================================================
// Type Guards
// =============================================================================

export function hasEvents(
  bridge: Bridge
): bridge is InboundBridge | FullBridge {
  return "events" in bridge && typeof bridge.events === "function";
}

export function hasActions(
  bridge: Bridge
): bridge is OutboundBridge | FullBridge {
  return (
    "actions" in bridge &&
    typeof bridge.actions === "function" &&
    "targets" in bridge &&
    Array.isArray(bridge.targets)
  );
}

// =============================================================================
// Dispatcher State
// =============================================================================

export interface DispatcherBusState {
  /** Byte offset into events.jsonl for reading new events */
  eventsOffset: number;
  /** Byte offset into actions.jsonl for reading pending actions */
  actionsOffset: number;
  /** Set of processed event IDs (for deduplication) */
  processedEventIds: string[];
}

export interface BridgeActionState {
  /** Mapping from Action.id to delivery metadata */
  deliveredActions: Record<string, JsonValue>;
}
