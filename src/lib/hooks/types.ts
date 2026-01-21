/**
 * Hooks Types
 *
 * Core types for the lifecycle hooks system.
 * See RFC: docs/rfc-lifecycle-hooks.md
 */

import type {
  Action,
  Event,
  ReplyAddress,
  InlineComment,
  JsonValue,
} from "../bus/types.js";
import type { ModelRef } from "../config.js";

// =============================================================================
// Hook Points
// =============================================================================

/**
 * Hook points during plan execution.
 * See RFC: docs/rfc-plugin-bridge-primitives.md
 */
export type HookPoint =
  | "afterDesign"
  | "beforeTodo"
  | "afterTodo"
  | "beforeFinish"
  | "afterFinish"
  | "onEvent"; // RFC: Global Bridges & Core Bridge - event interception hook

// =============================================================================
// Hook Context
// =============================================================================

/**
 * Context passed to hooks during execution.
 * Provides access to plan state and utilities.
 */
export interface HookContext {
  /** Repository root path */
  repoRoot: string;

  /** Worktree path for this plan */
  worktree: string;

  /** Plan ID */
  planId: string;

  /** Current hook point */
  hookPoint: HookPoint;

  /** PR number if applicable */
  changeRequestRef?: string;

  /**
   * Run agent with automatic plan context injection.
   * Uses prloom's configured adapter and associates sessions with the plan.
   */
  runAgent: (
    prompt: string,
    options?: {
      files?: string[];
      model?: ModelRef;
      stage?: "designer" | "worker" | "triage";
    }
  ) => Promise<string>;

  /**
   * Emit action to outbox for bridge delivery.
   * Actions go to the File Bus; bridges handle delivery (e.g., post GitHub comment).
   */
  emitAction: (action: Action) => void;

  /** Completed TODO text (only for afterTodo hook) */
  todoCompleted?: string;
}

// =============================================================================
// Hook Function
// =============================================================================

/**
 * A hook function that receives the plan and context, and returns the updated plan.
 */
export type Hook = (plan: string, ctx: HookContext) => Promise<string>;

// =============================================================================
// Hook Registry
// =============================================================================

/**
 * Registry of hooks organized by hook point.
 * Each hook point can have multiple hooks (from different plugins).
 */
export type HookRegistry = Partial<Record<HookPoint, Hook[]>>;

// =============================================================================
// Plugin Definition
// =============================================================================

/**
 * Configuration for a plugin in prloom/config.json.
 */
export interface PluginConfig {
  /** Whether the plugin is enabled (default: true) */
  enabled?: boolean;

  /** Module path or npm package name */
  module: string;

  /** Freeform configuration passed to the plugin factory */
  config?: unknown;
}

export type PluginFactory = (
  config: unknown
) => Partial<Record<HookPoint, Hook>> & { onEvent?: EventHook };

// =============================================================================
// Event Hook (RFC: Global Bridges & Core Bridge)
// =============================================================================

/**
 * Event hook function signature.
 * Called once per event (not once per batch like beforeTriage).
 * Returns void - no plan transformation.
 */
export type EventHook = (event: Event, ctx: OnEventContext) => Promise<void>;

// =============================================================================
// Deferred Event Info
// =============================================================================

/**
 * Information about a deferred event.
 */
export interface DeferredEventInfo {
  /** Reason for deferral */
  reason?: string;
  /** ISO timestamp when the event can be retried */
  deferredUntil: string;
}

// =============================================================================
// Review Submission
// =============================================================================

/**
 * Review submission payload for emitReview helper.
 */
export interface ReviewSubmission {
  verdict: "approve" | "request_changes" | "comment";
  summary: string;
  comments: InlineComment[];
}

// =============================================================================
// BeforeTriage Context Extensions
// =============================================================================

/**
 * Extended context for beforeTriage hooks.
 * Includes event interception capabilities and plugin state management.
 * See RFC: docs/rfc-plugin-bridge-primitives.md
 */
export interface BeforeTriageContext extends HookContext {
  // =========================================================================
  // Event Interception (beforeTriage only)
  // =========================================================================

  /** New, unprocessed events for the current plan */
  events?: Event[];

  /**
   * Mark an event as handled. Event is added to processed IDs and never triaged.
   */
  markEventHandled?: (eventId: string) => void;

  /**
   * Mark an event as deferred. Event is skipped for triage and retried later.
   * @param eventId - The event ID to defer
   * @param reason - Optional reason for deferral
   * @param retryAfterMs - Optional backoff time in milliseconds
   */
  markEventDeferred?: (
    eventId: string,
    reason?: string,
    retryAfterMs?: number
  ) => void;

  /**
   * Get IDs of events marked as handled in this invocation.
   */
  getHandledEventIds?: () => string[];

  /**
   * Get IDs of events marked as deferred in this invocation.
   */
  getDeferredEventIds?: () => string[];

  /**
   * Get detailed info about a deferred event.
   */
  getDeferredEventInfo?: (eventId: string) => DeferredEventInfo | undefined;

  /**
   * Get events that should be passed to triage (unmarked events).
   */
  getEventsForTriage?: () => Event[];

  /**
   * Save interception state (handled/deferred) to dispatcher state.
   */
  saveInterceptionState?: () => void;

  // =========================================================================
  // Plugin State (Per-Plan)
  // =========================================================================

  /**
   * Get a value from plugin state.
   * State is stored at <worktree>/prloom/.local/plugin-state/<pluginName>.json
   */
  getState?: (key: string) => JsonValue | undefined;

  /**
   * Set a value in plugin state.
   * State is stored at <worktree>/prloom/.local/plugin-state/<pluginName>.json
   */
  setState?: (key: string, value: JsonValue) => void;

  // =========================================================================
  // Global Plugin State (Repo-Level)
  // =========================================================================

  /**
   * Get a value from global plugin state.
   * State is stored at <repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json
   */
  getGlobalState?: (key: string) => JsonValue | undefined;

  /**
   * Set a value in global plugin state.
   * State is stored at <repoRoot>/prloom/.local/plugin-state-global/<pluginName>.json
   */
  setGlobalState?: (key: string, value: JsonValue) => void;

  // =========================================================================
  // readEvents Helper
  // =========================================================================

  /**
   * Read events from the bus without parsing .bus files directly.
   * This is independent from triage cursors (plugin-managed).
   */
  readEvents?: (options?: {
    types?: string[];
    sinceId?: string;
    limit?: number;
  }) => Promise<{ events: Event[]; lastId?: string }>;

  // =========================================================================
  // Action Helpers
  // =========================================================================

  /**
   * Emit a comment action.
   */
  emitComment?: (target: ReplyAddress, message: string) => void;

  /**
   * Emit a review action.
   */
  emitReview?: (target: ReplyAddress, review: ReviewSubmission) => void;

  /**
   * Emit a merge action.
   */
  emitMerge?: (
    target: ReplyAddress,
    method?: "merge" | "squash" | "rebase"
  ) => void;
}

// =============================================================================
// OnEventContext (RFC: Global Bridges & Core Bridge)
// =============================================================================

/**
 * Context passed to onEvent hooks.
 * Replaces BeforeTriageContext with single-event semantics.
 * See RFC: docs/rfc-global-bridge-and-core.md
 */
export interface OnEventContext {
  // =========================================================================
  // Identifiers
  // =========================================================================

  /** Repository root path */
  repoRoot: string;

  /** Worktree path for this plan */
  worktree: string;

  /** Plan ID */
  planId: string;

  // =========================================================================
  // Event Handling
  // =========================================================================

  /**
   * Mark the current event as handled.
   * Event is added to processed IDs and won't flow to triage.
   */
  markEventHandled: (eventId: string) => void;

  /**
   * Mark the current event as deferred.
   * Event is skipped for triage and retried later.
   */
  markEventDeferred: (
    eventId: string,
    reason?: string,
    retryAfterMs?: number
  ) => void;

  // =========================================================================
  // Action Emission
  // =========================================================================

  /** Emit an action to the bus */
  emitAction: (action: Action) => void;

  /** Emit a comment action */
  emitComment: (target: ReplyAddress, message: string) => void;

  /** Emit a merge action */
  emitMerge: (
    target: ReplyAddress,
    method?: "merge" | "squash" | "rebase"
  ) => void;

  // =========================================================================
  // Plugin State
  // =========================================================================

  /** Get a value from plugin state */
  getState: (key: string) => JsonValue | undefined;

  /** Set a value in plugin state */
  setState: (key: string, value: JsonValue) => void;

  /** Get a value from global plugin state */
  getGlobalState: (key: string) => JsonValue | undefined;

  /** Set a value in global plugin state */
  setGlobalState: (key: string, value: JsonValue) => void;

  // =========================================================================
  // Plan Access
  // =========================================================================

  /**
   * Read plan content.
   * If planId is omitted, reads the current plan.
   */
  readPlan: (planId?: string) => Promise<
    | {
        content: string;
        progress: { total: number; completed: number };
      }
    | undefined
  >;

  /**
   * Read events from the bus.
   */
  readEvents: (options?: {
    types?: string[];
    sinceId?: string;
    limit?: number;
  }) => Promise<{ events: Event[]; lastId?: string }>;
}

// =============================================================================
// GlobalEventContext (RFC: Global Bridges & Core Bridge)
// =============================================================================

/**
 * Context passed to onGlobalEvent hooks.
 * Similar to OnEventContext but operates at global scope.
 */
export interface GlobalEventContext {
  /** Repository root path */
  repoRoot: string;

  /** Worktree is undefined for global scope */
  worktree: undefined;

  /** Plan ID is undefined for global scope */
  planId: undefined;

  /** Mark event as handled */
  markEventHandled: (eventId: string) => void;

  /** Mark event as deferred */
  markEventDeferred: (
    eventId: string,
    reason?: string,
    retryAfterMs?: number
  ) => void;

  /** Emit action to global bus */
  emitAction: (action: Action) => void;

  /** Emit comment action */
  emitComment: (target: ReplyAddress, message: string) => void;

  /** Get global plugin state */
  getGlobalState: (key: string) => JsonValue | undefined;

  /** Set global plugin state */
  setGlobalState: (key: string, value: JsonValue) => void;

  /**
   * Read plan content (planId required in global context).
   */
  readPlan: (planId: string) => Promise<
    | {
        content: string;
        progress: { total: number; completed: number };
      }
    | undefined
  >;

  /**
   * List plans matching filter criteria.
   */
  listPlans: (filter?: PlanFilter) => Promise<PlanSummary[]>;
}

/**
 * Filter for querying plans.
 */
export interface PlanFilter {
  status?: PlanStatus | PlanStatus[];
  hidden?: boolean;
  source?: {
    system?: string;
    kind?: string;
    id?: string;
  };
  location?: "inbox" | "worktree";
}

/**
 * Summary of a plan for listing.
 */
export interface PlanSummary {
  planId: string;
  title: string;
  status: PlanStatus;
  hidden: boolean;
  location: "inbox" | "worktree";
  source?: { system: string; kind: string; id: string };
  progress: { total: number; completed: number };
  createdAt: string;
  updatedAt: string;
}

export type PlanStatus =
  | "draft"
  | "queued"
  | "active"
  | "triaging"
  | "review"
  | "done";
