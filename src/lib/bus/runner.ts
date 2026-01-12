/**
 * Bus Runner
 *
 * Orchestrates the bus tick loop: polling bridges for events and routing actions.
 * Called from the dispatcher main loop.
 */

import type { Config } from "../config.js";
import type { PlanState } from "../state.js";
import type { Logger } from "../dispatcher.js";
import type {
  Event,
  Action,
  BridgeContext,
  BridgeLogger,
  Bridge,
  JsonValue,
} from "./types.js";
import { hasEvents, hasActions } from "./types.js";
import {
  initBusDir,
  hasBusDir,
  appendEvent,
  readEvents,
  appendAction,
  readActions,
  loadDispatcherState,
  saveDispatcherState,
  loadBridgeState,
  saveBridgeState,
  loadBridgeActionState,
  saveBridgeActionState,
  deduplicateEvents,
  pruneProcessedIds,
} from "./manager.js";
import { BridgeRegistry, routeAction } from "./registry.js";
import { githubBridge } from "./bridges/github.js";
import { logBusError, logBridgeError, logWarning } from "../errors.js";

// =============================================================================
// Bus Runner State
// =============================================================================

interface BusRunnerState {
  registry: BridgeRegistry;
  initialized: boolean;
  lastTickTime: number;
}

// Singleton runner state per repo
const runnerStates = new Map<string, BusRunnerState>();

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the bus runner for a repository.
 * Registers bridges based on config, including dynamic loading of custom modules.
 */
export async function initBusRunner(
  repoRoot: string,
  config: Config
): Promise<BusRunnerState> {
  const existing = runnerStates.get(repoRoot);
  if (existing?.initialized) {
    return existing;
  }

  const registry = new BridgeRegistry();

  // Register built-in GitHub bridge if enabled (and no custom module specified)
  const githubConfig = config.bridges.github;
  if (githubConfig?.enabled !== false && !githubConfig?.module) {
    registry.register(githubBridge);
  }

  // Load and register custom bridges from config
  for (const [bridgeName, bridgeConfig] of Object.entries(config.bridges)) {
    if (!bridgeConfig.enabled) continue;
    if (!bridgeConfig.module) continue;

    // Resolve module path relative to repo root
    const modulePath = bridgeConfig.module.startsWith("./")
      ? `${repoRoot}/${bridgeConfig.module}`
      : bridgeConfig.module;

    let bridgeModule;
    try {
      // Dynamic import the module
      bridgeModule = await import(modulePath);
    } catch (error) {
      // Module loading failures are non-fatal (missing file, syntax error, etc.)
      console.warn(
        `Failed to load bridge module ${bridgeConfig.module}: ${error}`
      );
      continue;
    }

    // Look for default export or named 'bridge' export
    const bridge = bridgeModule.default ?? bridgeModule.bridge;

    if (bridge && typeof bridge.name === "string") {
      // Registry.register() throws on duplicate bridges/targets - this is fatal
      // and should propagate up to fail startup (config error)
      registry.register(bridge);
    } else {
      console.warn(
        `Bridge module ${bridgeConfig.module} does not export a valid bridge`
      );
    }
  }

  const state: BusRunnerState = {
    registry,
    initialized: true,
    lastTickTime: 0,
  };

  runnerStates.set(repoRoot, state);
  return state;
}

/**
 * Get the bus runner state for a repository.
 */
export function getBusRunner(repoRoot: string): BusRunnerState | undefined {
  return runnerStates.get(repoRoot);
}

// =============================================================================
// Bus Tick - Events
// =============================================================================

/**
 * Run the event polling phase of the bus tick for a worktree.
 * Polls all bridges and appends events to events.jsonl.
 */
export async function tickBusEvents(
  repoRoot: string,
  worktree: string,
  ps: PlanState,
  config: Config,
  log: Logger
): Promise<Event[]> {
  const runner = getBusRunner(repoRoot);
  if (!runner) {
    return [];
  }

  // Ensure bus directory exists
  if (!hasBusDir(worktree)) {
    initBusDir(worktree);
  }

  const allNewEvents: Event[] = [];

  // Poll each bridge that has events()
  for (const bridge of runner.registry.getEventBridges()) {
    try {
      // Get bridge-specific config
      const bridgeCfg = config.bridges[bridge.name];

      // Create logger that prefixes with bridge name
      const bridgeLog: BridgeLogger = {
        info: (msg) => log.info(`[${bridge.name}] ${msg}`, ps.branch),
        warn: (msg) => log.warn(`[${bridge.name}] ${msg}`, ps.branch),
        error: (msg) => log.error(`[${bridge.name}] ${msg}`, ps.branch),
      };

      // Build context with full bridge config (as JsonValue)
      const ctx: BridgeContext = {
        repoRoot,
        worktree,
        branch: ps.branch,
        changeRequestRef: ps.pr?.toString(),
        config: bridgeCfg as unknown as JsonValue,
        log: bridgeLog,
      };

      // Load bridge state
      const bridgeState = loadBridgeState(worktree, bridge.name);

      // Call events()
      if (hasEvents(bridge)) {
        const result = await bridge.events(ctx, bridgeState);

        // Save updated bridge state
        if (result.state !== undefined) {
          saveBridgeState(worktree, bridge.name, result.state);
        }

        // Append new events to events.jsonl
        for (const event of result.events) {
          appendEvent(worktree, event);
          allNewEvents.push(event);
        }

        if (result.events.length > 0) {
          log.info(
            `📬 ${result.events.length} new events from ${bridge.name}`,
            ps.branch
          );
        }
      }
    } catch (error) {
      log.warn(`Bridge ${bridge.name} events() failed: ${error}`, ps.branch);
      logBridgeError(
        worktree,
        bridge.name,
        `Bridge events() failed: ${error}`,
        error,
        undefined,
        { branch: ps.branch }
      );
    }
  }

  return allNewEvents;
}

// =============================================================================
// Bus Tick - Actions
// =============================================================================

/**
 * Run the action routing phase of the bus tick for a worktree.
 * Reads pending actions and routes them to bridges.
 * Implements at-least-once delivery: retryable failures will be retried on next tick.
 */
export async function tickBusActions(
  repoRoot: string,
  worktree: string,
  ps: PlanState,
  config: Config,
  log: Logger
): Promise<void> {
  const runner = getBusRunner(repoRoot);
  if (!runner) {
    return;
  }

  if (!hasBusDir(worktree)) {
    return;
  }

  // Load dispatcher state to get actions offset
  const dispatcherState = loadDispatcherState(worktree);
  const actionsOffset = dispatcherState.actionsOffset ?? 0;

  // Read new actions
  const { actions, newOffset } = readActions(worktree, actionsOffset);

  if (actions.length === 0) {
    return;
  }

  log.info(`📤 Routing ${actions.length} actions`, ps.branch);

  // Track whether any action hit a retryable failure.
  // If so, we don't advance the offset at all - all actions in this batch
  // will be re-read on next tick. Bridge action state provides idempotency,
  // so already-delivered actions will be skipped as duplicates.
  let hitRetryableFailure = false;

  // Route each action
  for (const action of actions) {
    // If we've hit a retryable failure, stop processing
    // (to maintain ordering - we don't want to skip ahead)
    if (hitRetryableFailure) {
      log.info(`⏸ Pausing action routing due to pending retry`, ps.branch);
      break;
    }

    try {
      // Look up the bridge for this action's target to get the right config
      const targetBridge = runner.registry.getTargetBridge(action.target.target);
      const bridgeCfg = targetBridge
        ? config.bridges[targetBridge.name]
        : undefined;

      // Create logger that prefixes with bridge name (or "unknown" if no bridge found)
      const bridgeName = targetBridge?.name ?? "unknown";
      const bridgeLog: BridgeLogger = {
        info: (msg) => log.info(`[${bridgeName}] ${msg}`, ps.branch),
        warn: (msg) => log.warn(`[${bridgeName}] ${msg}`, ps.branch),
        error: (msg) => log.error(`[${bridgeName}] ${msg}`, ps.branch),
      };

      // Build context with bridge-specific config and logger
      const actionCtx: BridgeContext = {
        repoRoot,
        worktree,
        branch: ps.branch,
        changeRequestRef: ps.pr?.toString(),
        config: bridgeCfg as unknown as JsonValue,
        log: bridgeLog,
      };

      const result = await routeAction(runner.registry, actionCtx, action);

      if (!result) {
        // No bridge claims this target - treat as non-retryable failure
        // We continue processing but will still advance offset at end
        log.warn(
          `No bridge claims target "${action.target.target}" for action ${action.id}`,
          ps.branch
        );
        logBusError(
          worktree,
          `No bridge claims target "${action.target.target}"`,
          undefined,
          undefined,
          { actionId: action.id, target: action.target }
        );
        continue;
      }

      if (result.result.success) {
        log.info(
          `✓ Action ${action.id} delivered via ${result.bridgeName}`,
          ps.branch
        );
      } else {
        // Action failed
        if (result.result.retryable) {
          log.warn(
            `⚠ Action ${action.id} failed (will retry): ${result.result.error}`,
            ps.branch
          );
          logBusError(
            worktree,
            `Action failed (retryable): ${result.result.error}`,
            undefined,
            undefined,
            { actionId: action.id, bridgeName: result.bridgeName, retryable: true }
          );
          // Don't advance offset - this and all remaining actions will be retried
          hitRetryableFailure = true;
        } else {
          log.error(
            `✗ Action ${action.id} failed (not retryable): ${result.result.error}`,
            ps.branch
          );
          logBusError(
            worktree,
            `Action failed (not retryable): ${result.result.error}`,
            undefined,
            undefined,
            { actionId: action.id, bridgeName: result.bridgeName, retryable: false }
          );
          // Non-retryable failure - continue processing remaining actions
        }
      }
    } catch (error) {
      // Unexpected error - treat as retryable
      log.error(`Action routing error (will retry): ${error}`, ps.branch);
      logBusError(
        worktree,
        `Action routing error (unexpected): ${error}`,
        error,
        undefined,
        { actionId: action.id }
      );
      hitRetryableFailure = true;
    }
  }

  // Only advance offset to end of batch if no retryable failures occurred.
  // If there was a retryable failure, we leave offset unchanged so the entire
  // batch will be re-read on next tick. Bridge action state (deliveredActions)
  // ensures idempotency - already-delivered actions won't be re-sent.
  if (!hitRetryableFailure) {
    dispatcherState.actionsOffset = newOffset;
    saveDispatcherState(worktree, dispatcherState);
  }
}

// =============================================================================
// Read Events for Triage
// =============================================================================

/**
 * Read new events from the bus for triage processing.
 * Returns deduplicated events and updates the dispatcher state.
 */
export function readBusEventsForTriage(worktree: string): Event[] {
  if (!hasBusDir(worktree)) {
    return [];
  }

  // Load dispatcher state
  const dispatcherState = loadDispatcherState(worktree);

  // Read new events
  const { events, newOffset } = readEvents(
    worktree,
    dispatcherState.eventsOffset
  );

  if (events.length === 0) {
    return [];
  }

  // Deduplicate
  const processedIds = new Set(dispatcherState.processedEventIds);
  const newEvents = deduplicateEvents(events, processedIds);

  // Update state
  dispatcherState.eventsOffset = newOffset;
  dispatcherState.processedEventIds = pruneProcessedIds(
    Array.from(processedIds),
    1000
  );
  saveDispatcherState(worktree, dispatcherState);

  return newEvents;
}

// =============================================================================
// Append Action
// =============================================================================

/**
 * Append an action to the bus for outbound delivery.
 */
export function appendBusAction(worktree: string, action: Action): void {
  if (!hasBusDir(worktree)) {
    initBusDir(worktree);
  }
  appendAction(worktree, action);
}

// =============================================================================
// Convert Feedback to Events
// =============================================================================

/**
 * Convert PR feedback to bus events format.
 * Used during the migration to bridge the old feedback format with the new event format.
 */
export function feedbackToEvents(
  feedback: Array<{
    id: number;
    type: string;
    author: string;
    body: string;
    path?: string;
    line?: number;
    diffHunk?: string;
    reviewState?: string;
    createdAt: string;
    inReplyToId?: number;
  }>,
  prNumber: number
): Event[] {
  return feedback.map((f) => {
    let eventType: string;
    let title: string;

    switch (f.type) {
      case "issue_comment":
        eventType = "pr_comment";
        title = `Comment from ${f.author}`;
        break;
      case "review":
        eventType = "pr_review";
        title = `Review from ${f.author}: ${f.reviewState ?? "comment"}`;
        break;
      case "review_comment":
        eventType = "pr_inline_comment";
        title = `Inline comment from ${f.author}`;
        break;
      default:
        eventType = f.type;
        title = `Feedback from ${f.author}`;
    }

    const context: Record<string, unknown> = {
      feedbackId: f.id,
      feedbackType: f.type,
      author: f.author,
      createdAt: f.createdAt,
    };

    if (f.path) context.path = f.path;
    if (f.line !== undefined) context.line = f.line;
    if (f.diffHunk) context.diffHunk = f.diffHunk;
    if (f.reviewState) context.reviewState = f.reviewState;
    if (f.inReplyToId) context.inReplyToId = f.inReplyToId;

    return {
      id: `github-${f.type}-${f.id}`,
      source: "github",
      type: eventType,
      severity: "info" as const,
      title,
      body: f.body,
      replyTo: {
        target: "github-pr",
        token: { prNumber },
      },
      context: context as Record<string, import("./types.js").JsonValue>,
    };
  });
}

// =============================================================================
// Create Action from Triage Response
// =============================================================================

/**
 * Create a respond action for posting a comment.
 */
export function createCommentAction(
  prNumber: number,
  message: string,
  relatedEventId?: string
): Action {
  return {
    id: `action-comment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "respond",
    target: {
      target: "github-pr",
      token: { prNumber },
    },
    payload: {
      type: "comment",
      message,
    },
    relatedEventId,
  };
}
