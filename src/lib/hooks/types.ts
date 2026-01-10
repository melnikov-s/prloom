/**
 * Hooks Types
 *
 * Core types for the lifecycle hooks system.
 * See RFC: docs/rfc-lifecycle-hooks.md
 */

import type { Action } from "../bus/types.js";

// =============================================================================
// Hook Points
// =============================================================================

/**
 * Hook points during plan execution.
 */
export type HookPoint =
  | "afterDesign"
  | "beforeTodo"
  | "afterTodo"
  | "beforeFinish"
  | "afterFinish";

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
  runAgent: (prompt: string, options?: { files?: string[] }) => Promise<string>;

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

/**
 * A plugin is a function that receives config and returns hooks.
 */
export type PluginFactory = (
  config: unknown
) => Partial<Record<HookPoint, Hook>>;
